// Express + Oracle DB 연동 서버
// Y711 FMS - 제주공항 흐름 관리 시스템
// 프로덕션 및 개발 환경 모두에서 사용 가능

const express = require('express');
const oracledb = require('oracledb');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// 환경 변수 로드
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 7300;

// Middleware
app.use(cors());
app.use(express.json());

// 정적 파일 서빙 (Vite 빌드 산출물)
app.use(express.static(path.join(__dirname, 'dist')));

// SPA 라우팅 지원 (index.html fallback)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// login.html 라우팅
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'login.html'));
});

// Oracle DB 연결 설정
const dbConfig = {
    user: process.env.ORACLE_USER || 'your_username',
    password: process.env.ORACLE_PASSWORD || 'your_password',
    connectString: process.env.ORACLE_CONNECT_STRING || 'localhost:1521/ORCL'
};

// Oracle Instant Client 설정 (필요한 경우)
// oracledb.initOracleClient({ libDir: '/path/to/instantclient' });

/**
 * API: 선택된 공항의 비행계획서 조회
 * GET /api/flights?airports=RKSS,RKTU&date=2026-01-16
 */
app.get('/api/flights', async (req, res) => {
    let connection;

    try {
        const { airports, date } = req.query;

        if (!airports) {
            return res.status(400).json({ error: '공항 코드가 필요합니다.' });
        }

        const airportList = airports.split(',');
        const placeholders = airportList.map((_, i) => `:${i + 1}`).join(',');

        connection = await oracledb.getConnection(dbConfig);

        // 실제 테이블 구조에 맞게 쿼리 수정 필요
        const query = `
            SELECT 
                CALLSIGN,
                DEPARTURE_AIRPORT,
                TO_CHAR(EOBT, 'HH24:MI') as EOBT,
                FLIGHT_LEVEL,
                DESTINATION_AIRPORT
            FROM FLIGHT_PLANS
            WHERE DEPARTURE_AIRPORT IN (${placeholders})
              AND DESTINATION_AIRPORT = 'RKPC'
              AND TRUNC(EOBT) = TO_DATE(:dateParam, 'YYYY-MM-DD')
            ORDER BY DEPARTURE_AIRPORT, EOBT
        `;

        const binds = [...airportList, date || '2026-01-16'];

        const result = await connection.execute(query, binds, {
            outFormat: oracledb.OUT_FORMAT_OBJECT
        });

        // 결과 가공
        const flights = result.rows.map(row => ({
            id: row.CALLSIGN,
            airport: row.DEPARTURE_AIRPORT,
            eobt: row.EOBT,
            ctot: row.EOBT, // 초기값
            delay: 0,
            status: 'On Time',
            altitude: parseInt(row.FLIGHT_LEVEL.replace('FL', '')),
            flightLevel: row.FLIGHT_LEVEL
        }));

        res.json({
            success: true,
            count: flights.length,
            flights: flights
        });

    } catch (error) {
        console.error('DB 조회 오류:', error);
        res.status(500).json({
            error: 'DB 조회 실패',
            message: error.message
        });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error('연결 종료 오류:', err);
            }
        }
    }
});

/**
 * API: CTOT 계산 결과 저장
 * POST /api/ctot
 */
app.post('/api/ctot', async (req, res) => {
    let connection;

    try {
        const { flights } = req.body;

        if (!flights || !Array.isArray(flights)) {
            return res.status(400).json({ error: '항공편 데이터가 필요합니다.' });
        }

        connection = await oracledb.getConnection(dbConfig);

        // 트랜잭션 시작
        for (const flight of flights) {
            const query = `
                INSERT INTO CTOT_RESULTS (
                    CALLSIGN,
                    DEPARTURE_AIRPORT,
                    CTOT,
                    DELAY_MINUTES,
                    STATUS,
                    CALC_TIME
                ) VALUES (
                    :callsign,
                    :airport,
                    TO_TIMESTAMP(:ctot, 'HH24:MI'),
                    :delay,
                    :status,
                    SYSTIMESTAMP
                )
            `;

            await connection.execute(query, {
                callsign: flight.id,
                airport: flight.airport,
                ctot: flight.ctot,
                delay: flight.delay,
                status: flight.status
            });
        }

        await connection.commit();

        res.json({
            success: true,
            message: `${flights.length}개 항공편 CTOT 저장 완료`
        });

    } catch (error) {
        console.error('CTOT 저장 오류:', error);
        if (connection) {
            await connection.rollback();
        }
        res.status(500).json({
            error: 'CTOT 저장 실패',
            message: error.message
        });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error('연결 종료 오류:', err);
            }
        }
    }
});

/**
 * API: DB 연결 테스트
 * GET /api/db/test
 */
app.get('/api/db/test', async (req, res) => {
    let connection;

    try {
        connection = await oracledb.getConnection(dbConfig);

        const result = await connection.execute(
            'SELECT SYSDATE FROM DUAL',
            [],
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        res.json({
            success: true,
            message: 'DB 연결 성공',
            serverTime: result.rows[0].SYSDATE
        });

    } catch (error) {
        console.error('DB 연결 오류:', error);
        res.status(500).json({
            success: false,
            error: 'DB 연결 실패',
            message: error.message
        });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error('연결 종료 오류:', err);
            }
        }
    }
});

/**
 * API: 공항 정보 조회
 * GET /api/airports
 */
app.get('/api/airports', async (req, res) => {
    let connection;

    try {
        connection = await oracledb.getConnection(dbConfig);

        const query = `
            SELECT 
                AIRPORT_CODE,
                AIRPORT_NAME,
                MERGE_POINT,
                DURATION_MINUTES
            FROM AIRPORT_CONFIG
            WHERE IS_ACTIVE = 'Y'
            ORDER BY AIRPORT_CODE
        `;

        const result = await connection.execute(query, [], {
            outFormat: oracledb.OUT_FORMAT_OBJECT
        });

        const airports = result.rows.map(row => ({
            code: row.AIRPORT_CODE,
            name: row.AIRPORT_NAME,
            mergePoint: row.MERGE_POINT,
            duration: row.DURATION_MINUTES
        }));

        res.json({
            success: true,
            airports: airports
        });

    } catch (error) {
        console.error('공항 정보 조회 오류:', error);
        res.status(500).json({
            error: '공항 정보 조회 실패',
            message: error.message
        });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error('연결 종료 오류:', err);
            }
        }
    }
});

// SPA routing: catch-all and send index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// 서버 시작 (모든 네트워크 인터페이스에서 수신)
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  ✈️  Y711 FMS (제주공항 흐름 관리 시스템) 실행 중');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log(`  🌐 로컬 접속:   http://localhost:${PORT}/`);
    console.log(`  🌐 외부 접속:   http://ssenalabs.iptime.org:${PORT}/`);
    console.log('');
    console.log(`  📊 API 테스트:  http://localhost:${PORT}/api/db/test`);
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('')
});

module.exports = app;
