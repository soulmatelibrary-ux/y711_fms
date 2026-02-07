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
        return res.status(401).json({
            success: false,
            error: '인증 필요'
        });
    }

    // 실제 프로덕션에서는 토큰 검증 필요
    req.userId = parseInt(userId);
    req.username = username;
    next();
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
    res.json({
        success: true,
        message: '로그아웃되었습니다'
    });
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
