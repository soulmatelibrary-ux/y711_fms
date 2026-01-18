// Express + Oracle DB 연동 서버 (예시)
// 실제 운영 시 사용할 백엔드 API 서버

const express = require('express');
const oracledb = require('oracledb');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

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

// 서버 시작
app.listen(PORT, () => {
    console.log(`✈️  Y711 FMS API 서버 실행 중: http://localhost:${PORT}`);
    console.log(`📊 DB 연결 테스트: http://localhost:${PORT}/api/db/test`);
});

module.exports = app;
