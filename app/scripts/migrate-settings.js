/**
 * Phase 1: fms.db에 설정 테이블 생성 및 초기값 삽입
 * 실행: node acc-v2/scripts/migrate-settings.js  (y711_fms/ 루트에서)
 *       또는 cd acc-v2 && npm run migrate
 */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, '../../fms.db');
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) { console.error('DB 연결 실패:', err); process.exit(1); }
    console.log('✅ DB 연결:', DB_PATH);
});

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

async function migrate() {
    console.log('\n--- 설정 테이블 생성 ---');

    await run(`
        CREATE TABLE IF NOT EXISTS airport_settings (
            icao         TEXT PRIMARY KEY,
            name_ko      TEXT,
            merge_point  TEXT,
            dep_interval INTEGER DEFAULT 4,
            updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ airport_settings');

    await run(`
        CREATE TABLE IF NOT EXISTS segment_times (
            from_icao    TEXT,
            to_waypoint  TEXT,
            duration_min INTEGER,
            updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (from_icao, to_waypoint)
        )
    `);
    console.log('✅ segment_times');

    await run(`
        CREATE TABLE IF NOT EXISTS waypoint_chain (
            from_wp      TEXT,
            to_wp        TEXT,
            duration_min INTEGER,
            seq          INTEGER DEFAULT 0,
            PRIMARY KEY (from_wp, to_wp)
        )
    `);
    console.log('✅ waypoint_chain');

    await run(`
        CREATE TABLE IF NOT EXISTS conflict_zones (
            waypoint        TEXT PRIMARY KEY,
            name            TEXT,
            separation_min  INTEGER DEFAULT 3,
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ conflict_zones');

    await run(`
        CREATE TABLE IF NOT EXISTS atd_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            flight_id   TEXT,
            prev_atd    TEXT,
            new_atd     TEXT,
            changed_by  TEXT,
            changed_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            reason      TEXT,
            source      TEXT DEFAULT 'manual'
        )
    `);
    console.log('✅ atd_history');

    await run(`
        CREATE TABLE IF NOT EXISTS advisory_log (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            flight_id        TEXT,
            callsign         TEXT,
            dept_icao        TEXT,
            recommended_time TEXT,
            prev_time        TEXT,
            issued_by        TEXT,
            issued_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
            channel          TEXT DEFAULT 'hotline',
            reason           TEXT,
            acknowledged_at  DATETIME
        )
    `);
    console.log('✅ advisory_log');

    console.log('\n--- 초기 데이터 삽입 (INSERT OR IGNORE) ---');

    // 공항 설정 (ctot.js airportDatabase + segmentConfig 기준)
    const airports = [
        ['RKSS', '김포', 'BULTI', 4],
        ['RKTU', '청주', 'MEKIL', 10],
        ['RKJK', '군산', 'MANGI', 10],
        ['RKJJ', '광주', 'DALSU', 10],
    ];
    for (const [icao, nameKo, mergePoint, depInterval] of airports) {
        await run(
            'INSERT OR IGNORE INTO airport_settings (icao, name_ko, merge_point, dep_interval) VALUES (?,?,?,?)',
            [icao, nameKo, mergePoint, depInterval]
        );
    }
    console.log('✅ airport_settings 초기값 4개');

    // 구간 통과시간 (ctot.js segmentConfig)
    const segments = [
        ['RKSS', 'BULTI', 8],
        ['RKTU', 'MEKIL', 7],
        ['RKJK', 'MANGI', 3],
        ['RKJJ', 'DALSU', 1],
    ];
    for (const [from, to, dur] of segments) {
        await run(
            'INSERT OR IGNORE INTO segment_times (from_icao, to_waypoint, duration_min) VALUES (?,?,?)',
            [from, to, dur]
        );
    }
    console.log('✅ segment_times 초기값 4개');

    // 웨이포인트 체인 (ctot.js waypoints)
    const chain = [
        ['BULTI', 'MEKIL', 2, 1],
        ['MEKIL', 'GONAX', 2, 2],
        ['GONAX', 'BEDES', 2, 3],
        ['BEDES', 'ELPOS', 3, 4],
        ['ELPOS', 'MANGI', 4, 5],
        ['MANGI', 'DALSU', 2, 6],
        ['DALSU', 'NULDI', 2, 7],
        ['NULDI', 'DOTOL', 3, 8],
        ['DOTOL', 'RKPC',  5, 9],
    ];
    for (const [from, to, dur, seq] of chain) {
        await run(
            'INSERT OR IGNORE INTO waypoint_chain (from_wp, to_wp, duration_min, seq) VALUES (?,?,?,?)',
            [from, to, dur, seq]
        );
    }
    console.log('✅ waypoint_chain 초기값 9개');

    // 충돌 감지 구역
    const zones = [
        ['MEKIL', 'MEKIL Convergence', 3],
        ['MANGI', 'MANGI Convergence', 3],
        ['DALSU', 'DALSU Convergence', 3],
    ];
    for (const [wp, name, sep] of zones) {
        await run(
            'INSERT OR IGNORE INTO conflict_zones (waypoint, name, separation_min) VALUES (?,?,?)',
            [wp, name, sep]
        );
    }
    console.log('✅ conflict_zones 초기값 3개');

    console.log('\n✅ 마이그레이션 완료\n');
    db.close();
}

migrate().catch(err => {
    console.error('❌ 마이그레이션 실패:', err);
    db.close();
    process.exit(1);
});
