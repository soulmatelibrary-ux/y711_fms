/**
 * Oracle 11g 테이블 초기화 스크립트
 * SQLite 대신 Oracle만 사용하도록 필요한 테이블 생성
 */
const oracledb = require('oracledb');
require('dotenv').config();

async function initOracleTables() {
    // Thick 모드 초기화
    const clientPath = process.env.ORACLE_CLIENT_PATH;
    if (clientPath) {
        oracledb.initOracleClient({ libDir: clientPath });
        console.log('Oracle Client 초기화:', clientPath);
    }

    const conn = await oracledb.getConnection({
        user: process.env.ORACLE_USER,
        password: process.env.ORACLE_PASSWORD,
        connectString: process.env.ORACLE_CONNECT_STRING
    });

    console.log('Oracle 연결됨\n');

    // 테이블/시퀀스/트리거 생성 함수
    async function execIgnore(ddl, ignoreCodes = [955, 2289, 4080, 1430]) {
        try {
            await conn.execute(ddl);
            return true;
        } catch (err) {
            if (ignoreCodes.includes(err.errorNum)) {
                return false; // 이미 존재
            }
            throw err;
        }
    }

    // 데이터 삽입 함수 (중복 무시)
    async function insertIgnore(sql, params) {
        try {
            await conn.execute(sql, params);
            return true;
        } catch (err) {
            if (err.errorNum !== 1) { // ORA-00001: unique constraint violated
                console.error('Insert error:', err.message);
            }
            return false;
        }
    }

    // ============================================
    // 1. 사용자 테이블
    // ============================================
    console.log('FMS_USERS 테이블 생성 중...');

    if (await execIgnore(`
        CREATE TABLE FMS_USERS (
            ID NUMBER PRIMARY KEY,
            USERNAME VARCHAR2(100) UNIQUE NOT NULL,
            PASSWORD_HASH VARCHAR2(256) NOT NULL,
            EMAIL VARCHAR2(200),
            CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `)) {
        console.log('✅ FMS_USERS 테이블 생성됨');
    } else {
        console.log('⏭️  FMS_USERS 테이블 이미 존재');
    }

    // 시퀀스
    if (await execIgnore(`CREATE SEQUENCE FMS_USERS_SEQ START WITH 1 INCREMENT BY 1`)) {
        console.log('✅ FMS_USERS_SEQ 시퀀스 생성됨');
    }

    // 트리거 (11g 호환)
    await execIgnore(`
        CREATE OR REPLACE TRIGGER FMS_USERS_TRG
        BEFORE INSERT ON FMS_USERS
        FOR EACH ROW
        BEGIN
            IF :NEW.ID IS NULL THEN
                SELECT FMS_USERS_SEQ.NEXTVAL INTO :NEW.ID FROM DUAL;
            END IF;
        END;
    `, []);

    // ============================================
    // 2. 공항 설정 테이블
    // ============================================
    if (await execIgnore(`
        CREATE TABLE FMS_AIRPORT_SETTINGS (
            ICAO VARCHAR2(10) PRIMARY KEY,
            NAME_KO VARCHAR2(100),
            MERGE_POINT VARCHAR2(20),
            DEP_INTERVAL NUMBER DEFAULT 4,
            UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `)) {
        console.log('✅ FMS_AIRPORT_SETTINGS 테이블 생성됨');
    } else {
        console.log('⏭️  FMS_AIRPORT_SETTINGS 테이블 이미 존재');
    }

    // ============================================
    // 3. 구간 시간 테이블
    // ============================================
    if (await execIgnore(`
        CREATE TABLE FMS_SEGMENT_TIMES (
            FROM_ICAO VARCHAR2(10),
            TO_WAYPOINT VARCHAR2(20),
            DURATION_MIN NUMBER,
            UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (FROM_ICAO, TO_WAYPOINT)
        )
    `)) {
        console.log('✅ FMS_SEGMENT_TIMES 테이블 생성됨');
    } else {
        console.log('⏭️  FMS_SEGMENT_TIMES 테이블 이미 존재');
    }

    // ============================================
    // 4. 웨이포인트 체인 테이블
    // ============================================
    if (await execIgnore(`
        CREATE TABLE FMS_WAYPOINT_CHAIN (
            FROM_WP VARCHAR2(20),
            TO_WP VARCHAR2(20),
            DURATION_MIN NUMBER,
            SEQ NUMBER DEFAULT 0,
            PRIMARY KEY (FROM_WP, TO_WP)
        )
    `)) {
        console.log('✅ FMS_WAYPOINT_CHAIN 테이블 생성됨');
    } else {
        console.log('⏭️  FMS_WAYPOINT_CHAIN 테이블 이미 존재');
    }

    // ============================================
    // 5. 충돌 구역 테이블
    // ============================================
    if (await execIgnore(`
        CREATE TABLE FMS_CONFLICT_ZONES (
            WAYPOINT VARCHAR2(20) PRIMARY KEY,
            NAME VARCHAR2(100),
            SEPARATION_MIN NUMBER DEFAULT 3,
            UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `)) {
        console.log('✅ FMS_CONFLICT_ZONES 테이블 생성됨');
    } else {
        console.log('⏭️  FMS_CONFLICT_ZONES 테이블 이미 존재');
    }

    // ============================================
    // 6. ATD 이력 테이블
    // ============================================
    if (await execIgnore(`
        CREATE TABLE FMS_ATD_HISTORY (
            ID NUMBER PRIMARY KEY,
            FLIGHT_ID VARCHAR2(100),
            PREV_ATD VARCHAR2(10),
            NEW_ATD VARCHAR2(10),
            CHANGED_BY VARCHAR2(100),
            CHANGED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            REASON VARCHAR2(500),
            SOURCE VARCHAR2(50) DEFAULT 'manual'
        )
    `)) {
        console.log('✅ FMS_ATD_HISTORY 테이블 생성됨');
    } else {
        console.log('⏭️  FMS_ATD_HISTORY 테이블 이미 존재');
    }

    if (await execIgnore(`CREATE SEQUENCE FMS_ATD_HISTORY_SEQ START WITH 1 INCREMENT BY 1`)) {
        console.log('✅ FMS_ATD_HISTORY_SEQ 시퀀스 생성됨');
    }

    await execIgnore(`
        CREATE OR REPLACE TRIGGER FMS_ATD_HISTORY_TRG
        BEFORE INSERT ON FMS_ATD_HISTORY
        FOR EACH ROW
        BEGIN
            IF :NEW.ID IS NULL THEN
                SELECT FMS_ATD_HISTORY_SEQ.NEXTVAL INTO :NEW.ID FROM DUAL;
            END IF;
        END;
    `, []);

    // ============================================
    // 7. 변경 로그 테이블
    // ============================================
    if (await execIgnore(`
        CREATE TABLE FMS_CHANGE_LOG (
            ID NUMBER PRIMARY KEY,
            EVENT_TYPE VARCHAR2(100) NOT NULL,
            FLIGHT_ID VARCHAR2(100),
            CALLSIGN VARCHAR2(50),
            DEPT VARCHAR2(10),
            PREV_VALUE VARCHAR2(500),
            NEW_VALUE VARCHAR2(500),
            CASCADE_DIFFS CLOB,
            REASON VARCHAR2(500),
            OCCURRED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `)) {
        console.log('✅ FMS_CHANGE_LOG 테이블 생성됨');
    } else {
        console.log('⏭️  FMS_CHANGE_LOG 테이블 이미 존재');
    }

    if (await execIgnore(`CREATE SEQUENCE FMS_CHANGE_LOG_SEQ START WITH 1 INCREMENT BY 1`)) {
        console.log('✅ FMS_CHANGE_LOG_SEQ 시퀀스 생성됨');
    }

    await execIgnore(`
        CREATE OR REPLACE TRIGGER FMS_CHANGE_LOG_TRG
        BEFORE INSERT ON FMS_CHANGE_LOG
        FOR EACH ROW
        BEGIN
            IF :NEW.ID IS NULL THEN
                SELECT FMS_CHANGE_LOG_SEQ.NEXTVAL INTO :NEW.ID FROM DUAL;
            END IF;
        END;
    `, []);

    // ============================================
    // 초기 데이터 삽입
    // ============================================
    console.log('\n초기 데이터 삽입 중...');

    // 기본 관리자 계정 (SHA256 hash of 'DevPass123!')
    // crypto.createHash('sha256').update('DevPass123!').digest('hex')
    const adminHash = 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3';
    if (await insertIgnore(
        `INSERT INTO FMS_USERS (USERNAME, PASSWORD_HASH, EMAIL) VALUES (:1, :2, :3)`,
        ['admin', adminHash, 'admin@fms.local']
    )) {
        console.log('✅ admin 계정 생성됨');
    } else {
        console.log('⏭️  admin 계정 이미 존재');
    }

    // 공항 설정
    const airports = [
        ['RKSS', '김포', 'BULTI', 4],
        ['RKTU', '청주', 'MEKIL', 10],
        ['RKJK', '군산', 'MANGI', 10],
        ['RKJJ', '광주', 'DALSU', 10]
    ];
    for (const [icao, name, mp, di] of airports) {
        await insertIgnore(
            `INSERT INTO FMS_AIRPORT_SETTINGS (ICAO, NAME_KO, MERGE_POINT, DEP_INTERVAL) VALUES (:1, :2, :3, :4)`,
            [icao, name, mp, di]
        );
    }
    console.log('✅ 공항 설정 삽입 완료');

    // 구간 시간
    const segments = [
        ['RKSS', 'BULTI', 8],
        ['RKTU', 'MEKIL', 7],
        ['RKJK', 'MANGI', 3],
        ['RKJJ', 'DALSU', 1]
    ];
    for (const [f, t, d] of segments) {
        await insertIgnore(
            `INSERT INTO FMS_SEGMENT_TIMES (FROM_ICAO, TO_WAYPOINT, DURATION_MIN) VALUES (:1, :2, :3)`,
            [f, t, d]
        );
    }
    console.log('✅ 구간 시간 삽입 완료');

    // 웨이포인트 체인
    const chain = [
        ['BULTI', 'MEKIL', 2, 1],
        ['MEKIL', 'GONAX', 2, 2],
        ['GONAX', 'BEDES', 2, 3],
        ['BEDES', 'ELPOS', 3, 4],
        ['ELPOS', 'MANGI', 4, 5],
        ['MANGI', 'DALSU', 2, 6],
        ['DALSU', 'NULDI', 2, 7],
        ['NULDI', 'DOTOL', 3, 8],
        ['DOTOL', 'RKPC', 5, 9]
    ];
    for (const [f, t, d, s] of chain) {
        await insertIgnore(
            `INSERT INTO FMS_WAYPOINT_CHAIN (FROM_WP, TO_WP, DURATION_MIN, SEQ) VALUES (:1, :2, :3, :4)`,
            [f, t, d, s]
        );
    }
    console.log('✅ 웨이포인트 체인 삽입 완료');

    // 충돌 구역
    const zones = [
        ['MEKIL', 'MEKIL Convergence', 3],
        ['MANGI', 'MANGI Convergence', 3],
        ['DALSU', 'DALSU Convergence', 3]
    ];
    for (const [w, n, s] of zones) {
        await insertIgnore(
            `INSERT INTO FMS_CONFLICT_ZONES (WAYPOINT, NAME, SEPARATION_MIN) VALUES (:1, :2, :3)`,
            [w, n, s]
        );
    }
    console.log('✅ 충돌 구역 삽입 완료');

    await conn.commit();
    console.log('\n========================================');
    console.log('✅ 모든 테이블 및 초기 데이터 설정 완료!');
    console.log('========================================');

    // 확인
    const userCount = await conn.execute('SELECT COUNT(*) FROM FMS_USERS');
    const airportCount = await conn.execute('SELECT COUNT(*) FROM FMS_AIRPORT_SETTINGS');
    const segmentCount = await conn.execute('SELECT COUNT(*) FROM FMS_SEGMENT_TIMES');
    const waypointCount = await conn.execute('SELECT COUNT(*) FROM FMS_WAYPOINT_CHAIN');
    const zoneCount = await conn.execute('SELECT COUNT(*) FROM FMS_CONFLICT_ZONES');

    console.log(`\n📊 FMS_USERS: ${userCount.rows[0][0]}개`);
    console.log(`📊 FMS_AIRPORT_SETTINGS: ${airportCount.rows[0][0]}개`);
    console.log(`📊 FMS_SEGMENT_TIMES: ${segmentCount.rows[0][0]}개`);
    console.log(`📊 FMS_WAYPOINT_CHAIN: ${waypointCount.rows[0][0]}개`);
    console.log(`📊 FMS_CONFLICT_ZONES: ${zoneCount.rows[0][0]}개`);

    await conn.close();
    console.log('\nOracle 연결 종료');
}

initOracleTables().catch(err => {
    console.error('❌ 초기화 실패:', err);
    process.exit(1);
});
