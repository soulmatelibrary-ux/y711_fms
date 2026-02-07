"""
SQLite 데이터베이스 관리자
- 데이터베이스 초기화 및 마이그레이션
- CRUD 작업 관리
"""
import sqlite3
import os
from datetime import datetime, timedelta
from pathlib import Path
import json
import logging
from contextlib import contextmanager

logger = logging.getLogger(__name__)

DEFAULT_ADMIN_USERNAME = 'admin'
DEFAULT_ADMIN_EMAIL = 'admin@system.local'
DEFAULT_ADMIN_PASSWORD_HASH = 'pbkdf2:sha256:600000$uiWpD9I83Wo77Ipu$543872c7ae62f395945c804303c91d3a0715f53dfdab62d37e3fcb9c3eabfcda'

DEFAULT_USER_USERNAME = 'parkeungi21'
DEFAULT_USER_EMAIL = 'parkeungi21@korea.kr'
DEFAULT_USER_PASSWORD_HASH = 'pbkdf2:sha256:600000$uiWpD9I83Wo77Ipu$543872c7ae62f395945c804303c91d3a0715f53dfdab62d37e3fcb9c3eabfcda'
FULL_ACCESS_TABS = json.dumps(["*"])


class DatabaseManager:
    def __init__(self, db_path='database/similarity_detector.db'):
        self.db_path = db_path
        self._ensure_db_exists()
        self._init_schema()

    def _ensure_db_exists(self):
        """데이터베이스 파일이 없으면 생성"""
        db_dir = os.path.dirname(self.db_path)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)
            logger.info(f"Created database directory: {db_dir}")

    def _init_schema(self):
        """스키마 초기화"""
        schema_path = os.path.join(os.path.dirname(__file__), 'schema.sql')
        if not os.path.exists(schema_path):
            logger.error(f"Schema file not found: {schema_path}")
            return

        try:
            with open(schema_path, 'r', encoding='utf-8') as f:
                schema_sql = f.read()

            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.executescript(schema_sql)
            self._apply_schema_updates(conn)
            conn.commit()
            conn.close()
            logger.info("Database schema initialized")
        except Exception as e:
            logger.error(f"Failed to initialize schema: {e}")

    def _apply_schema_updates(self, conn):
        try:
            self._ensure_admin_table_columns(conn)
            self._seed_default_accounts(conn)
        except Exception as e:
            logger.error(f"Schema migration failed: {e}")

    def _ensure_admin_table_columns(self, conn):
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(admin_users)")
        rows = cursor.fetchall()
        if not rows:
            return

        columns = {row[1] for row in rows}

        # 기존 컬럼 추가
        if 'email' not in columns:
            cursor.execute("ALTER TABLE admin_users ADD COLUMN email TEXT")

        if 'role' not in columns:
            cursor.execute("ALTER TABLE admin_users ADD COLUMN role TEXT DEFAULT 'admin'")

        if 'allowed_tabs' not in columns:
            cursor.execute("ALTER TABLE admin_users ADD COLUMN allowed_tabs TEXT DEFAULT '[\"*\"]'")

        # 새로운 사용자 승인 워크플로우 컬럼
        if 'status' not in columns:
            cursor.execute("ALTER TABLE admin_users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'")

        if 'organization_name' not in columns:
            cursor.execute("ALTER TABLE admin_users ADD COLUMN organization_name TEXT")

        if 'rejection_reason' not in columns:
            cursor.execute("ALTER TABLE admin_users ADD COLUMN rejection_reason TEXT")

        if 'requested_at' not in columns:
            cursor.execute("ALTER TABLE admin_users ADD COLUMN requested_at TIMESTAMP")

        if 'approved_at' not in columns:
            cursor.execute("ALTER TABLE admin_users ADD COLUMN approved_at TIMESTAMP")

        if 'approved_by' not in columns:
            cursor.execute("ALTER TABLE admin_users ADD COLUMN approved_by INTEGER")

        if 'rejected_at' not in columns:
            cursor.execute("ALTER TABLE admin_users ADD COLUMN rejected_at TIMESTAMP")

        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_admin_users_status ON admin_users(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_admin_users_requested_at ON admin_users(requested_at)")

        cursor.execute("""
            UPDATE admin_users
            SET email = CASE
                WHEN (email IS NULL OR email = '') AND username = ? THEN ?
                WHEN (email IS NULL OR email = '') THEN username || '@user.local'
                ELSE email
            END
        """, (DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_EMAIL))

        cursor.execute("""
            UPDATE admin_users
            SET role = COALESCE(role, CASE WHEN username = ? THEN 'admin' ELSE 'user' END)
        """, (DEFAULT_ADMIN_USERNAME,))

        cursor.execute("""
            UPDATE admin_users
            SET allowed_tabs = COALESCE(allowed_tabs, ?)
        """, (FULL_ACCESS_TABS,))

    def _seed_default_accounts(self, conn):
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR IGNORE INTO admin_users (username, email, password_hash, role, allowed_tabs, is_active)
            VALUES (?, ?, ?, 'admin', ?, 1)
        """, (
            DEFAULT_ADMIN_USERNAME,
            DEFAULT_ADMIN_EMAIL,
            DEFAULT_ADMIN_PASSWORD_HASH,
            FULL_ACCESS_TABS
        ))

        cursor.execute("""
            INSERT OR IGNORE INTO admin_users (username, email, password_hash, role, allowed_tabs, is_active)
            VALUES (?, ?, ?, 'user', ?, 1)
        """, (
            DEFAULT_USER_USERNAME,
            DEFAULT_USER_EMAIL,
            DEFAULT_USER_PASSWORD_HASH,
            FULL_ACCESS_TABS
        ))

    def get_connection(self):
        """데이터베이스 연결 반환"""
        conn = sqlite3.connect(self.db_path, timeout=30.0)  # 30초 타임아웃
        conn.row_factory = sqlite3.Row
        # WAL 모드 활성화 (동시성 개선)
        conn.execute("PRAGMA journal_mode=WAL")
        # 동시성 최적화
        conn.execute("PRAGMA synchronous=NORMAL")  # 더 빠른 쓰기
        conn.execute("PRAGMA cache_size=10000")    # 캐시 크기 증가
        conn.execute("PRAGMA temp_store=MEMORY")   # 임시 데이터를 메모리에 저장
        return conn

    @contextmanager
    def get_connection_context(self):
        """Context manager로 데이터베이스 연결 관리 (자동 close)"""
        conn = self.get_connection()
        try:
            yield conn
        finally:
            conn.close()

    def execute_query(self, query, params=None):
        """SELECT 쿼리 실행"""
        try:
            with self.get_connection_context() as conn:
                cursor = conn.cursor()
                cursor.execute(query, params or [])
                return cursor.fetchall()
        except Exception as e:
            logger.error(f"Query execution error: {e}", exc_info=True)
            return []

    def execute_insert(self, query, params=None):
        """INSERT 쿼리 실행"""
        try:
            with self.get_connection_context() as conn:
                cursor = conn.cursor()
                cursor.execute(query, params or [])
                conn.commit()
                return cursor.lastrowid
        except Exception as e:
            logger.error(f"Insert execution error: {e}", exc_info=True)
            return None

    def execute_batch_insert(self, query, params_list):
        """배치 INSERT 쿼리 실행 (성능 최적화)

        Args:
            query: INSERT 쿼리 (?, ? 플레이스홀더 포함)
            params_list: [(param1, param2, ...), ...] 리스트

        Returns:
            list: 삽입된 행의 ID 리스트
        """
        try:
            with self.get_connection_context() as conn:
                cursor = conn.cursor()
                last_ids = []
                for params in params_list:
                    cursor.execute(query, params)
                    last_ids.append(cursor.lastrowid)
                conn.commit()
                return last_ids
        except Exception as e:
            logger.error(f"Batch insert execution error: {e}", exc_info=True)
            return []

    def insert_batch_flights(self, flights_data):
        """대량 항공편 데이터 삽입 (벌크 INSERT - 초고속)

        Args:
            flights_data: [{'CALLSIGN': ..., 'DEPT_AIRPORT_CD': ..., ...}, ...] 리스트

        Returns:
            dict: {'ids': [id1, id2, ...], 'count': int}
        """
        if not flights_data:
            return {'ids': [], 'count': 0}

        try:
            with self.get_connection_context() as conn:
                cursor = conn.cursor()
                batch_size = 100
                all_ids = []

                for batch_idx in range(0, len(flights_data), batch_size):
                    batch = flights_data[batch_idx:batch_idx + batch_size]

                    # 다중 행 INSERT 쿼리 생성: INSERT INTO ... VALUES (?, ...), (?, ...), ...
                    placeholders = ','.join(['(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'] * len(batch))
                    query = f"""
                    INSERT INTO flights (
                        callsign, dept_airport_cd, dest_airport_cd, aircraft_type,
                        spd, alt, enr, info_cn, eet, eobd, eobt, raw_sector_times
                    ) VALUES {placeholders}
                    """

                    # 파라미터 평탄화
                    params = []
                    for flight_data in batch:
                        params.extend([
                            flight_data.get('CALLSIGN'),
                            flight_data.get('DEPT_AIRPORT_CD'),
                            flight_data.get('DEST_AIRPORT_CD'),
                            flight_data.get('AIRCRAFT_TYPE'),
                            flight_data.get('SPD'),
                            flight_data.get('ALT'),
                            flight_data.get('ENR'),
                            flight_data.get('INFO_CN'),
                            flight_data.get('EET'),
                            flight_data.get('EOBD'),
                            flight_data.get('EOBT'),
                            flight_data.get('SECTOR_PASSAGE_TIMES')
                        ])

                    try:
                        cursor.execute(query, params)
                        last_id = cursor.lastrowid
                        batch_ids = list(range(last_id - len(batch) + 1, last_id + 1))
                        all_ids.extend(batch_ids)
                        logger.debug(f"Batch inserted: {len(batch)} flights (IDs: {batch_ids[0]}-{batch_ids[-1]})")
                    except Exception as e:
                        logger.error(f"Batch insert failed: {e}", exc_info=True)
                        # 실패한 배치는 개별 처리
                        for flight_data in batch:
                            try:
                                cursor.execute("""
                                    INSERT INTO flights (
                                        callsign, dept_airport_cd, dest_airport_cd, aircraft_type,
                                        spd, alt, enr, info_cn, eet, eobd, eobt, raw_sector_times
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                """, [
                                    flight_data.get('CALLSIGN'),
                                    flight_data.get('DEPT_AIRPORT_CD'),
                                    flight_data.get('DEST_AIRPORT_CD'),
                                    flight_data.get('AIRCRAFT_TYPE'),
                                    flight_data.get('SPD'),
                                    flight_data.get('ALT'),
                                    flight_data.get('ENR'),
                                    flight_data.get('INFO_CN'),
                                    flight_data.get('EET'),
                                    flight_data.get('EOBD'),
                                    flight_data.get('EOBT'),
                                    flight_data.get('SECTOR_PASSAGE_TIMES')
                                ])
                                all_ids.append(cursor.lastrowid)
                            except Exception as inner_e:
                                logger.warning(f"Failed to insert flight {flight_data.get('CALLSIGN')}: {inner_e}")

                conn.commit()
                logger.info(f"Batch flight insertion completed: {len(all_ids)} flights")
                return {'ids': all_ids, 'count': len(all_ids)}

        except Exception as e:
            logger.error(f"Batch flight insertion error: {e}", exc_info=True)
            return {'ids': [], 'count': 0}

    def execute_update(self, query, params=None):
        """UPDATE 쿼리 실행"""
        try:
            with self.get_connection_context() as conn:
                cursor = conn.cursor()
                cursor.execute(query, params or [])
                conn.commit()
                return cursor.rowcount
        except Exception as e:
            logger.error(f"Update execution error: {e}", exc_info=True)
            return 0

    def execute_delete(self, query, params=None):
        """DELETE 쿼리 실행"""
        try:
            with self.get_connection_context() as conn:
                cursor = conn.cursor()
                cursor.execute(query, params or [])
                conn.commit()
                return cursor.rowcount
        except Exception as e:
            logger.error(f"Delete execution error: {e}", exc_info=True)
            return 0

    # ========================================================================
    # Flights 테이블 작업
    # ========================================================================

    def insert_flight(self, flight_data):
        """항공편 데이터 삽입"""
        query = """
        INSERT INTO flights (
            callsign, dept_airport_cd, dest_airport_cd, aircraft_type,
            spd, alt, enr, info_cn, eet, eobd, eobt, raw_sector_times
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        params = (
            flight_data.get('CALLSIGN'),
            flight_data.get('DEPT_AIRPORT_CD'),
            flight_data.get('DEST_AIRPORT_CD'),
            flight_data.get('AIRCRAFT_TYPE'),
            flight_data.get('SPD'),
            flight_data.get('ALT'),
            flight_data.get('ENR'),
            flight_data.get('INFO_CN'),
            flight_data.get('EET'),
            flight_data.get('EOBD'),
            flight_data.get('EOBT'),
            flight_data.get('SECTOR_PASSAGE_TIMES')
        )

        return self.execute_insert(query, params)

    def get_flight(self, flight_id):
        """항공편 조회"""
        query = "SELECT * FROM flights WHERE id = ?"
        results = self.execute_query(query, (flight_id,))
        return dict(results[0]) if results else None

    def get_all_flights(self, limit=None):
        """모든 항공편 조회"""
        query = "SELECT * FROM flights ORDER BY id DESC"
        if limit:
            query += f" LIMIT {limit}"
        results = self.execute_query(query)
        return [dict(row) for row in results]

    # ========================================================================
    # Sector Times 테이블 작업
    # ========================================================================

    def insert_sector_time(self, flight_id, sector_name, entry_time, exit_time):
        """섹터 진입진출 시간 삽입"""
        query = """
        INSERT INTO sector_times (flight_id, sector_name, entry_time, exit_time)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(flight_id, sector_name) DO UPDATE SET
            entry_time = excluded.entry_time,
            exit_time = excluded.exit_time
        """
        params = (flight_id, sector_name, entry_time, exit_time)
        return self.execute_insert(query, params)

    def insert_batch_sector_times(self, sector_times_list):
        """배치로 여러 섹터 시간 삽입 (성능 최적화)

        Args:
            sector_times_list: [(flight_id, sector_name, entry_time, exit_time), ...] 리스트
        """
        query = """
        INSERT INTO sector_times (flight_id, sector_name, entry_time, exit_time)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(flight_id, sector_name) DO UPDATE SET
            entry_time = excluded.entry_time,
            exit_time = excluded.exit_time
        """
        return self.execute_batch_insert(query, sector_times_list)

    def get_sector_times(self, flight_id):
        """항공편의 모든 섹터 시간 조회"""
        query = "SELECT * FROM sector_times WHERE flight_id = ? ORDER BY sector_name"
        results = self.execute_query(query, (flight_id,))
        return [dict(row) for row in results]

    # ========================================================================
    # Similarities 테이블 작업
    # ========================================================================

    def insert_similarity(self, flight_id_1, flight_id_2, callsign_1, callsign_2,
                         level, score, has_overlap=False, overlap_minutes=0, overlap_count=0):
        """유사호출 감지 결과 삽입"""
        query = """
        INSERT INTO similarities (
            flight_id_1, flight_id_2, callsign_1, callsign_2,
            similarity_level, similarity_score,
            has_sector_overlap, total_overlap_minutes, overlap_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        params = (
            flight_id_1, flight_id_2, callsign_1, callsign_2,
            level, score, has_overlap, overlap_minutes, overlap_count
        )

        return self.execute_insert(query, params)

    def get_similarities(self, min_overlap_minutes=2, limit=100):
        """유사호출 조회 (섹터 겹침 필터)"""
        query = """
        SELECT * FROM similarities
        WHERE has_sector_overlap = 1
        AND total_overlap_minutes >= ?
        ORDER BY total_overlap_minutes DESC, detected_at DESC
        LIMIT ?
        """
        results = self.execute_query(query, (min_overlap_minutes, limit))
        return [dict(row) for row in results]

    def get_similarity_details(self, similarity_id):
        """유사호출 상세 정보 조회"""
        query = """
        SELECT
            s.*,
            f1.callsign as flight1_callsign,
            f2.callsign as flight2_callsign
        FROM similarities s
        JOIN flights f1 ON s.flight_id_1 = f1.id
        JOIN flights f2 ON s.flight_id_2 = f2.id
        WHERE s.id = ?
        """
        results = self.execute_query(query, (similarity_id,))
        if results:
            similarity = dict(results[0])

            # 섹터 겹침 상세 정보 조회
            overlap_query = "SELECT * FROM sector_overlaps WHERE similarity_id = ?"
            overlap_results = self.execute_query(overlap_query, (similarity_id,))
            similarity['sector_overlaps'] = [dict(row) for row in overlap_results]

            return similarity
        return None

    # ========================================================================
    # Sector Overlaps 테이블 작업
    # ========================================================================

    def insert_sector_overlap(self, similarity_id, sector_name,
                             flight1_entry, flight1_exit,
                             flight2_entry, flight2_exit,
                             overlap_start, overlap_end, overlap_minutes):
        """섹터 겹침 정보 삽입"""
        query = """
        INSERT INTO sector_overlaps (
            similarity_id, sector_name,
            flight1_entry, flight1_exit,
            flight2_entry, flight2_exit,
            overlap_start, overlap_end, overlap_minutes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        params = (
            similarity_id, sector_name,
            flight1_entry, flight1_exit,
            flight2_entry, flight2_exit,
            overlap_start, overlap_end, overlap_minutes
        )

        return self.execute_insert(query, params)

    # ========================================================================
    # 관리자 인증 관련 테이블 작업
    # ========================================================================

    def get_admin_user_by_email(self, email):
        """이메일 기반 계정 조회"""
        query = """
        SELECT id, username, email, password_hash, role, allowed_tabs, is_active
        FROM admin_users
        WHERE LOWER(email) = LOWER(?)
        LIMIT 1
        """
        results = self.execute_query(query, (email,))
        return dict(results[0]) if results else None

    def record_admin_login(self, user_id):
        """관리자 로그인 시각 기록"""
        query = """
        UPDATE admin_users
        SET last_login_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """
        return self.execute_update(query, (user_id,))

    # ========================================================================
    # 통계 작업
    # ========================================================================

    def get_statistics(self):
        """전체 통계 조회"""
        stats = {}

        # 총 항공편 수
        result = self.execute_query("SELECT COUNT(*) as count FROM flights")
        stats['total_flights'] = dict(result[0])['count'] if result else 0

        # 총 유사호출 쌍
        result = self.execute_query("SELECT COUNT(*) as count FROM similarities")
        stats['total_similarities'] = dict(result[0])['count'] if result else 0

        # 섹터 겹침이 있는 유사호출
        result = self.execute_query(
            "SELECT COUNT(*) as count FROM similarities WHERE has_sector_overlap = 1"
        )
        stats['similarities_with_overlap'] = dict(result[0])['count'] if result else 0

        # 유사도 레벨별 분포
        result = self.execute_query("""
            SELECT similarity_level, COUNT(*) as count
            FROM similarities
            GROUP BY similarity_level
            ORDER BY count DESC
        """)
        stats['level_distribution'] = {
            dict(row)['similarity_level']: dict(row)['count'] for row in result
        }

        # 섹터별 겹침 통계
        result = self.execute_query("""
            SELECT sector_name, COUNT(*) as count, AVG(overlap_minutes) as avg_minutes
            FROM sector_overlaps
            GROUP BY sector_name
            ORDER BY count DESC
        """)
        stats['sector_statistics'] = [dict(row) for row in result]

        # 공존시간별 분포
        result = self.execute_query("""
            SELECT
                CASE
                    WHEN overlap_minutes < 5 THEN '5분 미만'
                    WHEN overlap_minutes < 10 THEN '5-10분'
                    WHEN overlap_minutes < 15 THEN '10-15분'
                    ELSE '15분 이상'
                END as time_range,
                COUNT(*) as count
            FROM sector_overlaps
            GROUP BY time_range
        """)
        stats['overlap_time_distribution'] = {dict(row)['time_range']: dict(row)['count'] for row in result}

        # 유사호출별 겹침 섹터 개수 분포
        result = self.execute_query("""
            SELECT overlap_count, COUNT(*) as count
            FROM similarities
            WHERE overlap_count > 0
            GROUP BY overlap_count
            ORDER BY overlap_count ASC
        """)
        stats['overlap_count_distribution'] = {
            str(dict(row)['overlap_count']): dict(row)['count'] for row in result
        }

        # 2개 이상 섹터에서 겹친 유사호출 쌍의 개수
        result = self.execute_query(
            "SELECT COUNT(*) as count FROM similarities WHERE overlap_count >= 2"
        )
        stats['cross_sector_overlap_pairs'] = dict(result[0])['count'] if result else 0

        # 항공사별(콜사인 앞 3자리) 검출 순위 TOP 5
        airline_query = """
            SELECT airline, COUNT(*) as count FROM (
                SELECT UPPER(SUBSTR(callsign_1, 1, 3)) AS airline FROM similarities WHERE callsign_1 IS NOT NULL
                UNION ALL
                SELECT UPPER(SUBSTR(callsign_2, 1, 3)) AS airline FROM similarities WHERE callsign_2 IS NOT NULL
            )
            WHERE airline != ''
            GROUP BY airline
            ORDER BY count DESC
            LIMIT 5
        """
        airline_result = self.execute_query(airline_query)
        stats['airline_ranking'] = [dict(row) for row in airline_result] if airline_result else []

        # 유사도 레벨 랭킹 (빈도순 정렬)
        level_ranking = []
        if stats.get('level_distribution'):
            for level, count in stats['level_distribution'].items():
                level_ranking.append({'level': level, 'count': count})
            level_ranking.sort(key=lambda item: item['count'], reverse=True)
        stats['level_ranking'] = level_ranking

        # 콜사인 TOP 10 (유사도 점수 기준)
        callsign_query = """
            SELECT callsign_1, callsign_2, similarity_level, similarity_score,
                   total_overlap_minutes, overlap_count
            FROM similarities
            ORDER BY similarity_score DESC
            LIMIT 10
        """
        callsign_result = self.execute_query(callsign_query)
        callsign_top10 = []
        if callsign_result:
            for row in callsign_result:
                row_dict = dict(row)
                callsign_top10.append({
                    'callsign1': row_dict.get('callsign_1'),
                    'callsign2': row_dict.get('callsign_2'),
                    'similarity_level': row_dict.get('similarity_level'),
                    'similarity_score': row_dict.get('similarity_score'),
                    'total_overlap_minutes': row_dict.get('total_overlap_minutes'),
                    'overlap_count': row_dict.get('overlap_count')
                })
        stats['callsign_top10'] = callsign_top10

        return stats

    def cache_statistics(self):
        """통계를 캐시에 저장"""
        stats = self.get_statistics()
        query = """
        INSERT INTO statistics_cache (cache_key, cache_value, expires_at)
        VALUES (?, ?, datetime('now', '+60 minutes'))
        ON CONFLICT(cache_key) DO UPDATE SET
            cache_value = excluded.cache_value,
            cached_at = CURRENT_TIMESTAMP,
            expires_at = excluded.expires_at
        """

        self.execute_insert(query, ('overall_statistics', json.dumps(stats, ensure_ascii=False)))
        logger.info("Statistics cached")

    def get_cached_statistics(self):
        """캐시된 통계 조회"""
        query = """
        SELECT cache_value FROM statistics_cache
        WHERE cache_key = 'overall_statistics'
        AND expires_at > datetime('now')
        """
        results = self.execute_query(query)
        if results:
            return json.loads(dict(results[0])['cache_value'])
        return None

    # ========================================================================
    # 업로드 이력
    # ========================================================================

    def record_upload(self, file_name, file_size, record_count, status='completed', error_msg=None):
        """업로드 이력 기록"""
        query = """
        INSERT INTO upload_history (file_name, file_size, record_count, status, error_message)
        VALUES (?, ?, ?, ?, ?)
        """
        params = (file_name, file_size, record_count, status, error_msg)
        return self.execute_insert(query, params)

    def get_upload_history(self, limit=10):
        """업로드 이력 조회"""
        query = """
        SELECT * FROM upload_history
        ORDER BY uploaded_at DESC
        LIMIT ?
        """
        results = self.execute_query(query, (limit,))
        return [dict(row) for row in results]

    # ========================================================================
    # 항공기 기종 프로필 관리
    # ========================================================================

    def _sanitize_str(self, value):
        if value is None:
            return None
        value = str(value).strip()
        return value if value else None

    def _sanitize_upper(self, value):
        text = self._sanitize_str(value)
        return text.upper() if text else None

    def _sanitize_int(self, value):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def get_aircraft_profiles(self, search=None, limit=50, offset=0):
        query = "SELECT * FROM aircraft_profiles"
        params = []

        if search:
            keyword = f"%{search.upper()}%"
            query += " WHERE UPPER(icao_code) LIKE ? OR UPPER(iata_code) LIKE ? OR UPPER(manufacturer) LIKE ? OR UPPER(model) LIKE ?"
            params.extend([keyword, keyword, keyword, keyword])

        query += " ORDER BY manufacturer ASC, model ASC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        results = self.execute_query(query, params)
        return [dict(row) for row in results]

    def count_aircraft_profiles(self, search=None):
        query = "SELECT COUNT(*) as count FROM aircraft_profiles"
        params = []
        if search:
            keyword = f"%{search.upper()}%"
            query += " WHERE UPPER(icao_code) LIKE ? OR UPPER(iata_code) LIKE ? OR UPPER(manufacturer) LIKE ? OR UPPER(model) LIKE ?"
            params.extend([keyword, keyword, keyword, keyword])

        results = self.execute_query(query, params)
        return dict(results[0])['count'] if results else 0

    def get_aircraft_profile(self, icao_code):
        query = "SELECT * FROM aircraft_profiles WHERE icao_code = ?"
        results = self.execute_query(query, (self._sanitize_upper(icao_code),))
        return dict(results[0]) if results else None

    def create_aircraft_profile(self, profile_data):
        query = """
        INSERT INTO aircraft_profiles (
            icao_code, iata_code, manufacturer, model, type_description,
            default_speed_kmh, default_speed_knots, default_climb_fpm, default_ceiling_fl, notes,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """
        params = (
            self._sanitize_upper(profile_data.get('icao_code')),
            self._sanitize_upper(profile_data.get('iata_code')),
            self._sanitize_str(profile_data.get('manufacturer')),
            self._sanitize_str(profile_data.get('model')),
            self._sanitize_str(profile_data.get('type_description')),
            self._sanitize_int(profile_data.get('default_speed_kmh')),
            self._sanitize_int(profile_data.get('default_speed_knots')),
            self._sanitize_int(profile_data.get('default_climb_fpm')),
            self._sanitize_int(profile_data.get('default_ceiling_fl')),
            self._sanitize_str(profile_data.get('notes'))
        )
        return self.execute_insert(query, params)

    def update_aircraft_profile(self, icao_code, profile_data):
        allowed_fields = {
            'iata_code': self._sanitize_upper,
            'manufacturer': self._sanitize_str,
            'model': self._sanitize_str,
            'type_description': self._sanitize_str,
            'default_speed_kmh': self._sanitize_int,
            'default_speed_knots': self._sanitize_int,
            'default_climb_fpm': self._sanitize_int,
            'default_ceiling_fl': self._sanitize_int,
            'notes': self._sanitize_str
        }

        set_clauses = []
        params = []

        for field, sanitizer in allowed_fields.items():
            if field in profile_data:
                set_clauses.append(f"{field} = ?")
                params.append(sanitizer(profile_data.get(field)))

        if not set_clauses:
            return 0

        set_clauses.append("updated_at = CURRENT_TIMESTAMP")
        query = f"""
        UPDATE aircraft_profiles
        SET {', '.join(set_clauses)}
        WHERE icao_code = ?
        """
        params.append(self._sanitize_upper(icao_code))

        return self.execute_update(query, params)

    def delete_aircraft_profile(self, icao_code):
        query = "DELETE FROM aircraft_profiles WHERE icao_code = ?"
        return self.execute_delete(query, (self._sanitize_upper(icao_code),))

    # ========================================================================
    # 기간 분석 (Period Analysis)
    # ========================================================================

    def get_period_analysis(self, start_date, end_date, min_overlap_minutes=2):
        """지정된 기간에 대한 통계/집계 데이터 생성"""

        def _to_dict(rows):
            return [dict(row) for row in rows] if rows else []

        def _normalize_level(level):
            if not level:
                return 'UNKNOWN'
            level = level.strip().upper()
            if level.startswith('LEVEL_') and '-' in level:
                return level.split('-', 1)[0]
            return level

        try:
            start_dt = datetime.strptime(start_date, '%Y-%m-%d').date()
            end_dt = datetime.strptime(end_date, '%Y-%m-%d').date()
        except ValueError:
            raise ValueError('Invalid date format. Use YYYY-MM-DD')

        if end_dt < start_dt:
            raise ValueError('end_date must be greater than start_date')

        date_range = [
            (start_dt + timedelta(days=i)).isoformat()
            for i in range((end_dt - start_dt).days + 1)
        ]

        params_range = [start_date, end_date]
        params_range_overlap = [start_date, end_date, start_date, end_date, min_overlap_minutes]

        # 총 항공편 수
        total_flights_row = self.execute_query(
            "SELECT COUNT(*) as count FROM flights WHERE eobd BETWEEN ? AND ?",
            params_range
        )
        total_flights = dict(total_flights_row[0])['count'] if total_flights_row else 0

        # 일자별 항공편 수
        flights_by_date = {
            row['date']: row['count']
            for row in _to_dict(self.execute_query(
                """
                SELECT eobd as date, COUNT(*) as count
                FROM flights
                WHERE eobd BETWEEN ? AND ?
                GROUP BY eobd
                ORDER BY eobd
                """,
                params_range
            ))
        }

        # 일자별/레벨별 감지 건수
        daily_level_rows = _to_dict(self.execute_query(
            """
            SELECT f1.eobd as date, s.similarity_level as level, COUNT(*) as count
            FROM similarities s
            JOIN flights f1 ON s.flight_id_1 = f1.id
            JOIN flights f2 ON s.flight_id_2 = f2.id
            WHERE f1.eobd BETWEEN ? AND ?
              AND f2.eobd BETWEEN ? AND ?
              AND s.has_sector_overlap = 1
              AND s.total_overlap_minutes >= ?
            GROUP BY date, level
            ORDER BY date
            """,
            params_range_overlap
        ))

        level_totals = {}
        daily_levels = {date: {} for date in date_range}
        total_detections = 0

        for row in daily_level_rows:
            date = row['date']
            level = _normalize_level(row.get('level'))
            count = row['count']
            total_detections += count
            level_totals[level] = level_totals.get(level, 0) + count
            if date in daily_levels:
                daily_levels[date][level] = count + daily_levels[date].get(level, 0)
            else:
                daily_levels[date] = {level: count}

        detection_rate = round((total_detections / total_flights) * 100, 2) if total_flights else 0.0

        def rate_grade(rate):
            if rate >= 10:
                return '위험'
            if rate >= 5:
                return '주의'
            return '안정'

        # 시간대별 분포 (히트맵)
        hourly_rows = _to_dict(self.execute_query(
            """
            SELECT f1.eobd as date, strftime('%H', REPLACE(so.overlap_start, 'T', ' ')) as hour, COUNT(*) as count
            FROM sector_overlaps so
            JOIN similarities s ON so.similarity_id = s.id
            JOIN flights f1 ON s.flight_id_1 = f1.id
            JOIN flights f2 ON s.flight_id_2 = f2.id
            WHERE f1.eobd BETWEEN ? AND ?
              AND f2.eobd BETWEEN ? AND ?
              AND s.has_sector_overlap = 1
              AND s.total_overlap_minutes >= ?
            GROUP BY f1.eobd, hour
            ORDER BY f1.eobd, hour
            """,
            params_range_overlap
        ))

        hourly_map = {date: {} for date in date_range}
        hour_totals = {}
        for row in hourly_rows:
            date = row['date']
            hour = row['hour'] or '00'
            count = row['count']
            if date in hourly_map:
                hourly_map[date][hour] = count
            else:
                hourly_map[date] = {hour: count}
            hour_totals[hour] = hour_totals.get(hour, 0) + count

        for date in date_range:
            if date not in hourly_map:
                hourly_map[date] = {}
            for hour in range(24):
                hour_key = f"{hour:02d}"
                if hour_key not in hourly_map[date]:
                    hourly_map[date][hour_key] = 0

        top_peak_hours = []
        if hour_totals:
            # Sort by count desc, then hour asc
            sorted_hours = sorted(hour_totals.items(), key=lambda item: (-item[1], item[0]))
            top_peak_hours = [{'hour': h, 'count': c} for h, c in sorted_hours[:2]]


        # 위험 노선 Top 5
        route_rows = _to_dict(self.execute_query(
            """
            WITH route_union AS (
                SELECT f1.dept_airport_cd AS dept, f1.dest_airport_cd AS dest
                FROM similarities s
                JOIN flights f1 ON s.flight_id_1 = f1.id
                JOIN flights f2 ON s.flight_id_2 = f2.id
                WHERE f1.eobd BETWEEN ? AND ?
                  AND f2.eobd BETWEEN ? AND ?
                  AND s.has_sector_overlap = 1
                  AND s.total_overlap_minutes >= ?
                UNION ALL
                SELECT f2.dept_airport_cd, f2.dest_airport_cd
                FROM similarities s
                JOIN flights f1 ON s.flight_id_1 = f1.id
                JOIN flights f2 ON s.flight_id_2 = f2.id
                WHERE f1.eobd BETWEEN ? AND ?
                  AND f2.eobd BETWEEN ? AND ?
                  AND s.has_sector_overlap = 1
                  AND s.total_overlap_minutes >= ?
            )
            SELECT dept, dest, COUNT(*) as count
            FROM route_union
            WHERE dept IS NOT NULL AND dest IS NOT NULL
            GROUP BY dept, dest
            ORDER BY count DESC
            LIMIT 5
            """,
            params_range_overlap + params_range_overlap
        ))

        # 항공사 조합 Top 5
        airline_rows = _to_dict(self.execute_query(
            """
            WITH airline_pairs AS (
                SELECT
                    CASE WHEN a1 <= a2 THEN a1 ELSE a2 END AS airline_a,
                    CASE WHEN a1 <= a2 THEN a2 ELSE a1 END AS airline_b
                FROM (
                    SELECT
                        UPPER(SUBSTR(s.callsign_1, 1, 3)) as a1,
                        UPPER(SUBSTR(s.callsign_2, 1, 3)) as a2
                    FROM similarities s
                    JOIN flights f1 ON s.flight_id_1 = f1.id
                    JOIN flights f2 ON s.flight_id_2 = f2.id
                    WHERE f1.eobd BETWEEN ? AND ?
                      AND f2.eobd BETWEEN ? AND ?
                      AND s.has_sector_overlap = 1
                      AND s.total_overlap_minutes >= ?
                )
                WHERE a1 IS NOT NULL AND a2 IS NOT NULL AND a1 <> '' AND a2 <> ''
            )
            SELECT airline_a, airline_b, COUNT(*) as count
            FROM airline_pairs
            GROUP BY airline_a, airline_b
            ORDER BY count DESC
            LIMIT 5
            """,
            params_range_overlap
        ))

        # 일자별 테이블 구성
        daily_rows = []
        for date in date_range:
            daily_levels_for_date = daily_levels.get(date, {})
            daily_total = sum(daily_levels_for_date.values())
            flights_for_date = flights_by_date.get(date, 0)
            rate = round((daily_total / flights_for_date) * 100, 2) if flights_for_date else 0.0
            dominant_level = None
            if daily_levels_for_date:
                dominant_level = max(daily_levels_for_date.items(), key=lambda item: item[1])[0]
            peak_hour = None
            if date in hourly_map and hourly_map[date]:
                peak_candidate = max(hourly_map[date].items(), key=lambda item: item[1])
                peak_hour = peak_candidate[0] if peak_candidate[1] > 0 else None

            daily_rows.append({
                'date': date,
                'flights': flights_for_date,
                'detections': daily_total,
                'detection_rate': rate,
                'peak_hour': peak_hour,
                'dominant_level': dominant_level
            })

        result = {
            'range': {
                'start_date': start_date,
                'end_date': end_date,
                'total_days': len(date_range)
            },
            'kpis': {
                'total_flights': total_flights,
                'detection_count': total_detections,
                'detection_rate': detection_rate,
                'rate_grade': rate_grade(detection_rate),
                'top_peak_hours': top_peak_hours,
            },
            'levels': {**{lvl: 0 for lvl in ['LEVEL_5', 'LEVEL_4', 'LEVEL_3']}, **level_totals},
            'daily_levels': daily_levels,
            'hourly_heatmap': hourly_map,
            'routes': route_rows,
            'airlines': airline_rows,
            'daily_rows': daily_rows
        }

        return result

    # ========================================================================
    # 참조 데이터 (Waypoints & Sector Boundaries)
    # ========================================================================

    def get_waypoints(self, fixpnt=None):
        """경유지점 좌표 데이터 조회

        Args:
            fixpnt: 특정 경유지점명 (None이면 전체)

        Returns:
            list: 딕셔너리 형태의 경유지점 데이터
        """
        if fixpnt:
            query = "SELECT * FROM waypoints WHERE fixpnt = ? ORDER BY enr_nm, seq"
            results = self.execute_query(query, (fixpnt,))
        else:
            query = "SELECT * FROM waypoints ORDER BY enr_nm, seq"
            results = self.execute_query(query)
        return [dict(row) for row in results]

    def get_all_waypoints_df(self):
        """전체 경유지점을 pandas DataFrame으로 반환 (route_converter 호환)

        Returns:
            DataFrame: 경유지점 데이터 (enroute.xlsx 대체)
        """
        try:
            import pandas as pd
            waypoints = self.get_waypoints()
            if not waypoints:
                return pd.DataFrame()
            return pd.DataFrame(waypoints)
        except ImportError:
            logger.warning("pandas not installed, returning raw data")
            return self.get_waypoints()

    def get_sector_boundaries(self, sector_id=None):
        """섹터 경계 좌표 데이터 조회

        Args:
            sector_id: 특정 섹터ID (None이면 전체)

        Returns:
            list: 딕셔너리 형태의 섹터 경계 데이터
        """
        if sector_id:
            query = "SELECT * FROM sector_boundaries WHERE sector_id = ? ORDER BY seq"
            results = self.execute_query(query, (sector_id,))
        else:
            query = "SELECT * FROM sector_boundaries ORDER BY sector_id, seq"
            results = self.execute_query(query)
        return [dict(row) for row in results]

    def get_sector_boundaries_dict(self):
        """섹터 경계를 딕셔너리 형태로 반환 - Shapely Polygon 객체 반환 (sector1.xlsx 대체)

        Returns:
            dict: {sector_id: Polygon} - Shapely Polygon objects keyed by sector_id
        """
        from shapely.geometry import Polygon

        boundaries = self.get_sector_boundaries()
        sector_coords = {}

        # Group coordinates by sector_id
        for row in boundaries:
            sector_id = row['sector_id']
            if sector_id not in sector_coords:
                sector_coords[sector_id] = []
            sector_coords[sector_id].append((row['lon'], row['lat']))

        # Convert to Polygon objects
        result = {}
        for sector_id, coords in sector_coords.items():
            if len(coords) >= 3:  # Need at least 3 points for a valid polygon
                try:
                    result[sector_id] = Polygon(coords)
                except Exception as e:
                    logger.warning(f"Failed to create polygon for sector {sector_id}: {e}")

        return result

    # ==================== 사용자 승인 워크플로우 관련 메서드 ====================

    def get_allowed_domain(self, domain: str) -> dict | None:
        """도메인이 허용되는지 확인하고 조직 정보 반환"""
        query = "SELECT * FROM allowed_domains WHERE domain = ? AND is_active = 1"
        results = self.execute_query(query, (domain,))
        return dict(results[0]) if results else None

    def get_all_allowed_domains(self, active_only: bool = True) -> list:
        """모든 허용된 도메인 반환"""
        if active_only:
            query = "SELECT * FROM allowed_domains WHERE is_active = 1 ORDER BY domain_type, domain"
        else:
            query = "SELECT * FROM allowed_domains ORDER BY domain_type, domain"
        results = self.execute_query(query)
        return [dict(row) for row in results]

    def add_allowed_domain(self, domain: str, organization_name: str, domain_type: str = 'airline',
                          notes: str = None, created_by: int = None) -> int | None:
        """새로운 도메인 추가"""
        query = """
            INSERT INTO allowed_domains (domain, organization_name, domain_type, notes, created_by, is_active)
            VALUES (?, ?, ?, ?, ?, 1)
        """
        return self.execute_insert(query, (domain, organization_name, domain_type, notes, created_by))

    def delete_allowed_domain(self, domain_id: int) -> bool:
        """도메인 삭제"""
        query = "DELETE FROM allowed_domains WHERE id = ?"
        try:
            with self.get_connection_context() as conn:
                cursor = conn.cursor()
                cursor.execute(query, (domain_id,))
                conn.commit()
                return cursor.rowcount > 0
        except Exception as e:
            logger.error(f"Failed to delete domain: {e}")
            return False

    def get_pending_users(self) -> list:
        """승인 대기 중인 사용자 목록 반환"""
        query = """
            SELECT id, username, email, organization_name, requested_at, role, allowed_tabs
            FROM admin_users
            WHERE status = 'pending'
            ORDER BY requested_at DESC
        """
        results = self.execute_query(query)
        return [dict(row) for row in results]

    def get_admin_user_by_id(self, user_id: int) -> dict | None:
        """ID로 사용자 조회"""
        query = "SELECT * FROM admin_users WHERE id = ?"
        results = self.execute_query(query, (user_id,))
        return dict(results[0]) if results else None

    def create_pending_user(self, username: str, email: str, password_hash: str,
                           organization_name: str) -> int | None:
        """대기 상태의 새 사용자 생성"""
        query = """
            INSERT INTO admin_users (username, email, password_hash, organization_name, status,
                                     role, allowed_tabs, is_active, requested_at, created_at)
            VALUES (?, ?, ?, ?, 'pending', 'user', '["*"]', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """
        return self.execute_insert(query, (username, email, password_hash, organization_name))

    def approve_user(self, user_id: int, approved_by: int, allowed_tabs: str = None) -> bool:
        """사용자 승인"""
        allowed_tabs = allowed_tabs or '["*"]'
        query = """
            UPDATE admin_users
            SET status = 'approved', is_active = 1, approved_at = CURRENT_TIMESTAMP,
                approved_by = ?, allowed_tabs = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """
        try:
            with self.get_connection_context() as conn:
                cursor = conn.cursor()
                cursor.execute(query, (approved_by, allowed_tabs, user_id))
                conn.commit()
                return cursor.rowcount > 0
        except Exception as e:
            logger.error(f"Failed to approve user {user_id}: {e}")
            return False

    def reject_user(self, user_id: int, reason: str) -> bool:
        """사용자 거부"""
        query = """
            UPDATE admin_users
            SET status = 'rejected', is_active = 0, rejection_reason = ?,
                rejected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """
        try:
            with self.get_connection_context() as conn:
                cursor = conn.cursor()
                cursor.execute(query, (reason, user_id))
                conn.commit()
                return cursor.rowcount > 0
        except Exception as e:
            logger.error(f"Failed to reject user {user_id}: {e}")
            return False

    def log_registration_action(self, email: str, username: str, organization_name: str,
                               action: str, action_by: int = None, notes: str = None,
                               ip_address: str = None) -> int | None:
        """사용자 가입 액션 로그 기록"""
        query = """
            INSERT INTO user_registration_log (email, username, organization_name, action,
                                              action_by, notes, ip_address, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """
        return self.execute_insert(query, (email, username, organization_name, action,
                                          action_by, notes, ip_address))
