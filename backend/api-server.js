// Oracle 전용 Y711 FMS 서버 (SQLite 제거)
// 항공편: ATFM_FLIGHTPLAN, 설정: 하드코딩

const express = require('express');
const oracledb = require('oracledb');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 7300;

// ============================================
// 당일 데이터 파일 영속화 유틸
// ============================================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function _todayKey() {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function loadDayData(prefix) {
    const file = path.join(DATA_DIR, `${prefix}_${_todayKey()}.json`);
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {}
    return [];
}

function saveDayData(prefix, data) {
    const file = path.join(DATA_DIR, `${prefix}_${_todayKey()}.json`);
    try { fs.writeFileSync(file, JSON.stringify(data), 'utf8'); } catch (e) {
        console.error(`[persist] ${prefix} 저장 실패:`, e.message);
    }
}

// ============================================
// 미들웨어
// ============================================
app.use(cors());
app.use(express.json());

// dist 폴더가 있으면 정적 파일 서빙 (프로덕션 모드)
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    console.log('📁 정적 파일 서빙: dist/');
}

// ============================================
// Oracle 설정 (Oracle 11g - Thick Mode)
// ============================================
let oraclePool = null;

async function initOracle() {
    try {
        const clientPath = process.env.ORACLE_CLIENT_PATH;
        if (clientPath) {
            oracledb.initOracleClient({ libDir: clientPath });
            console.log('✅ Oracle Client 초기화 (Thick Mode):', clientPath);
        }

        oraclePool = await oracledb.createPool({
            user: process.env.ORACLE_USER,
            password: process.env.ORACLE_PASSWORD,
            connectString: process.env.ORACLE_CONNECT_STRING,
            poolMin: 1,
            poolMax: 5,
            poolIncrement: 1
        });
        console.log('✅ Oracle 연결 풀 생성 완료');
    } catch (err) {
        console.error('❌ Oracle 초기화 실패:', err.message);
        process.exit(1);
    }
}

async function getOracleConnection() {
    if (!oraclePool) return null;
    try {
        return await oraclePool.getConnection();
    } catch (err) {
        console.error('Oracle 연결 실패:', err.message);
        return null;
    }
}

// ============================================
// 하드코딩 설정 데이터
// ============================================
const SETTINGS = {
    airports: [
        { icao: 'RKSS', name_ko: '김포', merge_point: 'BULTI', dep_interval: 4, gate_to_runway_min: 10, runway_takeoff_min: 2 },
        { icao: 'RKTU', name_ko: '청주', merge_point: 'MEKIL', dep_interval: 10, gate_to_runway_min: 10, runway_takeoff_min: 2 },
        { icao: 'RKJK', name_ko: '군산', merge_point: 'MANGI', dep_interval: 10, gate_to_runway_min: 10, runway_takeoff_min: 2 },
        { icao: 'RKJJ', name_ko: '광주', merge_point: 'DALSU', dep_interval: 10, gate_to_runway_min: 10, runway_takeoff_min: 2 }
    ],
    segments: [
        { from_icao: 'RKSS', to_waypoint: 'BULTI', duration_min: 8 },
        { from_icao: 'RKTU', to_waypoint: 'MEKIL', duration_min: 7 },
        { from_icao: 'RKJK', to_waypoint: 'MANGI', duration_min: 3 },
        { from_icao: 'RKJJ', to_waypoint: 'DALSU', duration_min: 1 }
    ],
    waypoints: [
        { from_wp: 'BULTI', to_wp: 'MEKIL', duration_min: 2, seq: 1 },
        { from_wp: 'MEKIL', to_wp: 'GONAX', duration_min: 2, seq: 2 },
        { from_wp: 'GONAX', to_wp: 'BEDES', duration_min: 2, seq: 3 },
        { from_wp: 'BEDES', to_wp: 'ELPOS', duration_min: 3, seq: 4 },
        { from_wp: 'ELPOS', to_wp: 'MANGI', duration_min: 4, seq: 5 },
        { from_wp: 'MANGI', to_wp: 'DALSU', duration_min: 2, seq: 6 },
        { from_wp: 'DALSU', to_wp: 'NULDI', duration_min: 2, seq: 7 },
        { from_wp: 'NULDI', to_wp: 'DOTOL', duration_min: 3, seq: 8 },
        { from_wp: 'DOTOL', to_wp: 'RKPC', duration_min: 5, seq: 9 }
    ],
    conflictZones: [
        { waypoint: 'MEKIL', name: 'MEKIL Convergence', separation_min: 3 },
        { waypoint: 'MANGI', name: 'MANGI Convergence', separation_min: 3 },
        { waypoint: 'DALSU', name: 'DALSU Convergence', separation_min: 3 }
    ]
};

// 사용자 인증 정보 (환경변수 또는 기본값)
const AUTH_USER = {
    id: 1,
    username: process.env.AUTH_USERNAME || 'admin',
    passwordHash: crypto.createHash('sha256').update(process.env.AUTH_PASSWORD || 'DevPass123!').digest('hex')
};

// ============================================
// 유틸리티 함수
// ============================================
function parseExfixtime(exfixtime) {
    if (!exfixtime) return [];
    return exfixtime.split('|').map(part => {
        const [name, time] = part.split('-');
        const timeSec = timeStrToSec(time);
        return { name, time, timeSec };
    });
}

function timeStrToSec(hhmm) {
    if (!hhmm) return 0;
    const s = String(hhmm).padStart(4, '0');
    return parseInt(s.slice(0, 2)) * 3600 + parseInt(s.slice(2)) * 60;
}

function padTime(num) {
    if (num === null || num === undefined) return null;
    return String(num).padStart(4, '0');
}

function eobtToDate(eobd, eobt) {
    if (!eobd || eobt === null || eobt === undefined) return null;
    const dateStr = String(eobd);
    const timeStr = padTime(eobt);
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(4, 6);
    const day = dateStr.slice(6, 8);
    const hour = timeStr.slice(0, 2);
    const min = timeStr.slice(2, 4);
    return new Date(`${year}-${month}-${day}T${hour}:${min}:00Z`);
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

    if (parseInt(userId) === AUTH_USER.id && username === AUTH_USER.username) {
        req.userId = AUTH_USER.id;
        req.username = AUTH_USER.username;
        next();
    } else {
        return res.status(401).json({ success: false, error: '인증 실패' });
    }
}

// ============================================
// 인증 API
// ============================================
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, error: '사용자명과 비밀번호가 필요합니다' });
    }

    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

    if (username === AUTH_USER.username && passwordHash === AUTH_USER.passwordHash) {
        res.json({
            success: true,
            user: { id: AUTH_USER.id, username: AUTH_USER.username }
        });
    } else {
        res.status(401).json({ success: false, error: '사용자명 또는 비밀번호가 올바르지 않습니다' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.json({ success: true, message: '로그아웃되었습니다' });
});

app.get('/api/auth/me', authenticateUser, (req, res) => {
    res.json({ success: true, user: { id: req.userId, username: req.username } });
});

// ============================================
// 설정 API (하드코딩 데이터 반환)
// ============================================
app.get('/api/v2/settings/airports', (req, res) => {
    res.json({ success: true, data: SETTINGS.airports });
});

app.put('/api/v2/settings/airports/:icao', (req, res) => {
    const { icao } = req.params;
    const { name_ko, merge_point, dep_interval, gate_to_runway_min, runway_takeoff_min } = req.body;
    const airport = SETTINGS.airports.find(a => a.icao === icao);
    if (airport) {
        airport.name_ko = name_ko;
        airport.merge_point = merge_point;
        airport.dep_interval = dep_interval;
        if (gate_to_runway_min !== undefined) airport.gate_to_runway_min = gate_to_runway_min;
        if (runway_takeoff_min !== undefined) airport.runway_takeoff_min = runway_takeoff_min;
        res.json({ success: true, changes: 1 });
    } else {
        res.status(404).json({ success: false, error: '공항 없음' });
    }
});

app.get('/api/v2/settings/segments', (req, res) => {
    res.json({ success: true, data: SETTINGS.segments });
});

app.put('/api/v2/settings/segments', (req, res) => {
    const { from_icao, to_waypoint, duration_min } = req.body;
    const segment = SETTINGS.segments.find(s => s.from_icao === from_icao && s.to_waypoint === to_waypoint);
    if (segment) {
        segment.duration_min = duration_min;
    } else {
        SETTINGS.segments.push({ from_icao, to_waypoint, duration_min });
    }
    res.json({ success: true });
});

app.get('/api/v2/settings/waypoints', (req, res) => {
    res.json({ success: true, data: SETTINGS.waypoints });
});

app.put('/api/v2/settings/waypoints', (req, res) => {
    const { from_wp, to_wp, duration_min } = req.body;
    const waypoint = SETTINGS.waypoints.find(w => w.from_wp === from_wp && w.to_wp === to_wp);
    if (waypoint) {
        waypoint.duration_min = duration_min;
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, error: '해당 구간 없음' });
    }
});

app.get('/api/v2/settings/conflict-zones', (req, res) => {
    res.json({ success: true, data: SETTINGS.conflictZones });
});

app.put('/api/v2/settings/conflict-zones/:wp', (req, res) => {
    const { wp } = req.params;
    const { separation_min } = req.body;
    const zone = SETTINGS.conflictZones.find(z => z.waypoint === wp);
    if (zone) {
        zone.separation_min = separation_min;
        res.json({ success: true, changes: 1 });
    } else {
        res.status(404).json({ success: false, error: '충돌 구역 없음' });
    }
});

// ============================================
// 항공편 API (Oracle ATFM_FLIGHTPLAN)
// ============================================
app.get('/api/v2/flights/today', authenticateUser, async (req, res) => {
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 3600 * 1000);
    const kstDow = kstNow.getUTCDay() === 0 ? 7 : kstNow.getUTCDay();
    const todayStr = kstNow.toISOString().slice(0, 10);

    const oraConn = await getOracleConnection();
    if (!oraConn) {
        return res.status(500).json({ success: false, error: 'Oracle 연결 실패' });
    }

    try {
        const result = await oraConn.execute(`
            SELECT CALLSIGN, DEPT_AIRPORT_CD, DEST_AIRPORT_CD,
                   EOBD, EOBT, ATD, REQUEST_FLIGHT_LEVEL, EXFIXTIME, AIRCRAFT_TYPE
            FROM ATFM_FLIGHTPLAN
            WHERE DEPT_AIRPORT_CD IN ('RKSS', 'RKTU', 'RKJJ', 'RKJK')
              AND DEST_AIRPORT_CD = 'RKPC'
              AND ISOLD = 'F'
            ORDER BY EOBT ASC
        `);

        const flights = result.rows.map((row, idx) => {
            const callsign = row[0] || '';
            const eobd = row[3];
            const eobt = row[4];
            const atd = row[5];
            const exfixtime = row[7];

            const eobtUtcStr = padTime(eobt);
            const atdUtcStr = atd ? padTime(atd) : null;

            // 고유 ID: CALLSIGN + EOBD + EOBT 조합 (순서 변경에도 안전)
            return {
                id: `ora_${eobd}_${callsign}_${eobtUtcStr}`,
                callsign: row[0],
                dept: row[1],
                dest: row[2],
                eobd: eobd,
                eobt: eobtUtcStr,
                eobtUtc: eobtUtcStr,
                ctot: eobtUtcStr,
                atd: atdUtcStr,
                atdUtc: atdUtcStr,
                cfl: row[6] || '',
                actype: row[8] || '',
                status: atd ? 'DEP' : 'SCH',
                day_of_week: kstDow,
                routeWaypoints: parseExfixtime(exfixtime),
                exfixtime: exfixtime
            };
        });

        await oraConn.close();
        res.json({
            success: true,
            data: flights,
            date: todayStr,
            kstDow,
            count: flights.length,
            source: 'oracle'
        });
    } catch (err) {
        console.error('Oracle 조회 오류:', err.message);
        try { await oraConn.close(); } catch (e) {}
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// ATD 저장 API (당일 파일 영속화)
// ============================================
const atdHistory = loadDayData('atd');

app.post('/api/v2/atd', authenticateUser, (req, res) => {
    const { flightId, atd, prevAtd, reason } = req.body;
    if (!flightId || !atd) {
        return res.status(400).json({ success: false, error: 'flightId, atd 필요' });
    }

    const entry = {
        id: atdHistory.length + 1,
        flight_id: flightId,
        prev_atd: prevAtd || null,
        new_atd: atd,
        changed_by: req.username,
        changed_at: new Date().toISOString(),
        reason: reason || 'manual'
    };
    atdHistory.push(entry);
    saveDayData('atd', atdHistory);

    res.json({ success: true, id: entry.id });
});

app.get('/api/v2/audit', authenticateUser, (req, res) => {
    const userHistory = atdHistory.filter(h => h.changed_by === req.username).slice(-100);
    res.json({ success: true, data: userHistory.reverse() });
});

app.delete('/api/v2/reset', authenticateUser, (req, res) => {
    atdHistory.length = 0;
    changeLog.length = 0;
    saveDayData('atd', atdHistory);
    saveDayData('changelog', changeLog);
    res.json({ success: true });
});

// 현재 UTC 시각 이후 ATD를 가진 항공편의 ATD를 NULL로 초기화
app.post('/api/v2/atd/reset-future', authenticateUser, async (req, res) => {
    const now = new Date();
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    const currentHHMM = hh + mm;

    const eobd = now.getUTCFullYear() * 10000
        + (now.getUTCMonth() + 1) * 100
        + now.getUTCDate();

    const oraConn = await getOracleConnection();
    if (!oraConn) return res.status(500).json({ success: false, error: 'Oracle 연결 실패' });

    try {
        const result = await oraConn.execute(
            `UPDATE ATFM_FLIGHTPLAN SET ATD = NULL
             WHERE EOBD = :eobd
               AND ISOLD = 'F'
               AND ATD IS NOT NULL
               AND ATD > :currentHHMM`, /* ATD는 'HHMM' 4자리 zero-padded 문자열 → 사전순 비교 = 시간순 비교 */
            { eobd, currentHHMM },
            { autoCommit: true }
        );
        await oraConn.close();
        console.log(`[ATD reset] ${result.rowsAffected}편 ATD 삭제 (기준: ${currentHHMM} UTC)`);
        res.json({ success: true, cleared: result.rowsAffected, basedOn: currentHHMM });
    } catch (err) {
        try { await oraConn.close(); } catch (e) {}
        console.error('[ATD reset] 오류:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 변경 로그 API (당일 파일 영속화)
// ============================================
const changeLog = loadDayData('changelog');

app.post('/api/v2/change-log', (req, res) => {
    const { event_type, flight_id, callsign, dept, prev_value, new_value, cascade_diffs, reason } = req.body;
    if (!event_type) {
        return res.status(400).json({ success: false, error: 'event_type 필요' });
    }

    const entry = {
        id: changeLog.length + 1,
        event_type,
        flight_id: flight_id || null,
        callsign: callsign || null,
        dept: dept || null,
        prev_value: prev_value || null,
        new_value: new_value || null,
        cascade_diffs: cascade_diffs || null,
        reason: reason || null,
        occurred_at: new Date().toISOString()
    };
    changeLog.push(entry);
    saveDayData('changelog', changeLog);

    res.json({ success: true, id: entry.id });
});

app.get('/api/v2/change-log', (req, res) => {
    // 오늘 로그만 반환
    const today = new Date().toISOString().slice(0, 10);
    const todayLogs = changeLog.filter(l => l.occurred_at.startsWith(today)).slice(-200);
    res.json({ success: true, data: todayLogs.reverse() });
});

// ============================================
// 헬스 체크
// ============================================
app.get('/api/health', async (req, res) => {
    const oraConn = await getOracleConnection();
    const oracleOk = !!oraConn;
    if (oraConn) {
        try { await oraConn.close(); } catch (e) {}
    }

    res.json({
        success: true,
        message: 'Y711 FMS 서버 정상 작동 중',
        database: 'Oracle',
        oracleConnected: oracleOk
    });
});

// ============================================
// SPA 라우팅 (프로덕션 모드)
// ============================================
if (fs.existsSync(distPath)) {
    app.get('/', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
    app.get('/login.html', (req, res) => res.sendFile(path.join(distPath, 'login.html')));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

// ============================================
// 서버 시작
// ============================================
initOracle().then(() => {
    app.listen(PORT, '127.0.0.1', () => {
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('  ✈️  Y711 FMS (제주공항 흐름 관리 시스템) - Oracle Only');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
        console.log(`  🌐 로컬 접속:   http://localhost:7301/`);
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
    });
});

process.on('uncaughtException', (err) => {
    console.error('❌ 예기치 않은 오류:', err);
    process.exit(1);
});

module.exports = app;
