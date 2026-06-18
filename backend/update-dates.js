const oracledb = require('oracledb');
require('dotenv').config();

async function updateDates() {
    oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_PATH });

    const conn = await oracledb.getConnection({
        user: process.env.ORACLE_USER,
        password: process.env.ORACLE_PASSWORD,
        connectString: process.env.ORACLE_CONNECT_STRING
    });

    // 오늘 날짜 (YYYYMMDD 형식)
    const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
    console.log('오늘 날짜:', today);

    // EOBD를 오늘 날짜로 업데이트 (ISOLD='F'인 항목만)
    const result = await conn.execute(
        `UPDATE ATFM_FLIGHTPLAN SET EOBD = :today WHERE ISOLD = 'F'`,
        { today },
        { autoCommit: true }
    );

    console.log('업데이트된 행 수:', result.rowsAffected);

    // 확인 조회
    const check = await conn.execute(`
        SELECT COUNT(*) as cnt FROM ATFM_FLIGHTPLAN
        WHERE DEPT_AIRPORT_CD IN ('RKSS', 'RKTU', 'RKJJ', 'RKJK')
          AND DEST_AIRPORT_CD = 'RKPC'
          AND ISOLD = 'F'
    `);
    console.log('조회 가능한 항공편 수:', check.rows[0][0]);

    // 샘플 데이터 확인
    const sample = await conn.execute(`
        SELECT CALLSIGN, DEPT_AIRPORT_CD, EOBD, EOBT, ISOLD
        FROM ATFM_FLIGHTPLAN
        WHERE DEPT_AIRPORT_CD IN ('RKSS', 'RKTU', 'RKJJ', 'RKJK')
          AND DEST_AIRPORT_CD = 'RKPC'
          AND ISOLD = 'F'
          AND ROWNUM <= 5
    `);
    console.log('\n샘플 데이터:');
    sample.rows.forEach(row => {
        console.log(`  ${row[0]} | ${row[1]} | EOBD: ${row[2]} | EOBT: ${row[3]} | ISOLD: ${row[4]}`);
    });

    await conn.close();
    console.log('\n완료!');
}

updateDates().catch(e => console.error('Error:', e));
