// SQLite 기반 Y711 FMS 서버
// 경량 운영 환경용 (계정관리 포함)

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 7301;
const DB_PATH = path.join(__dirname, 'fms.db');

// ============================================
// 미들웨어
// ============================================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

// ============================================
// SQLite 데이터베이스 초기화
// ============================================
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ 데이터베이스 연결 오류:', err);
        process.exit(1);
    }
    console.log('✅ SQLite 데이터베이스 연결됨:', DB_PATH);
    initializeDatabase();
});

function initializeDatabase() {
    db.serialize(() => {
        // 사용자 테이블
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                email TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 항공편 테이블
        db.run(`
            CREATE TABLE IF NOT EXISTS flights (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                callsign TEXT NOT NULL,
                dept TEXT,
                dest TEXT,
                cfl TEXT,
                eobt_utc TEXT,
                day_of_week INTEGER,
                schedule_start_date TEXT,
                schedule_end_date TEXT,
                uploaded_date TEXT,
                uploaded_by TEXT,
                uploaded_at TIMESTAMP,
                uploaded_session_id TEXT,
                is_editable BOOLEAN DEFAULT 1,
                is_deletable BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // CTOT 계산 테이블
        db.run(`
            CREATE TABLE IF NOT EXISTS ctot_calculations (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                flight_id TEXT NOT NULL,
                calculated_ctot TEXT,
                delay_minutes INTEGER,
                separation_rule INTEGER,
                status TEXT,
                calculated_at TIMESTAMP,
                modified_at TIMESTAMP,
                modified_by TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (flight_id) REFERENCES flights(id)
            )
        `);

        // 기본 관리자 계정 생성
        createDefaultUser();
    });
}

function createDefaultUser() {
    const username = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const password = process.env.DEFAULT_ADMIN_PASSWORD || 'DevPass123!';

    const passwordHash = hashPassword(password);

    db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
        if (err) {
            console.error('❌ 사용자 확인 오류:', err);
            return;
        }

        if (!row) {
            db.run(
                'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
                [username, passwordHash, 'admin@fms.local'],
                (err) => {
                    if (err) {
                        console.error('❌ 기본 사용자 생성 오류:', err);
                    } else {
                        console.log(`✅ 기본 관리자 계정 생성됨: ${username}`);
                    }
                }
            );
        } else {
            console.log(`✅ 기본 관리자 계정 이미 존재: ${username}`);
        }
    });
}

// ============================================
// 암호화 함수
// ============================================
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function verifyPassword(password, hash) {
    return hashPassword(password) === hash;
}

// ============================================
// 인증 미들웨어
// ============================================
function authenticateUser(req, res, next) {
    const userId = req.headers['x-user-id'];
    const username = req.headers['x-username'];

    if (!userId || !username) {
        return res.status(401).json({ success: false, error: '인증 필요' });
    }

    const id = parseInt(userId, 10);
    if (!id || isNaN(id)) {
        return res.status(401).json({ success: false, error: '유효하지 않은 사용자' });
    }

    db.get(
        'SELECT id, username FROM users WHERE id = ? AND username = ?',
        [id, username],
        (err, user) => {
            if (err) return res.status(500).json({ success: false, error: '서버 오류' });
            if (!user) return res.status(401).json({ success: false, error: '인증 실패' });
            req.userId = user.id;
            req.username = user.username;
            next();
        }
    );
}

// ============================================
// 인증 API
// ============================================

// 로그인
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            error: '사용자명과 비밀번호가 필요합니다'
        });
    }

    db.get(
        'SELECT id, username, password_hash FROM users WHERE username = ?',
        [username],
        (err, user) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    error: '데이터베이스 오류'
                });
            }

            if (!user || !verifyPassword(password, user.password_hash)) {
                return res.status(401).json({
                    success: false,
                    error: '사용자명 또는 비밀번호가 올바르지 않습니다'
                });
            }

            res.json({
                success: true,
                user: {
                    id: user.id,
                    username: user.username
                }
            });
        }
    );
});

// 로그아웃
app.post('/api/auth/logout', (req, res) => {
    res.json({ success: true, message: '로그아웃되었습니다' });
});

// 세션 유효성 확인 (클라이언트 시작 시 호출)
app.get('/api/auth/me', authenticateUser, (req, res) => {
    res.json({ success: true, user: { id: req.userId, username: req.username } });
});

// ============================================
// 항공편 API
// ============================================

// 항공편 조회 (사용자별)
app.get('/api/flights', authenticateUser, (req, res) => {
    const { date, airports } = req.query;

    let query = 'SELECT * FROM flights WHERE user_id = ?';
    const params = [req.userId];

    if (airports) {
        const airportList = airports.split(',');
        const placeholders = airportList.map(() => '?').join(',');
        query += ` AND dept IN (${placeholders})`;
        params.push(...airportList);
    }

    if (date) {
        query += ' AND schedule_start_date <= ? AND schedule_end_date >= ?';
        params.push(date, date);
    }

    query += ' ORDER BY eobt_utc';

    db.all(query, params, (err, flights) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: '항공편 조회 실패'
            });
        }

        res.json({
            success: true,
            count: flights.length,
            flights: flights
        });
    });
});

// 항공편 저장 (Excel 업로드)
app.post('/api/flights', authenticateUser, (req, res) => {
    const { flights, scheduleStartDate, scheduleEndDate } = req.body;

    if (!flights || !Array.isArray(flights)) {
        return res.status(400).json({
            success: false,
            error: '항공편 데이터가 필요합니다'
        });
    }

    const timestamp = Date.now();
    const uploadSessionId = crypto.randomBytes(8).toString('hex');

    db.serialize(() => {
        // 겹치는 기간 데이터 삭제
        if (scheduleStartDate && scheduleEndDate) {
            db.run(
                `DELETE FROM flights
                 WHERE user_id = ?
                 AND schedule_start_date <= ?
                 AND schedule_end_date >= ?`,
                [req.userId, scheduleEndDate, scheduleStartDate],
                (err) => {
                    if (err) {
                        console.error('기존 데이터 삭제 오류:', err);
                    }
                }
            );
        }

        // 새 데이터 삽입
        const stmt = db.prepare(`
            INSERT INTO flights (
                id, user_id, callsign, dept, dest, cfl, eobt_utc,
                day_of_week, schedule_start_date, schedule_end_date,
                uploaded_date, uploaded_by, uploaded_at, uploaded_session_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let insertedCount = 0;

        flights.forEach((flight, index) => {
            const flightId = `${new Date().toISOString().split('T')[0]}_${index}_${timestamp}`;
            const now = new Date().toISOString();

            stmt.run(
                [
                    flightId,
                    req.userId,
                    flight.CALLSIGN,
                    flight.DEPT,
                    flight.DEST,
                    flight.CFL,
                    flight.EOBT_UTC || flight.EOBT,
                    flight.DAY_OF_WEEK,
                    scheduleStartDate || flight.schedule_start_date,
                    scheduleEndDate || flight.schedule_end_date,
                    new Date().toISOString().split('T')[0],
                    req.username,
                    now,
                    uploadSessionId
                ],
                (err) => {
                    if (err) {
                        console.error('항공편 삽입 오류:', err);
                    } else {
                        insertedCount++;
                    }
                }
            );
        });

        stmt.finalize((err) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    error: '항공편 저장 실패'
                });
            }

            res.json({
                success: true,
                message: `${insertedCount}개 항공편이 저장되었습니다`,
                insertedCount: insertedCount
            });
        });
    });
});

// 항공편 수정
app.put('/api/flights/:id', authenticateUser, (req, res) => {
    const { id } = req.params;
    const { callsign, dept, dest, cfl, eobt_utc } = req.body;

    db.run(
        `UPDATE flights
         SET callsign = ?, dept = ?, dest = ?, cfl = ?, eobt_utc = ?
         WHERE id = ? AND user_id = ?`,
        [callsign, dept, dest, cfl, eobt_utc, id, req.userId],
        (err) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    error: '항공편 수정 실패'
                });
            }

            res.json({
                success: true,
                message: '항공편이 수정되었습니다'
            });
        }
    );
});

// 항공편 삭제
app.delete('/api/flights/:id', authenticateUser, (req, res) => {
    const { id } = req.params;

    db.run(
        'DELETE FROM flights WHERE id = ? AND user_id = ?',
        [id, req.userId],
        (err) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    error: '항공편 삭제 실패'
                });
            }

            res.json({
                success: true,
                message: '항공편이 삭제되었습니다'
            });
        }
    );
});

// ============================================================
// V2 API — 설정 테이블 초기화 (서버 시작 시)
// ============================================================
function initV2Tables() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS airport_settings (
            icao TEXT PRIMARY KEY, name_ko TEXT, merge_point TEXT,
            dep_interval INTEGER DEFAULT 4,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS segment_times (
            from_icao TEXT, to_waypoint TEXT, duration_min INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (from_icao, to_waypoint)
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS waypoint_chain (
            from_wp TEXT, to_wp TEXT, duration_min INTEGER, seq INTEGER DEFAULT 0,
            PRIMARY KEY (from_wp, to_wp)
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS conflict_zones (
            waypoint TEXT PRIMARY KEY, name TEXT, separation_min INTEGER DEFAULT 3,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS atd_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, flight_id TEXT, prev_atd TEXT, new_atd TEXT,
            changed_by TEXT, changed_at DATETIME DEFAULT CURRENT_TIMESTAMP, reason TEXT, source TEXT DEFAULT 'manual'
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS advisory_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, flight_id TEXT, callsign TEXT, dept_icao TEXT,
            recommended_time TEXT, prev_time TEXT, issued_by TEXT,
            issued_at DATETIME DEFAULT CURRENT_TIMESTAMP, channel TEXT DEFAULT 'hotline', reason TEXT, acknowledged_at DATETIME
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS change_log (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type    TEXT NOT NULL,
            flight_id     TEXT,
            callsign      TEXT,
            dept          TEXT,
            prev_value    TEXT,
            new_value     TEXT,
            cascade_diffs TEXT,
            reason        TEXT,
            occurred_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 초기값 삽입 (INSERT OR IGNORE)
        const airports = [['RKSS','김포','BULTI',4],['RKTU','청주','MEKIL',10],['RKJK','군산','MANGI',10],['RKJJ','광주','DALSU',10]];
        airports.forEach(([icao,name,mp,di]) => {
            db.run('INSERT OR IGNORE INTO airport_settings (icao,name_ko,merge_point,dep_interval) VALUES (?,?,?,?)',[icao,name,mp,di]);
        });
        const segs = [['RKSS','BULTI',8],['RKTU','MEKIL',7],['RKJK','MANGI',3],['RKJJ','DALSU',1]];
        segs.forEach(([f,t,d]) => db.run('INSERT OR IGNORE INTO segment_times (from_icao,to_waypoint,duration_min) VALUES (?,?,?)',[f,t,d]));
        const chain = [['BULTI','MEKIL',2,1],['MEKIL','GONAX',2,2],['GONAX','BEDES',2,3],['BEDES','ELPOS',3,4],
                       ['ELPOS','MANGI',4,5],['MANGI','DALSU',2,6],['DALSU','NULDI',2,7],['NULDI','DOTOL',3,8],['DOTOL','RKPC',5,9]];
        chain.forEach(([f,t,d,s]) => db.run('INSERT OR IGNORE INTO waypoint_chain (from_wp,to_wp,duration_min,seq) VALUES (?,?,?,?)',[f,t,d,s]));
        const zones = [['MEKIL','MEKIL Convergence',3],['MANGI','MANGI Convergence',3],['DALSU','DALSU Convergence',3]];
        zones.forEach(([w,n,s]) => db.run('INSERT OR IGNORE INTO conflict_zones (waypoint,name,separation_min) VALUES (?,?,?)',[w,n,s]));

        console.log('✅ V2 설정 테이블 초기화 완료');
    });
}
initV2Tables();

// ============================================================
// V2 API — 설정 조회/수정
// ============================================================

app.get('/api/v2/settings/airports', (req, res) => {
    db.all('SELECT * FROM airport_settings ORDER BY icao', (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: rows });
    });
});

app.put('/api/v2/settings/airports/:icao', (req, res) => {
    const { icao } = req.params;
    const { name_ko, merge_point, dep_interval } = req.body;
    db.run('UPDATE airport_settings SET name_ko=?,merge_point=?,dep_interval=?,updated_at=CURRENT_TIMESTAMP WHERE icao=?',
        [name_ko, merge_point, dep_interval, icao],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, changes: this.changes });
        }
    );
});

app.get('/api/v2/settings/segments', (req, res) => {
    db.all('SELECT * FROM segment_times ORDER BY from_icao', (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: rows });
    });
});

app.put('/api/v2/settings/segments', (req, res) => {
    const { from_icao, to_waypoint, duration_min } = req.body;
    db.run('INSERT OR REPLACE INTO segment_times (from_icao,to_waypoint,duration_min,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)',
        [from_icao, to_waypoint, duration_min],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true });
        }
    );
});

app.get('/api/v2/settings/waypoints', (req, res) => {
    db.all('SELECT * FROM waypoint_chain ORDER BY seq', (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: rows });
    });
});

app.put('/api/v2/settings/waypoints', (req, res) => {
    const { from_wp, to_wp, duration_min } = req.body;
    if (!from_wp || !to_wp || duration_min == null) {
        return res.status(400).json({ success: false, error: 'from_wp, to_wp, duration_min 필수' });
    }
    db.run(
        'UPDATE waypoint_chain SET duration_min=? WHERE from_wp=? AND to_wp=?',
        [duration_min, from_wp, to_wp],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            if (this.changes === 0) return res.status(404).json({ success: false, error: '해당 구간 없음' });
            res.json({ success: true });
        }
    );
});

app.get('/api/v2/settings/conflict-zones', (req, res) => {
    db.all('SELECT * FROM conflict_zones', (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: rows });
    });
});

app.put('/api/v2/settings/conflict-zones/:wp', (req, res) => {
    const { wp } = req.params;
    const { separation_min } = req.body;
    db.run('UPDATE conflict_zones SET separation_min=?,updated_at=CURRENT_TIMESTAMP WHERE waypoint=?',
        [separation_min, wp],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, changes: this.changes });
        }
    );
});

// ============================================================
// V2 API — 항공편 (오늘 + 1시간 전 미출발편 포함)
// ============================================================

app.get('/api/v2/flights/today', authenticateUser, (req, res) => {
    const now = new Date();

    // ─────────────────────────────────────────────────────────
    // KST 기준 운항일 (KST = UTC+9)
    // KST 하루 = UTC 이전일 15:00 ~ 당일 14:59
    //   · EOBT UTC ≥ 1500  → 전날 UTC 날짜에 속하지만 KST 당일 새벽 (21xx~23xx UTC)
    //   · EOBT UTC <  1500  → 당일 UTC 날짜에 속하는 KST 낮/저녁 (0000~1459 UTC)
    //
    // day_of_week 는 KST 기준 요일 (1=Mon, 7=Sun)
    // ─────────────────────────────────────────────────────────
    const kstNow = new Date(now.getTime() + 9 * 3600 * 1000);
    const kstDow = kstNow.getUTCDay() === 0 ? 7 : kstNow.getUTCDay();
    const prevKstDow = kstDow === 1 ? 7 : kstDow - 1;
    const todayStr  = kstNow.toISOString().slice(0, 10); // KST 오늘 날짜 (표시용)

    // KST-aware 정렬:
    //   EOBT UTC ≥ 1500 → 실제 KST 새벽 → 정렬 우선 (하루의 시작)
    //   EOBT UTC <  1500 → KST 낮/저녁 → 뒤에 배치
    //   정렬키: eobt_int >= 1500 ? eobt_int : eobt_int + 10000
    const sql = `
        SELECT id, callsign, dept, dest, cfl, eobt_utc AS eobt,
               day_of_week, schedule_start_date, schedule_end_date
        FROM flights
        WHERE user_id = ?
          AND dest = 'RKPC'
          AND dept IN ('RKSS','RKTU','RKJK','RKJJ')
          AND (
              -- KST 당일 낮/저녁 항공편 (EOBT UTC 0000-1459)
              (day_of_week = ? AND CAST(eobt_utc AS INTEGER) < 1500)
              OR
              -- KST 당일 새벽 항공편 (EOBT UTC 1500-2359, 전날 UTC = 전날 KST-1요일)
              (day_of_week = ? AND CAST(eobt_utc AS INTEGER) >= 1500)
          )
        ORDER BY
          CASE WHEN CAST(eobt_utc AS INTEGER) >= 1500
               THEN CAST(eobt_utc AS INTEGER)
               ELSE CAST(eobt_utc AS INTEGER) + 10000
          END ASC
        LIMIT 200
    `;

    db.all(sql, [req.userId, kstDow, prevKstDow], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!rows.length) return res.json({ success: true, data: [], date: todayStr, kstDow });

        // atd_history: 오늘 KST 날짜(= UTC -9h ~ +15h) 범위
        const flightIds = rows.map(r => r.id);
        const placeholders = flightIds.map(() => '?').join(',');
        const kstDayStart = new Date(kstNow.getTime());
        kstDayStart.setUTCHours(0, 0, 0, 0);
        const utcStartOfKstDay = new Date(kstDayStart.getTime() - 9 * 3600 * 1000).toISOString();
        const utcEndOfKstDay   = new Date(kstDayStart.getTime() - 9 * 3600 * 1000 + 86400000 - 1).toISOString();

        db.all(
            `SELECT flight_id, new_atd FROM atd_history
             WHERE flight_id IN (${placeholders})
               AND changed_at >= ? AND changed_at <= ?
             ORDER BY changed_at DESC`,
            [...flightIds, utcStartOfKstDay, utcEndOfKstDay],
            (err2, atdRows) => {
                const atdMap = {};
                (atdRows || []).forEach(r => {
                    if (!atdMap[r.flight_id]) atdMap[r.flight_id] = r.new_atd;
                });

                const flights = rows.map(r => ({
                    id: r.id,
                    callsign: r.callsign,
                    dept: r.dept,
                    dest: r.dest || 'RKPC',
                    cfl: r.cfl,
                    eobt: r.eobt,
                    ctot: r.eobt,   // 초기값 = EOBT, 클라이언트에서 recalcAll()로 재계산
                    atd: atdMap[r.id] || null,
                    status: atdMap[r.id] ? 'DEP' : 'SCH',
                    day_of_week: r.day_of_week,
                    schedule_start_date: r.schedule_start_date,
                    schedule_end_date: r.schedule_end_date,
                    routeWaypoints: []
                }));

                res.json({ success: true, data: flights, date: todayStr, kstDow, count: flights.length });
            }
        );
    });
});

// ============================================================
// V2 API — ATD 입력 저장
// ============================================================

app.post('/api/v2/atd', authenticateUser, (req, res) => {
    const { flightId, atd, prevAtd, reason } = req.body;
    if (!flightId || !atd) return res.status(400).json({ success: false, error: 'flightId, atd 필요' });

    db.run(
        'INSERT INTO atd_history (flight_id, prev_atd, new_atd, changed_by, reason) VALUES (?,?,?,?,?)',
        [flightId, prevAtd || null, atd, req.username, reason || 'manual'],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

// ============================================================
// V2 API — Tower Advisory 저장
// ============================================================

// DEPRECATED 2026-05-10 — Tower Advisory removed in favor of Conflict Watchlist (client no longer calls this)
app.post('/api/v2/advisory', authenticateUser, (req, res) => {
    const { flightId, callsign, deptIcao, recommendedTime, prevTime, reason } = req.body;
    db.run(
        'INSERT INTO advisory_log (flight_id, callsign, dept_icao, recommended_time, prev_time, issued_by, reason) VALUES (?,?,?,?,?,?,?)',
        [flightId, callsign, deptIcao, recommendedTime, prevTime || null, req.username, reason || ''],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

// DEPRECATED 2026-05-10 — Tower Advisory removed in favor of Conflict Watchlist (client no longer calls this)
app.get('/api/v2/advisory/pending', authenticateUser, (req, res) => {
    db.all(
        'SELECT * FROM advisory_log WHERE issued_by = ? ORDER BY issued_at DESC LIMIT 50',
        [req.username],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: rows });
        }
    );
});

// ============================================================
// V2 API — Audit 이력
// ============================================================

app.get('/api/v2/audit', authenticateUser, (req, res) => {
    db.all(
        'SELECT * FROM atd_history WHERE changed_by = ? ORDER BY changed_at DESC LIMIT 100',
        [req.username],
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: rows });
        }
    );
});

// ============================================================
// V2 API — 통합 변경 이력 (change_log)
// ============================================================

app.post('/api/v2/change-log', (req, res) => {
    const { event_type, flight_id, callsign, dept, prev_value, new_value, cascade_diffs, reason } = req.body;
    if (!event_type) return res.status(400).json({ success: false, error: 'event_type 필요' });
    db.run(
        'INSERT INTO change_log (event_type, flight_id, callsign, dept, prev_value, new_value, cascade_diffs, reason) VALUES (?,?,?,?,?,?,?,?)',
        [event_type, flight_id || null, callsign || null, dept || null,
         prev_value || null, new_value || null, cascade_diffs || null, reason || null],
        function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.get('/api/v2/change-log', (req, res) => {
    db.all(
        `SELECT * FROM change_log
         WHERE occurred_at >= datetime('now', 'start of day', '-9 hours')
         ORDER BY occurred_at DESC LIMIT 200`,
        (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, data: rows });
        }
    );
});

// ============================================
// 헬스 체크 / 테스트 API
// ============================================

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Y711 FMS 서버 정상 작동 중',
        database: 'SQLite'
    });
});

app.get('/api/db/test', (req, res) => {
    db.get("SELECT 1", (err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: 'DB 연결 오류'
            });
        }

        res.json({
            success: true,
            message: 'SQLite 데이터베이스 정상',
            dbPath: DB_PATH
        });
    });
});

// ============================================
// SPA 라우팅
// ============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'login.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ============================================
// 서버 시작
// ============================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  ✈️  Y711 FMS (제주공항 흐름 관리 시스템) - SQLite');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log(`  🌐 로컬 접속:   http://localhost:${PORT}/`);
    console.log(`  🌐 외부 접속:   http://ssenalabs.iptime.org:${PORT}/`);
    console.log('');
    console.log('  📊 API 테스트:  http://localhost:${PORT}/api/health');
    console.log(`  💾 데이터베이스: ${DB_PATH}`);
    console.log('');
    console.log('  기본 계정: admin / DevPass123!');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
});

// 에러 핸들러
process.on('uncaughtException', (err) => {
    console.error('❌ 예기치 않은 오류:', err);
    db.close();
    process.exit(1);
});

module.exports = app;
