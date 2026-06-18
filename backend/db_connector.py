# -*- coding: utf-8 -*-
"""
Oracle DB 연결 모듈
"""
import oracledb
import os
from datetime import datetime, timezone
from dotenv import load_dotenv
import logging

# .env 파일 로드
load_dotenv()

logger = logging.getLogger("sector_monitoring")

class OracleDBConnector:
    """Oracle 데이터베이스 연결 관리"""

    def __init__(self, user=None, password=None, dsn=None):
        """
        초기화

        Args:
            user: 데이터베이스 사용자 (기본값: 환경변수 DB_USER)
            password: 비밀번호 (기본값: 환경변수 DB_PASSWORD)
            dsn: 연결 문자열 (기본값: 환경변수로부터 생성)
        """
        # 환경 변수에서 읽기 (.env 파일 필수)
        self.user = user or os.getenv('DB_USER')
        self.password = password or os.getenv('DB_PASSWORD')
        if not self.user or not self.password:
            raise ValueError("DB_USER와 DB_PASSWORD 환경변수가 필요합니다. backend/.env 파일을 확인하세요.")

        # DSN 생성
        if dsn:
            self.dsn = dsn
        else:
            # 1. DB_DSN 환경변수가 있으면 우선 사용 (전체 커스텀)
            env_dsn = os.getenv('DB_DSN')
            if env_dsn:
                self.dsn = env_dsn
            else:
                db_host = os.getenv('DB_HOST', 'localhost')
                db_port = os.getenv('DB_PORT', '1521')

                # 2. DB_SID가 있으면 SID 방식 사용 (host:port:sid)
                db_sid = os.getenv('DB_SID')
                if db_sid:
                    self.dsn = f"{db_host}:{db_port}:{db_sid}"
                else:
                    # 3. 기본 Service Name 방식 사용 (host:port/service_name)
                    db_service = os.getenv('DB_SERVICE_NAME') or os.getenv('DB_SERVICE') or 'xe'
                    self.dsn = f"{db_host}:{db_port}/{db_service}"

        self._pool = None
        self._init_client()
        self._init_pool()

    def _init_client(self):
        """Oracle Client 초기화 (Thick Mode 고정)"""
        lib_dir = os.getenv('ORACLE_CLIENT_LIB_DIR')
        try:
            if lib_dir and os.path.exists(lib_dir):
                oracledb.init_oracle_client(lib_dir=lib_dir)
                logger.info(f"Oracle Client initialized (Thick mode) with path: {lib_dir}")
            else:
                oracledb.init_oracle_client()
                logger.info("Oracle Client initialized (Thick mode) with system path")
        except Exception as e:
            logger.error(f"Oracle Client 초기화 실패 (Thick mode): {e}")

    def _init_pool(self):
        """연결 풀 초기화 (min=1, max=5)"""
        try:
            self._pool = oracledb.create_pool(
                user=self.user,
                password=self.password,
                dsn=self.dsn,
                min=1,
                max=5,
                increment=1,
            )
            logger.info("Oracle 연결 풀 생성 완료 (min=1, max=5)")
        except Exception as e:
            # 풀 생성 실패 시 직접 연결 방식으로 fallback
            logger.warning(f"연결 풀 생성 실패 — 직접 연결 방식 사용: {e}")
            self._pool = None

    def get_connection(self):
        """
        연결 풀에서 연결 반환 (풀 없으면 직접 연결)
        conn.close() 호출 시 풀 연결은 반납, 직접 연결은 종료됨

        Returns:
            oracledb.Connection
        """
        try:
            if self._pool is not None:
                return self._pool.acquire()
            return oracledb.connect(
                user=self.user,
                password=self.password,
                dsn=self.dsn,
            )
        except Exception as e:
            raise Exception(f"Oracle DB 연결 실패: {e}")

    def test_connection(self):
        """
        연결 테스트

        Returns:
            bool: 연결 성공 여부
        """
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            try:
                cursor.execute("SELECT 1 FROM DUAL")
                result = cursor.fetchone()
                return result is not None
            finally:
                cursor.close()
                conn.close()
        except Exception as e:
            logger.warning(f"연결 테스트 실패: {e}")
            return False

    def fetch_flightplans(self, start_date=None, end_date=None):
        """
        비행계획 데이터 조회

        Args:
            start_date: (미사용) 호환성용 인자
            end_date: (미사용) 호환성용 인자

        Returns:
            list: 비행계획 데이터
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            # 기본 쿼리 - 필수 조건만 유지
            query = """
                SELECT FP_ID, CALLSIGN, DEPT_AIRPORT_CD, DEST_AIRPORT_CD,
                       EOBD, EOBT, ATD, EXFIXTIME, AIRCRAFT_TYPE,
                       ASSIGNED_ALT, INFO_CN, FIR, FIR2,
                       EXFIXROUTE, CORRELATED_STAT, EPETA,
                       CURRENT_CONTROL_POSITION, REQUEST_FLIGHT_LEVEL
                FROM ATFM_FLIGHTPLAN
                WHERE (EXFIXTIME IS NOT NULL OR EXFIXROUTE IS NOT NULL)
            """

            # ISOLD 조건 - 'F' (최신)만
            query += " AND ISOLD = 'F'"

            # FLIGHT_RULE_CD 조건 - 'I' (IFR) 또는 NULL 포함 (더 유연하게)
            query += " AND (FLIGHT_RULE_CD = 'I' OR FLIGHT_RULE_CD IS NULL)"

            query += " ORDER BY EOBT"

            cursor.execute(query)

            columns = [col[0] for col in cursor.description]
            results = [dict(zip(columns, row)) for row in cursor.fetchall()]

            logger.info(f"EXFIXTIME NOT NULL + 필터: {len(results)}개 조회")
            return results
        finally:
            cursor.close()
            conn.close()

    def fetch_completed_flightplans(self, target_date: str):
        """
        실제 완료된 항공기 조회 (통계용).
        ISOLD='T' (관제 종료) + ATD IS NOT NULL (실제 출발) 기준.

        Args:
            target_date: YYYYMMDD 형식 날짜 문자열

        Returns:
            list: 비행계획 데이터 (fetch_flightplans과 동일한 컬럼 구조)
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("""
                SELECT FP_ID, CALLSIGN, DEPT_AIRPORT_CD, DEST_AIRPORT_CD,
                       EOBD, EOBT, ATD, EXFIXTIME, AIRCRAFT_TYPE,
                       ASSIGNED_ALT, INFO_CN, FIR, FIR2,
                       EXFIXROUTE, CORRELATED_STAT, EPETA,
                       CURRENT_CONTROL_POSITION, REQUEST_FLIGHT_LEVEL
                FROM ATFM_FLIGHTPLAN
                WHERE ISOLD = 'T'
                  AND ATD IS NOT NULL
                  AND EOBD = TO_NUMBER(:target_date)
                  AND (EXFIXTIME IS NOT NULL OR EXFIXROUTE IS NOT NULL)
                  AND (FLIGHT_RULE_CD = 'I' OR FLIGHT_RULE_CD IS NULL)
                ORDER BY EOBT
            """, {'target_date': target_date})

            columns = [col[0] for col in cursor.description]
            results = [dict(zip(columns, row)) for row in cursor.fetchall()]
            logger.info(f"완료 항공기 조회 (통계용) [{target_date}]: {len(results)}개")
            return results
        finally:
            cursor.close()
            conn.close()

    def fetch_fixpoint_sectors(self):
        """
        T_AIP_FIXPOINT에서 Fix-Sector 매핑 조회

        Returns:
            tuple: (fix_to_sector dict, fix_to_coords dict)
                - fix_to_sector: {fix_name: sector_id} 매핑
                - fix_to_coords: {fix_name: {'lat': float, 'lon': float}} 좌표 매핑
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("""
                SELECT FIXPNT, SECTOR_ID, LAT, LON
                FROM T_AIP_FIXPOINT
                WHERE SECTOR_ID IS NOT NULL
            """)

            fix_to_sector = {}
            fix_to_coords = {}
            for row in cursor.fetchall():
                fixpnt, sector_id, lat_str, lon_str = row
                fix_to_sector[fixpnt] = sector_id

                try:
                    lat = float(lat_str)
                    lon = float(lon_str)
                    fix_to_coords[fixpnt] = {'lat': lat, 'lon': lon}
                except (ValueError, TypeError):
                    pass  # 좌표 파싱 실패 시 무시

            return fix_to_sector, fix_to_coords
        finally:
            cursor.close()
            conn.close()

    def search_flightplans(self, callsign=None, target_date=None):
        """
        콜사인 또는 날짜별 비행계획 상세 검색

        Args:
            callsign: 콜사인 (Partial match)
            target_date: 대상 날짜 (YYYYMMDD)
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            query = """
                SELECT FP_ID, CALLSIGN, DEPT_AIRPORT_CD, DEST_AIRPORT_CD,
                       EOBD, EOBT, ATD, EXFIXTIME, AIRCRAFT_TYPE,
                       ASSIGNED_ALT, INFO_CN, FIR, FIR2, ISOLD,UTC_CREATE_DT
                FROM ATFM_FLIGHTPLAN
                WHERE 1=1
            """
            params = {}

            if callsign:
                query += " AND UPPER(CALLSIGN) LIKE :callsign"
                params['callsign'] = f"%{callsign.upper()}%"

            if target_date:
                query += " AND EOBD = :target_date"
                params['target_date'] = target_date

            query += " ORDER BY UTC_CREATE_DT DESC"

            cursor.execute(query, params)

            columns = [col[0] for col in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
        finally:
            cursor.close()
            conn.close()

    # -------------------------------------------------------------------------
    # 통계 스키마 자동 초기화 (Oracle 11g 호환)
    # -------------------------------------------------------------------------

    def init_stat_schema(self):
        """
        서버 시작 시 통계 테이블/시퀀스/트리거/인덱스 존재 확인 후 없으면 생성.
        Oracle 11g 호환 (IDENTITY 미사용, SEQUENCE + TRIGGER 방식).
        """
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            # 1. 테이블 존재 여부 확인 → 없을 때만 생성
            cursor.execute(
                "SELECT COUNT(*) FROM USER_TABLES WHERE TABLE_NAME = 'ATFM_SECTOR_STAT'"
            )
            if cursor.fetchone()[0] > 0:
                logger.info("통계 테이블 ATFM_SECTOR_STAT 이미 존재 — 스킵")
                return

            # 2. 시퀀스 생성
            cursor.execute(
                "SELECT COUNT(*) FROM USER_SEQUENCES WHERE SEQUENCE_NAME = 'SEQ_ATFM_SECTOR_STAT'"
            )
            if cursor.fetchone()[0] == 0:
                cursor.execute("""
                    CREATE SEQUENCE SEQ_ATFM_SECTOR_STAT
                        START WITH 1
                        INCREMENT BY 1
                        NOCACHE
                        NOCYCLE
                """)
                logger.info("통계 시퀀스 SEQ_ATFM_SECTOR_STAT 생성 완료")

            # 3. 테이블 생성 — 모든 컬럼 VARCHAR2
            cursor.execute("""
                CREATE TABLE ATFM_SECTOR_STAT (
                    STAT_ID      VARCHAR2(15)  NOT NULL,
                    STAT_DATE    VARCHAR2(8)   NOT NULL,
                    TIME_SLOT    VARCHAR2(5)   NOT NULL,
                    SECTOR_CD    VARCHAR2(10)  NOT NULL,
                    SIM_COUNT    VARCHAR2(5)   NOT NULL,
                    TOTAL_COUNT  VARCHAR2(5)   NOT NULL,
                    CORR_COUNT   VARCHAR2(5)   DEFAULT '0',
                    DOW          VARCHAR2(1)   NOT NULL,
                    SEASON       VARCHAR2(1)   NOT NULL,
                    CAPTURE_AT   VARCHAR2(20)  NOT NULL,
                    CONSTRAINT PK_ATFM_SECTOR_STAT PRIMARY KEY (STAT_ID),
                    CONSTRAINT UQ_ATFM_SECTOR_STAT UNIQUE (STAT_DATE, TIME_SLOT, SECTOR_CD)
                )
            """)
            logger.info("통계 테이블 ATFM_SECTOR_STAT 생성 완료 (VARCHAR2 스키마)")

            # 4. 트리거
            cursor.execute("""
                CREATE OR REPLACE TRIGGER TRG_ATFM_SECTOR_STAT_ID
                BEFORE INSERT ON ATFM_SECTOR_STAT
                FOR EACH ROW
                BEGIN
                    SELECT TO_CHAR(SEQ_ATFM_SECTOR_STAT.NEXTVAL) INTO :NEW.STAT_ID FROM DUAL;
                END;
            """)
            logger.info("통계 트리거 TRG_ATFM_SECTOR_STAT_ID 생성 완료")

            # 5. 인덱스
            cursor.execute(
                "CREATE INDEX IDX_ATFM_STAT_SEASON_DOW "
                "ON ATFM_SECTOR_STAT (SEASON, DOW, SECTOR_CD, TIME_SLOT)"
            )
            cursor.execute(
                "CREATE INDEX IDX_ATFM_STAT_DATE_SEC "
                "ON ATFM_SECTOR_STAT (STAT_DATE, SECTOR_CD)"
            )
            logger.info("통계 인덱스 생성 완료")

            conn.commit()

        except Exception as e:
            conn.rollback()
            logger.error(f"통계 스키마 초기화 실패: {e}")
            raise
        finally:
            cursor.close()
            conn.close()

    # -------------------------------------------------------------------------
    # 통계 데이터 UPSERT
    # -------------------------------------------------------------------------

    def upsert_stat(self, stat_date, time_slot, sector_cd,
                    sim_count, total_count, corr_count, dow, season):
        """
        ATFM_SECTOR_STAT UPSERT (Oracle 11g MERGE INTO).
        모든 컬럼 VARCHAR2 — 값은 문자열로 변환하여 저장.
        stat_date: datetime.date 또는 YYYYMMDD 문자열
        """
        # 모든 값을 문자열로 변환
        if hasattr(stat_date, 'strftime'):
            stat_date_str = stat_date.strftime('%Y%m%d')
        else:
            stat_date_str = str(stat_date).replace('-', '')[:8]
        capture_at = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')

        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("""
                MERGE INTO ATFM_SECTOR_STAT tgt
                USING (SELECT :stat_date AS sd,
                              :time_slot AS ts,
                              :sector_cd AS sc
                       FROM DUAL) src
                ON (tgt.STAT_DATE = src.sd
                    AND tgt.TIME_SLOT = src.ts
                    AND tgt.SECTOR_CD = src.sc)
                WHEN MATCHED THEN
                    UPDATE SET
                        SIM_COUNT   = :sim_count,
                        TOTAL_COUNT = :total_count,
                        CORR_COUNT  = :corr_count,
                        CAPTURE_AT  = :capture_at
                WHEN NOT MATCHED THEN
                    INSERT (STAT_DATE, TIME_SLOT, SECTOR_CD,
                            SIM_COUNT, TOTAL_COUNT, CORR_COUNT,
                            DOW, SEASON, CAPTURE_AT)
                    VALUES (:stat_date, :time_slot, :sector_cd,
                            :sim_count, :total_count, :corr_count,
                            :dow, :season, :capture_at)
            """, {
                'stat_date':   stat_date_str,
                'time_slot':   str(time_slot),
                'sector_cd':   str(sector_cd),
                'sim_count':   str(sim_count),
                'total_count': str(total_count),
                'corr_count':  str(corr_count),
                'dow':         str(dow),
                'season':      str(season),
                'capture_at':  capture_at,
            })
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.error(f"통계 UPSERT 실패 [{sector_cd} {time_slot}]: {e}")
            raise
        finally:
            cursor.close()
            conn.close()

    # -------------------------------------------------------------------------
    # 통계 집계 조회
    # -------------------------------------------------------------------------

    def query_stats_summary(self, season=None, dow=None,
                            sector_cd=None, start_date=None, end_date=None):
        """
        시간대별 평균/최대 동시관제량 집계.
        STAT_DATE는 VARCHAR2(8) YYYYMMDD 형식.
        start_date/end_date: 'YYYY-MM-DD' 또는 'YYYYMMDD' 모두 허용.
        반환: [{ dow, time_slot, sector_cd, avg_sim, max_sim, avg_total, sample_cnt }, ...]
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            where = ['1=1']
            params = {}
            if season:
                where.append('SEASON = :season')
                params['season'] = season.upper()
            if dow is not None:
                where.append('DOW = :dow')
                params['dow'] = str(int(dow))
            if sector_cd:
                where.append('SECTOR_CD = :sector_cd')
                params['sector_cd'] = sector_cd.upper()
            if start_date:
                where.append('STAT_DATE >= :start_date')
                params['start_date'] = start_date.replace('-', '')[:8]
            if end_date:
                where.append('STAT_DATE <= :end_date')
                params['end_date'] = end_date.replace('-', '')[:8]

            sql = f"""
                SELECT DOW, TIME_SLOT, SECTOR_CD,
                       ROUND(AVG(TO_NUMBER(SIM_COUNT)),   1) AS AVG_SIM,
                       MAX(TO_NUMBER(SIM_COUNT))             AS MAX_SIM,
                       ROUND(AVG(TO_NUMBER(TOTAL_COUNT)), 1) AS AVG_TOTAL,
                       COUNT(*)                              AS SAMPLE_CNT
                FROM ATFM_SECTOR_STAT
                WHERE {' AND '.join(where)}
                GROUP BY DOW, TIME_SLOT, SECTOR_CD
                ORDER BY DOW, TIME_SLOT, SECTOR_CD
            """
            cursor.execute(sql, params)
            cols = [c[0].lower() for c in cursor.description]
            return [dict(zip(cols, row)) for row in cursor.fetchall()]
        finally:
            cursor.close()
            conn.close()

    def fetch_stat_slots(self, target_date_str: str) -> set:
        """
        특정 날짜에 이미 저장된 TIME_SLOT 집합 반환 (보정 기준용).
        target_date_str: YYYYMMDD 형식. STAT_DATE도 VARCHAR2(8) YYYYMMDD 형식.
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("""
                SELECT DISTINCT TIME_SLOT
                FROM ATFM_SECTOR_STAT
                WHERE STAT_DATE = :d
                  AND SECTOR_CD = 'GL'
            """, {'d': target_date_str})
            return {row[0] for row in cursor.fetchall()}
        finally:
            cursor.close()
            conn.close()

    def query_stats_daily(self, start_date: str, end_date: str, sector_cd=None):
        """
        특정 기간의 날짜별 실제 통계 반환 (평균 없음, 날짜별 원시값).
        start_date/end_date: 'YYYY-MM-DD' 형식 입력 → 내부에서 YYYYMMDD로 변환.
        반환: [{ stat_date, time_slot, sector_cd, sim_count, total_count, corr_count }, ...]
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            sd = start_date.replace('-', '')[:8]
            ed = end_date.replace('-', '')[:8]
            params = {'start_date': sd, 'end_date': ed}
            sec_clause = ''
            if sector_cd:
                sec_clause = 'AND SECTOR_CD = :sector_cd'
                params['sector_cd'] = sector_cd.upper()

            cursor.execute(f"""
                SELECT STAT_DATE, TIME_SLOT, SECTOR_CD,
                       SIM_COUNT, TOTAL_COUNT, CORR_COUNT
                FROM ATFM_SECTOR_STAT
                WHERE STAT_DATE BETWEEN :start_date AND :end_date
                {sec_clause}
                ORDER BY STAT_DATE, TIME_SLOT, SECTOR_CD
            """, params)
            cols = [c[0].lower() for c in cursor.description]
            rows = []
            for row in cursor.fetchall():
                d = dict(zip(cols, row))
                raw = d.get('stat_date', '')
                if raw and len(raw) == 8:
                    d['stat_date'] = f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
                d['sim_count']   = int(d.get('sim_count')   or 0)
                d['total_count'] = int(d.get('total_count') or 0)
                d['corr_count']  = int(d.get('corr_count')  or 0)
                rows.append(d)
            return rows
        finally:
            cursor.close()
            conn.close()

    def query_stats_date_range(self):
        """통계가 쌓인 날짜 범위와 총 레코드 수 반환."""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("""
                SELECT MIN(STAT_DATE),
                       MAX(STAT_DATE),
                       COUNT(DISTINCT STAT_DATE),
                       COUNT(*)
                FROM ATFM_SECTOR_STAT
            """)
            row = cursor.fetchone()
            def _fmt(v):
                return f"{v[:4]}-{v[4:6]}-{v[6:]}" if v and len(v) == 8 else v
            return {
                'min_date':   _fmt(row[0]),
                'max_date':   _fmt(row[1]),
                'total_days': row[2],
                'total_rows': row[3],
            }
        finally:
            cursor.close()
            conn.close()
