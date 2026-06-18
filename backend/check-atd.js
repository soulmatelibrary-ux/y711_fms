const oracledb = require('oracledb');
require('dotenv').config();

async function checkATD() {
    oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_PATH });

    const conn = await oracledb.getConnection({
        user: process.env.ORACLE_USER,
        password: process.env.ORACLE_PASSWORD,
        connectString: process.env.ORACLE_CONNECT_STRING
    });

    // ATD 있는 항공편 (출발 완료)
    const withATD = await conn.execute(`
        SELECT COUNT(*) FROM ATFM_FLIGHTPLAN
        WHERE DEPT_AIRPORT_CD IN ('RKSS', 'RKTU', 'RKJJ', 'RKJK')
          AND DEST_AIRPORT_CD = 'RKPC'
          AND ISOLD = 'F'
          AND ATD IS NOT NULL
    `);
    console.log('ATD 있는 항공편 (출발 완료):', withATD.rows[0][0]);

    // ATD 없는 항공편 (미출발)
    const withoutATD = await conn.execute(`
        SELECT COUNT(*) FROM ATFM_FLIGHTPLAN
        WHERE DEPT_AIRPORT_CD IN ('RKSS', 'RKTU', 'RKJJ', 'RKJK')
          AND DEST_AIRPORT_CD = 'RKPC'
          AND ISOLD = 'F'
          AND ATD IS NULL
    `);
    console.log('ATD 없는 항공편 (미출발):', withoutATD.rows[0][0]);

    // 샘플: ATD 있는 것
    console.log('\n[ATD 있는 샘플]');
    const sampleWithATD = await conn.execute(`
        SELECT CALLSIGN, DEPT_AIRPORT_CD, EOBT, ATD, EXFIXTIME
        FROM ATFM_FLIGHTPLAN
        WHERE DEPT_AIRPORT_CD IN ('RKSS', 'RKTU', 'RKJJ', 'RKJK')
          AND DEST_AIRPORT_CD = 'RKPC'
          AND ISOLD = 'F'
          AND ATD IS NOT NULL
          AND ROWNUM <= 3
    `);
    sampleWithATD.rows.forEach(row => {
        console.log(`  ${row[0]} | ${row[1]} | EOBT: ${row[2]} | ATD: ${row[3]}`);
    });

    // 샘플: ATD 없는 것
    console.log('\n[ATD 없는 샘플]');
    const sampleWithoutATD = await conn.execute(`
        SELECT CALLSIGN, DEPT_AIRPORT_CD, EOBT, ATD
        FROM ATFM_FLIGHTPLAN
        WHERE DEPT_AIRPORT_CD IN ('RKSS', 'RKTU', 'RKJJ', 'RKJK')
          AND DEST_AIRPORT_CD = 'RKPC'
          AND ISOLD = 'F'
          AND ATD IS NULL
          AND ROWNUM <= 3
    `);
    sampleWithoutATD.rows.forEach(row => {
        console.log(`  ${row[0]} | ${row[1]} | EOBT: ${row[2]} | ATD: ${row[3]}`);
    });

    await conn.close();
}

checkATD().catch(e => console.error('Error:', e));
