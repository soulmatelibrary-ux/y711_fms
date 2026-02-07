# Y711 FMS (제주공항 흐름 관리 시스템) 종합 코드 리뷰

**검토일**: 2026-02-06
**총 코드량**: 6,706줄 (JS: 2650+, HTML: 800+, CSS: 3400+)
**프로젝트 상태**: MVP (MVP 완성, 외부 배포 전 단계)

---

## 📋 Executive Summary

### ✅ 잘 된 점
- **반응형 설계**: Phase 1-4 반응형 CSS 완성도 높음
- **데이터 관리**: SQLite 로컬 데이터베이스로 오프라인 대응
- **Excel 통합**: XLSX 파일 업로드 + 부분 업데이트 기능
- **인증 시스템**: SHA-256 해싱 + 비밀번호 검증 구현
- **UI/UX**: 다크 테마, 애니메이션, 모달 시스템 완성

### ⚠️ 심각한 문제 (High Priority)
1. **보안**: localStorage 저장소 사용, 만료 토큰 없음
2. **성능**: O(n²) 분리 분석, DOM 재생성 반복
3. **외부 배포**: API 서버 미완성, 환경변수 관리 없음
4. **에러 처리**: 예외 처리 미흡, 로깅 부재

### 🔴 중요한 결함 (Medium Priority)
1. **코드 품질**: 중복 코드, 타입 검증 부족
2. **데이터베이스**: 트랜잭션 관리 미흡, 마이그레이션 전략 부재
3. **테스트**: 단위 테스트/E2E 테스트 없음
4. **문서화**: 코드 주석 부족, API 문서 미흡

---

## 🔒 보안 분석

### 1️⃣ 인증/인가 (auth.js)

#### 🔴 **Critical Issues**

**Issue #1: 기본 비밀번호 노출**
```javascript
// public/auth.js (line 7-8)
const DEFAULT_USER = {
    username: 'acc',
    // Password: katc0012#$ ← 주석으로 노출!
    defaultPassword: 'katc0012#$'
};
```
**위험**: 소스코드 공개 시 기본 비밀번호 노출
**해결책**:
```javascript
// ❌ 제거: 기본 비밀번호 주석 삭제
// ✅ 변경: 환경변수로 관리
const DEFAULT_USER = {
    username: 'acc',
    defaultPassword: process.env.DEFAULT_PASSWORD || ''
};
```

**Issue #2: localStorage에 비밀번호 해시 저장**
```javascript
// public/auth.js (line 88, 141)
localStorage.setItem('y711_password_hash', defaultHash);
```
**위험**:
- XSS 공격으로 localStorage 접근 가능
- 클라이언트에서 비밀번호 정보 노출
- 모든 탭에서 공유되어 보안 취약

**해결책**:
```javascript
// ❌ 현재: localStorage 저장
// ✅ 변경: sessionStorage (탭 종료 시 삭제)
sessionStorage.setItem('y711_password_hash', defaultHash);

// ✅ 더 나은 방법: HttpOnly Cookie + 백엔드 검증
// (API 서버 구현 필요)
```

**Issue #3: 세션 만료 기간 없음**
```javascript
// public/auth.js (line 102-106)
function completeLogin(username) {
    const sessionToken = generateSessionToken();
    localStorage.setItem('y711_session', sessionToken);  // ← 무한 유지
    localStorage.setItem('y711_login_time', new Date().toISOString());
}
```
**위험**:
- 사용자가 로그아웃해도 토큰 유효
- 도둑맞은 기기에서 계속 접근 가능

**해결책**:
```javascript
// 로그인 시간 저장 후, 주기적으로 검증
function isSessionValid() {
    const loginTime = localStorage.getItem('y711_login_time');
    if (!loginTime) return false;

    const elapsed = Date.now() - new Date(loginTime).getTime();
    const SESSION_TIMEOUT = 30 * 60 * 1000; // 30분

    if (elapsed > SESSION_TIMEOUT) {
        logout();
        return false;
    }
    return true;
}
```

#### 🟡 **Important Issues**

**Issue #4: HTTPS 미설정**
```javascript
// vite.config.js
server: {
    port: 7300,
    allowedHosts: ['ssenalabs.iptime.org', 'localhost']
    // ← HTTPS/SSL 없음
}
```
**위험**: 비밀번호 해시가 평문으로 전송될 수 있음
**해결책**: 프로덕션에서는 HTTPS 필수

**Issue #5: CORS 정책 미흡**
```javascript
// api-server.js (line 13)
app.use(cors()); // ← 모든 출처 허용 (*)
```
**위험**: CSRF 공격 가능
**해결책**:
```javascript
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE']
}));
```

---

### 2️⃣ 데이터 검증 (src/main.js)

#### ✅ **좋은 점**
- SQL injection 방지: 바인드 변수 사용 (O)
- Excel 데이터 검증 함수 구현 (validateExcelData)
- 날짜 범위 검증 (O)

#### 🟡 **개선할 점**

**Issue #6: XSS 취약점 가능성**
```javascript
// src/main.js (line 1952-1953)
const callsign = row.CALLSIGN || `FL${idx}`;
const dept = row.DEPT || 'RKSS';
// ↓ HTML에 직접 삽입
mockFlights.push({
    callsign: callsign,
    ...
});
```
**위험**: 사용자 입력 (Excel) 미검증 상태로 DOM에 추가
**현황**: 항공편 데이터는 신뢰 가능하지만, 향후 사용자 입력 받을 시 주의

**해결책**:
```javascript
function sanitizeInput(input) {
    const div = document.createElement('div');
    div.textContent = input;
    return div.innerHTML;
}

const callsign = sanitizeInput(row.CALLSIGN || `FL${idx}`);
```

**Issue #7: 입력값 길이 검증 부족**
```javascript
// Excel 데이터에서 field 길이 확인 없음
if (!row.CALLSIGN || row.CALLSIGN.length > 10) {
    // 경고 또는 제외
}
```

---

### 3️⃣ API 보안 (api-server.js)

#### ✅ **좋은 점**
- SQL injection 방지: 바인드 변수 사용
- 기본 에러 처리
- 트랜잭션 관리 (commit/rollback)

#### 🔴 **심각한 문제**

**Issue #8: 인증 없음**
```javascript
// api-server.js (line 33)
app.get('/api/flights', async (req, res) => {
    // ← 누구나 접근 가능! 인증 check 없음
    const { airports, date } = req.query;
    ...
}
```
**해결책**:
```javascript
// 미들웨어 추가
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token || !isValidToken(token)) {
        return res.status(401).json({ error: '인증 필요' });
    }
    next();
};

app.get('/api/flights', authenticate, async (req, res) => {
    ...
});
```

**Issue #9: 입력값 검증 부족**
```javascript
// api-server.js (line 37-43)
const { airports, date } = req.query;  // 검증 없음!

if (!airports) {
    return res.status(400).json({ error: '공항 코드가 필요합니다.' });
}

const airportList = airports.split(',');  // 길이 제한 없음
// 예: ?airports=A,B,C,D,E,...(1000개) → 성능 저하 가능
```

**해결책**:
```javascript
const { airports, date } = req.query;

// 공항 코드 검증: 3-4자 알파벳만
const AIRPORT_REGEX = /^[A-Z]{3,4}$/;
const airportList = airports.split(',')
    .map(a => a.trim())
    .filter(a => AIRPORT_REGEX.test(a))
    .slice(0, 10);  // 최대 10개

if (airportList.length === 0) {
    return res.status(400).json({ error: '유효한 공항 코드 필요' });
}
```

**Issue #10: 에러 메시지에 민감 정보 노출**
```javascript
// api-server.js (line 89-92)
res.status(500).json({
    error: 'DB 조회 실패',
    message: error.message  // ← SQL 에러 노출 위험!
});
```
**해결책**:
```javascript
res.status(500).json({
    error: 'DB 조회 실패',
    message: process.env.NODE_ENV === 'production'
        ? '서버 오류가 발생했습니다'
        : error.message
});
```

---

## ⚡ 성능 분석

### 1️⃣ 알고리즘 복잡도

#### 🔴 **Critical: O(n²) 분리 분석**
```javascript
// src/main.js (line 1369-1400)
function drawSeparationAnalysis() {
    for (let i = 0; i < allFlights.length; i++) {
        for (let j = i + 1; j < allFlights.length; j++) {
            // 모든 항공기 쌍 검사
            const separation = calculateSeparation(allFlights[i], allFlights[j]);
            if (separation < minSeparation) {
                // 경고 표시
            }
        }
    }
}
```

**문제**:
- 100개 항공편 = 10,000 비교 필요
- 500개 항공편 = 125,000 비교 필요
- 매 프레임(60fps) 반복 = 매우 느림

**성능 예측**:
```
항공편 개수 | 계산량 | 시간 (16.67ms 프레임)
100편      | 10K   | ~2ms (✅ 문제 없음)
500편      | 125K  | ~50ms (❌ 프레임 드롭)
1000편     | 500K  | ~200ms (❌ 완전 멈춤)
```

**해결책**:
```javascript
// 공간 분할 (Quadtree/Grid)을 사용하여 O(n log n)으로 개선
class SeparationGrid {
    constructor(gridSize = 100) {
        this.grid = new Map();
        this.gridSize = gridSize;
    }

    addFlight(flight) {
        const cell = Math.floor(flight.x / this.gridSize);
        if (!this.grid.has(cell)) this.grid.set(cell, []);
        this.grid.get(cell).push(flight);
    }

    getNearby(flight) {
        const cell = Math.floor(flight.x / this.gridSize);
        const nearby = [];
        for (let c = cell - 1; c <= cell + 1; c++) {
            if (this.grid.has(c)) nearby.push(...this.grid.get(c));
        }
        return nearby;
    }
}
```

### 2️⃣ DOM 성능

#### 🔴 **Critical: innerHTML 재생성**
```javascript
// src/main.js (line 1335-1360)
function updateFlightMap() {
    // 매 프레임 (16.67ms) 마다 실행
    document.getElementById('aircraft-layer').innerHTML = '';  // ← 전체 삭제!

    allFlights.forEach(flight => {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const text1 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        const text2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        // ... 4개 요소 생성
        group.appendChild(path);
        group.appendChild(text1);
        group.appendChild(text2);
        document.getElementById('aircraft-layer').appendChild(group);
    });
}
```

**문제**:
- 매프레임 모든 DOM 요소 삭제 및 재생성
- 100개 항공편 = 400개 요소 재생성 (매 16.67ms)
- reflow/repaint 반복 = 배터리 빨리 소모

**성능**:
```
Desktop (60 FPS):  ✅ 가능
Tablet (45 FPS):   🟡 한계
Mobile (25-30 FPS): ❌ 버벅거림
```

**해결책**:
```javascript
// DOM 요소 재사용 (pooling)
class ElementPool {
    constructor(size = 500) {
        this.available = [];
        this.used = new Map();

        for (let i = 0; i < size; i++) {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            // 4개 자식 요소 미리 생성
            g.path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            g.text1 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            g.text2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            this.available.push(g);
        }
    }

    get() {
        return this.available.pop() || this.createNew();
    }

    release(element) {
        this.available.push(element);
    }
}

// 사용
const pool = new ElementPool();
const element = pool.get();
element.path.setAttribute('d', flightPath);
element.text1.textContent = flight.callsign;
svg.appendChild(element);
```

### 3️⃣ setInterval vs requestAnimationFrame

#### 🟡 **setInterval 사용 (비효율)**
```javascript
// src/main.js
setInterval(() => {
    updateFlightMap();
    updateTimeMarker();
    // ...
}, 1000 / 60);  // 16.67ms
```

**문제**:
- requestAnimationFrame과 다른 시점에 실행
- 브라우저 최적화 못함
- 배터리 소모 증가
- 탭이 비활성화되어도 계속 실행

**해결책**:
```javascript
function animate() {
    updateFlightMap();
    updateTimeMarker();
    drawSeparationAnalysis();
    requestAnimationFrame(animate);
}

animate();

// 또는 성능 조절
let lastFrameTime = 0;
function animate() {
    const now = performance.now();
    if (now - lastFrameTime >= 16.67) {  // 60 FPS 목표
        updateFlightMap();
        lastFrameTime = now;
    }
    requestAnimationFrame(animate);
}
```

### 4️⃣ 메모리 누수 가능성

```javascript
// src/main.js - event listener 누수 의심
document.getElementById('flight-queue')?.addEventListener('click', (e) => {
    // ← 리스너가 계속 추가됨 (removeEventListener 없음)
});

// 개선:
const queueElement = document.getElementById('flight-queue');
queueElement?.addEventListener('click', handleFlightClick);

// 정리 필요:
window.addEventListener('beforeunload', () => {
    queueElement?.removeEventListener('click', handleFlightClick);
});
```

---

## 🏗️ 아키텍처 분석

### 1️⃣ 현재 구조
```
┌─────────────────────────────────────┐
│  Frontend (SPA - Vite)              │
│  ├─ index.html (800줄)              │
│  ├─ src/main.js (2650줄)            │
│  ├─ src/style.css (3400줄)          │
│  └─ public/auth.js (185줄)          │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│  Local Storage (Client-side)        │
│  ├─ SQLite (sql.js)                 │
│  ├─ y711_password_hash              │
│  ├─ y711_session                    │
│  └─ flights (Excel 데이터)          │
└─────────────────────────────────────┘
         ↓ (Optional)
┌─────────────────────────────────────┐
│  Backend API (Node.js/Express)      │
│  ├─ GET /api/flights                │
│  ├─ POST /api/ctot                  │
│  └─ GET /api/airports               │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│  Oracle Database (예시)             │
└─────────────────────────────────────┘
```

### 2️⃣ 아키텍처 문제

#### 🔴 **문제 #1: 클라이언트 의존도 높음**
- 모든 데이터가 SQLite (로컬)에만 존재
- 서버와 동기화 없음
- 여러 사용자 지원 불가

#### 🟡 **문제 #2: API 서버 미완성**
```javascript
// api-server.js는 예시 코드
// 실제로 작동하려면 수정 필요:
// 1. 데이터베이스 연결 문자열 (환경변수)
// 2. 인증/인가 미들웨어
// 3. 에러 처리 강화
// 4. 로깅 시스템
// 5. 레이트 리미팅
```

#### 🟡 **문제 #3: SQLite 제약사항**
- 모바일 환경에서 용량 제한 (50MB 정도)
- 동시성 처리 약함 (여러 탭)
- 멀티유저 지원 불가

**해결책**:
```javascript
// 로컬 SQLite + 클라우드 동기화
class SyncManager {
    async uploadFlights() {
        const flights = db.exec('SELECT * FROM flights');
        await fetch('/api/flights', {
            method: 'POST',
            body: JSON.stringify({ flights })
        });
    }

    async downloadFlights() {
        const response = await fetch('/api/flights');
        const { flights } = await response.json();
        // 로컬 DB에 병합
    }
}
```

---

## 📝 코드 품질

### 1️⃣ 중복 코드

#### 🟡 **버튼 생성 로직 반복**
```javascript
// src/main.js에서 비슷한 패턴 반복:

// Pattern 1
document.getElementById('sort-cfl-btn')?.addEventListener('click', () => {
    // ...
});

// Pattern 2
document.getElementById('reset-ctot-btn')?.addEventListener('click', () => {
    // ...
});

// Pattern 3
document.getElementById('calc-ctot-btn')?.addEventListener('click', () => {
    // ...
});
```

**개선**:
```javascript
const buttons = {
    'sort-cfl-btn': handleSortCFL,
    'reset-ctot-btn': handleResetCTOT,
    'calc-ctot-btn': handleCalcCTOT
};

Object.entries(buttons).forEach(([id, handler]) => {
    document.getElementById(id)?.addEventListener('click', handler);
});
```

#### 🟡 **날짜 변환 코드 중복**
```javascript
// 여러 곳에서 반복:
const targetDateStr = targetDate.toISOString().split('T')[0];
const jsDayOfWeek = targetDate.getDay();
const targetDayOfWeek = jsDayOfWeek === 0 ? 7 : jsDayOfWeek;
```

**개선**:
```javascript
function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function getExcelDayOfWeek(date) {
    const jsDow = date.getDay();
    return jsDow === 0 ? 7 : jsDow;
}
```

### 2️⃣ 타입 검증 부족

```javascript
// 타입 안정성 없음
function calculateSeparation(flight1, flight2) {  // 파라미터 타입 불명
    const time1 = timeToSec(flight1.eobt);
    const time2 = timeToSec(flight2.eobt);
    // ...
}

// 개선:
/**
 * @param {Object} flight1 - 첫번째 항공편 {eobt: string, ...}
 * @param {Object} flight2 - 두번째 항공편 {eobt: string, ...}
 * @returns {number} 분리 시간 (초)
 */
function calculateSeparation(flight1, flight2) {
    if (!flight1?.eobt || !flight2?.eobt) {
        throw new Error('Invalid flight data');
    }
    // ...
}
```

### 3️⃣ 에러 처리

#### 🔴 **Critical: try-catch 누락**
```javascript
// 에러 처리 없음
const results = db.exec(`SELECT * FROM flights WHERE ...`);

// 개선:
try {
    const results = db.exec(`SELECT * FROM flights WHERE ...`);
    if (!results.length) {
        console.warn('No flights found');
        return [];
    }
} catch (error) {
    console.error('Database error:', error);
    showToast('데이터 조회 실패', 'error');
    return [];
}
```

#### 🟡 **로깅 부재**
```javascript
// 현재: console.log만 사용
console.log('Loading flights...');

// 개선:
function createLogger(name) {
    return {
        info: (msg, data) => console.log(`[${name}] ${msg}`, data),
        error: (msg, err) => console.error(`[${name}] ${msg}`, err),
        warn: (msg, data) => console.warn(`[${name}] ${msg}`, data)
    };
}

const logger = createLogger('FlightLoader');
logger.info('Loading flights', { count: 100 });
```

---

## 🚀 외부 서비스 배포 시 주의점

### 1️⃣ 보안 체크리스트

- [ ] **기본 비밀번호 제거**
  ```javascript
  // ❌ 제거
  defaultPassword: 'katc0012#$'

  // ✅ 환경변수 사용
  defaultPassword: process.env.DEFAULT_PASSWORD
  ```

- [ ] **HTTPS/SSL 설정**
  ```javascript
  // nginx 예시
  server {
      listen 443 ssl;
      ssl_certificate /path/to/cert.pem;
      ssl_certificate_key /path/to/key.pem;
  }
  ```

- [ ] **환경변수 분리**
  ```bash
  # .env.production
  ORACLE_USER=prod_user
  ORACLE_PASSWORD=***
  DATABASE_URL=production_connection_string
  NODE_ENV=production
  ```

- [ ] **CORS 정책 강화**
  ```javascript
  app.use(cors({
      origin: process.env.ALLOWED_ORIGINS.split(','),
      credentials: true
  }));
  ```

- [ ] **인증/인가 미들웨어 구현**
  ```javascript
  const authenticate = (req, res, next) => {
      const token = req.headers.authorization?.split(' ')[1];
      if (!verifyToken(token)) {
          return res.status(401).json({ error: 'Unauthorized' });
      }
      next();
  };
  ```

- [ ] **Rate Limiting**
  ```javascript
  const rateLimit = require('express-rate-limit');
  app.use('/api/', rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100  // 15분에 100 요청
  }));
  ```

- [ ] **데이터 암호화**
  - 전송 중: HTTPS (O)
  - 저장소: 비밀번호는 bcrypt (현재 SHA-256 ⚠️)
  - 민감 정보: AES-256 암호화

- [ ] **입력값 검증 및 새니타이징**
  ```javascript
  const { body, validationResult } = require('express-validator');

  app.post('/api/ctot', [
      body('flights').isArray(),
      body('flights.*.callsign').isLength({ min: 3, max: 10 }),
      body('flights.*.ctot').matches(/^\d{4}$/)
  ], (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
      }
      // ...
  });
  ```

- [ ] **로깅 및 모니터링**
  ```javascript
  const winston = require('winston');
  const logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
          new winston.transports.File({ filename: 'error.log', level: 'error' }),
          new winston.transports.File({ filename: 'combined.log' })
      ]
  });
  ```

- [ ] **백업 전략**
  - 데이터베이스 자동 백업 (일일/시간)
  - 복구 계획 수립
  - 재해 복구 테스트

### 2️⃣ 인프라 설정

#### 환경 변수 관리
```bash
# .env (git 제외)
ORACLE_USER=prod_user
ORACLE_PASSWORD=secure_password_here
ORACLE_CONNECT_STRING=prod-db.example.com:1521/ORCL
DEFAULT_PASSWORD=initial_password_for_first_login
JWT_SECRET=secret_key_for_token_generation
NODE_ENV=production
PORT=3000
ALLOWED_ORIGINS=https://y711.example.com,https://admin.example.com
```

#### 프로세스 관리 (PM2)
```bash
# ecosystem.config.js
module.exports = {
    apps: [{
        name: 'y711-fms',
        script: './api-server.js',
        instances: 4,
        exec_mode: 'cluster',
        env: {
            NODE_ENV: 'production'
        },
        error_file: 'logs/error.log',
        out_file: 'logs/out.log'
    }]
};
```

#### Docker 컨테이너화
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist
COPY api-server.js .
COPY public ./public

EXPOSE 3000
CMD ["npm", "start"]
```

### 3️⃣ 성능 최적화

- [ ] **번들 최소화**
  ```bash
  npm run build  # Vite로 minify 자동화
  ```

- [ ] **캐싱 전략**
  ```javascript
  app.use(express.static('dist', {
      maxAge: '1d',           // CSS/JS 1일 캐시
      etag: false
  }));
  ```

- [ ] **CDN 사용**
  - 정적 파일 (JS, CSS, 이미지): CloudFlare/AWS CloudFront
  - 데이터베이스: 지역별 레플리케이션

- [ ] **데이터베이스 최적화**
  - 인덱스 생성: CALLSIGN, EOBT, DEPARTURE_AIRPORT
  - 쿼리 최적화: EXPLAIN PLAN 분석
  - 연결 풀링: connection pooling (max 20 connections)

### 4️⃣ 모니터링 & 알림

```javascript
// 에러 추적 (Sentry)
const Sentry = require('@sentry/node');

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1
});

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());

// 성능 모니터링 (New Relic)
require('newrelic');

// 헬스체크
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date(),
        version: process.env.APP_VERSION
    });
});
```

---

## 📊 부족한 기능/아키텍처

### 1️⃣ 실시간 데이터 동기화
**현재**: 단일 사용자, 로컬 저장소
**필요**:
- 멀티유저 지원
- 실시간 CTOT 업데이트 (WebSocket)
- 변경사항 동기화

```javascript
// 예시 구현
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
    ws.on('message', (data) => {
        const { type, payload } = JSON.parse(data);

        if (type === 'CTOT_UPDATE') {
            // 모든 클라이언트에 브로드캐스트
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(payload));
                }
            });
        }
    });
});
```

### 2️⃣ 사용자 관리
**현재**: 하드코드된 단일 사용자 (acc)
**필요**:
- 다중 사용자 계정
- 역할/권한 관리 (RBAC)
- 감사 로그

```javascript
// 사용자 테이블 구조
CREATE TABLE users (
    id INT PRIMARY KEY,
    username VARCHAR(50) UNIQUE,
    password_hash VARCHAR(255),
    role ENUM('admin', 'operator', 'viewer'),
    created_at TIMESTAMP,
    last_login TIMESTAMP
);

CREATE TABLE audit_log (
    id INT PRIMARY KEY,
    user_id INT,
    action VARCHAR(100),
    timestamp TIMESTAMP,
    details JSON
);
```

### 3️⃣ 버전 관리/배포
**현재**: 버전 관리 없음
**필요**:
- Semantic Versioning
- 자동 배포 (CI/CD)
- 블루-그린 배포

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Build
        run: npm run build
      - name: Test
        run: npm test
      - name: Deploy to Production
        run: npm run deploy:prod
```

### 4️⃣ 테스트
**현재**: 테스트 없음
**필요**:
- 단위 테스트 (Jest)
- E2E 테스트 (Cypress)
- 통합 테스트

```javascript
// 예시: Jest 단위 테스트
describe('calculateSeparation', () => {
    test('should calculate correct separation', () => {
        const flight1 = { eobt: '0600' };
        const flight2 = { eobt: '0603' };
        expect(calculateSeparation(flight1, flight2)).toBe(180);
    });
});
```

### 5️⃣ 문서화
**현재**: 최소한의 주석
**필요**:
- API 문서 (OpenAPI/Swagger)
- 아키텍처 문서
- 운영 매뉴얼

```javascript
// Swagger 예시
/**
 * @swagger
 * /api/flights:
 *   get:
 *     summary: 항공편 조회
 *     parameters:
 *       - name: airports
 *         in: query
 *         type: string
 *         example: "RKSS,RKTU"
 *     responses:
 *       200:
 *         description: 항공편 목록
 */
app.get('/api/flights', ...);
```

---

## ✅ 우선순위별 개선 계획

### 🔴 Critical (즉시 개선 필요)
1. **보안**: 기본 비밀번호 제거, 세션 만료 추가
2. **성능**: O(n²) 알고리즘 → O(n log n)으로 개선
3. **인증**: API 서버에 인증 미들웨어 추가
4. **에러 처리**: 모든 async 함수에 try-catch 추가

### 🟡 Important (1-2주 내)
5. **코드 중복 제거**: 버튼 이벤트 리스너 통합
6. **로깅**: Winston/Pino로 구조화된 로깅
7. **입력 검증**: 모든 사용자 입력에 검증 추가
8. **테스트**: Jest로 기본 단위 테스트 작성

### 🟢 Nice to Have (추후)
9. **멀티유저**: 백엔드 인증 및 다중 사용자 지원
10. **실시간**: WebSocket으로 CTOT 실시간 업데이트
11. **문서화**: Swagger 문서 작성
12. **모니터링**: Sentry/New Relic 통합

---

## 📋 배포 체크리스트

```bash
# 배포 전 확인사항
[ ] 모든 .env 파일에 프로덕션 값 설정
[ ] 기본 비밀번호 제거/변경
[ ] HTTPS/SSL 인증서 설정
[ ] 데이터베이스 마이그레이션 실행
[ ] 백업 스크립트 구성
[ ] 모니터링 시스템 설정
[ ] 에러 추적 시스템 활성화
[ ] Rate limiting 활성화
[ ] CORS 정책 제한
[ ] 보안 헤더 설정 (CSP, X-Frame-Options 등)
[ ] 정적 파일 캐싱 설정
[ ] 로그 저장소 구성
[ ] 알림 규칙 설정
[ ] 부하 테스트 실행 (500+ 사용자 시뮬레이션)
[ ] 장애 조치 테스트 (failover)
[ ] 롤백 계획 수립
```

---

## 🎯 결론

**Y711 FMS**는 **MVP 수준의 완성도**있는 프로젝트입니다:
- ✅ 핵심 기능 구현 (CTOT 계산, 분리 분석, Excel 통합)
- ✅ 반응형 UI 완성
- ⚠️ 보안 및 성능 개선 필요
- ❌ 프로덕션 배포에는 아직 부족

**외부 서비스 배포 전**에 반드시 다음을 완료하세요:
1. **보안 강화** (기본 비밀번호 제거, 세션 관리)
2. **성능 최적화** (O(n²) → O(n log n), DOM pooling)
3. **에러 처리 & 로깅** (구조화된 로깅 추가)
4. **인증/인가** (API 서버 보안)
5. **테스트** (단위 + E2E 테스트)

---

**작성**: Claude Haiku 4.5
**검토 기준**: 보안, 성능, 코드 품질, 배포 준비 상태
