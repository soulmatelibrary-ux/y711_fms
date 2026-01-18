# Y711 FMS API 서버 사용 가이드

## 📦 설치 방법

### 1. 필요 패키지 설치

```bash
npm install express oracledb cors dotenv
```

### 2. Oracle Instant Client 설치

Oracle 11G에 연결하려면 Oracle Instant Client가 필요합니다.

**macOS:**
```bash
# Homebrew로 설치
brew tap InstantClientTap/instantclient
brew install instantclient-basic
```

**Linux:**
```bash
# RPM 기반
wget https://download.oracle.com/otn_software/linux/instantclient/instantclient-basic-linux.x64-19.x.x.x.zip
unzip instantclient-basic-linux.x64-19.x.x.x.zip
sudo mv instantclient_19_x /opt/oracle/
```

### 3. 환경 변수 설정

`.env` 파일 생성:
```env
ORACLE_USER=your_username
ORACLE_PASSWORD=your_password
ORACLE_CONNECT_STRING=localhost:1521/ORCL
```

### 4. 서버 실행

```bash
node api-server.js
```

---

## 🗄️ 필요한 Oracle DB 테이블 구조

### 1. FLIGHT_PLANS (비행계획서)
```sql
CREATE TABLE FLIGHT_PLANS (
    CALLSIGN VARCHAR2(10) PRIMARY KEY,
    DEPARTURE_AIRPORT CHAR(4) NOT NULL,
    DESTINATION_AIRPORT CHAR(4) NOT NULL,
    EOBT TIMESTAMP NOT NULL,
    FLIGHT_LEVEL VARCHAR2(5),
    AIRCRAFT_TYPE VARCHAR2(4),
    CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 인덱스
CREATE INDEX IDX_FP_DEP_DEST_TIME 
ON FLIGHT_PLANS(DEPARTURE_AIRPORT, DESTINATION_AIRPORT, EOBT);
```

### 2. CTOT_RESULTS (계산 결과)
```sql
CREATE TABLE CTOT_RESULTS (
    ID NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    CALLSIGN VARCHAR2(10) NOT NULL,
    DEPARTURE_AIRPORT CHAR(4) NOT NULL,
    CTOT TIMESTAMP NOT NULL,
    DELAY_MINUTES NUMBER(3),
    STATUS VARCHAR2(20),
    CALC_TIME TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT FK_CTOT_FLIGHT FOREIGN KEY (CALLSIGN) 
        REFERENCES FLIGHT_PLANS(CALLSIGN)
);
```

### 3. AIRPORT_CONFIG (공항 설정)
```sql
CREATE TABLE AIRPORT_CONFIG (
    AIRPORT_CODE CHAR(4) PRIMARY KEY,
    AIRPORT_NAME VARCHAR2(50) NOT NULL,
    MERGE_POINT VARCHAR2(10),
    DURATION_MINUTES NUMBER(3),
    IS_ACTIVE CHAR(1) DEFAULT 'Y',
    COLOR VARCHAR2(20)
);

-- 초기 데이터
INSERT INTO AIRPORT_CONFIG VALUES ('RKSS', '김포', 'GONAX', 25, 'Y', '#58a6ff');
INSERT INTO AIRPORT_CONFIG VALUES ('RKTU', '청주', 'GONAX', 20, 'Y', '#bc8cff');
INSERT INTO AIRPORT_CONFIG VALUES ('RKJK', '군산', 'RINBO', 15, 'Y', '#39c5bb');
INSERT INTO AIRPORT_CONFIG VALUES ('RKJJ', '광주', 'SAMUL', 10, 'Y', '#d29922');
COMMIT;
```

---

## 🔌 API 엔드포인트

### 1. 항공편 조회
```http
GET /api/flights?airports=RKSS,RKTU&date=2026-01-16
```

**응답:**
```json
{
  "success": true,
  "count": 15,
  "flights": [
    {
      "id": "RKSS1234",
      "airport": "RKSS",
      "eobt": "14:30",
      "ctot": "14:30",
      "delay": 0,
      "status": "On Time",
      "altitude": 200,
      "flightLevel": "FL200"
    }
  ]
}
```

### 2. CTOT 저장
```http
POST /api/ctot
Content-Type: application/json

{
  "flights": [
    {
      "id": "RKSS1234",
      "airport": "RKSS",
      "ctot": "14:35",
      "delay": 5,
      "status": "Delayed"
    }
  ]
}
```

### 3. DB 연결 테스트
```http
GET /api/db/test
```

### 4. 공항 정보 조회
```http
GET /api/airports
```

---

## 🔧 프론트엔드 연동

`main.js`에서 Mock 대신 API 호출:

```javascript
// DB에서 항공편 데이터 가져오기
async function fetchFlightsFromDatabase(airport, track) {
    try {
        // 실제 API 호출
        const response = await fetch(
            `/api/flights?airports=${airport}&date=2026-01-16`
        );
        const data = await response.json();
        
        if (data.success) {
            data.flights.forEach(flight => {
                // 타임라인에 항공편 블록 생성
                const flightBlock = createFlightBlock(flight);
                track.appendChild(flightBlock);
                
                // 전역 목록에 추가
                allFlights.push(flight);
            });
        }
    } catch (error) {
        console.error('항공편 조회 실패:', error);
        // Fallback to mock data
        generateMockFlights(airport, track);
    }
}
```

---

## 🐳 Docker 배포

### Dockerfile
```dockerfile
FROM node:18-alpine

# Oracle Instant Client 설치
RUN apk add --no-cache libaio libnsl libc6-compat

WORKDIR /app

# 의존성 설치
COPY package*.json ./
RUN npm ci --production

# 소스 복사
COPY . .

EXPOSE 3000

CMD ["node", "api-server.js"]
```

### docker-compose.yml
```yaml
version: '3.8'
services:
  y711-fms:
    build: .
    ports:
      - "3000:3000"
    environment:
      - ORACLE_USER=${ORACLE_USER}
      - ORACLE_PASSWORD=${ORACLE_PASSWORD}
      - ORACLE_CONNECT_STRING=${ORACLE_CONNECT_STRING}
    networks:
      - fms-network

networks:
  fms-network:
    driver: bridge
```

---

## 📊 테스트 데이터 생성

```sql
-- 테스트용 비행계획서 생성
DECLARE
    v_airports SYS.ODCIVARCHAR2LIST := SYS.ODCIVARCHAR2LIST('RKSS', 'RKTU', 'RKJK', 'RKJJ');
    v_callsign VARCHAR2(10);
    v_eobt TIMESTAMP;
BEGIN
    FOR i IN 1..20 LOOP
        v_callsign := v_airports(MOD(i, 4) + 1) || LPAD(1000 + i, 4, '0');
        v_eobt := TO_TIMESTAMP('2026-01-16 14:00:00', 'YYYY-MM-DD HH24:MI:SS') 
                  + NUMTODSINTERVAL(i * 5, 'MINUTE');
        
        INSERT INTO FLIGHT_PLANS (
            CALLSIGN, 
            DEPARTURE_AIRPORT, 
            DESTINATION_AIRPORT, 
            EOBT, 
            FLIGHT_LEVEL
        ) VALUES (
            v_callsign,
            v_airports(MOD(i, 4) + 1),
            'RKPC',
            v_eobt,
            'FL' || (140 + MOD(i, 8) * 20)
        );
    END LOOP;
    COMMIT;
END;
/
```

---

## 🔐 보안 고려사항

1. **환경 변수 사용**: DB 접속 정보를 `.env` 파일로 관리
2. **SQL Injection 방지**: Bind 변수 사용
3. **CORS 설정**: 운영 환경에서는 특정 도메인만 허용
4. **Connection Pool**: 동시 요청 처리를 위한 연결 풀 설정

```javascript
// Connection Pool 설정 예시
const pool = await oracledb.createPool({
    user: dbConfig.user,
    password: dbConfig.password,
    connectString: dbConfig.connectString,
    poolMin: 2,
    poolMax: 10,
    poolIncrement: 1
});
```
