# Y711 FMS (Flow Management System)

제주행 항공편 CTOT(Calculated Take-Off Time) 관리 시스템

## 개요

서해안 항공로(Y711)를 이용하는 제주행 항공편의 출발 시간을 관리하고, 웨이포인트에서의 분리 기준을 충족하도록 CTOT를 계산하는 시스템입니다.

### 대상 공항
| 공항코드 | 공항명 | 합류지점 | 진입시간 | 이륙간격 |
|---------|--------|---------|---------|---------|
| RKSS | 김포 | BULTI | 8분 | 4분 |
| RKTU | 청주 | MEKIL | 7분 | 10분 |
| RKJK | 군산 | MANGI | 3분 | 10분 |
| RKJJ | 광주 | DALSU | 1분 | 10분 |

### 웨이포인트 경로
```
BULTI → MEKIL → GONAX → BEDES → ELPOS → MANGI → DALSU → NULDI → DOTOL → 제주(RKPC)
```

---

## 빠른 시작

```bash
# 의존성 설치
npm install

# 개발 서버 실행 (포트 7300)
npm run dev

# 빌드
npm run build
```

---

## 프로젝트 구조

```
y711fms/
├── index.html          # 메인 HTML
├── src/
│   ├── main.js         # 메인 JavaScript (핵심 로직)
│   ├── style.css       # 스타일시트
│   └── lib/
│       ├── xlsx.full.min.js   # Excel 파싱 라이브러리
│       └── Sortable.min.js    # 드래그앤드롭 라이브러리
├── public/
│   ├── sql-wasm.js     # SQLite WASM
│   └── sql-wasm.wasm   # SQLite WASM 바이너리
├── schedule/           # 스케줄 PDF 파싱 관련
├── backup/             # 백업 파일
├── package.json        # 패키지 설정
└── vite.config.js      # Vite 설정
```

---

## 핵심 기능

### 1. CTOT 계산
- **EOBT 기준**: CTOT는 EOBT(예상 이륙 시간)보다 빠를 수 없음
- **이륙 간격**: 같은 공항 항공기 간 최소 이륙 간격 적용
- **웨이포인트 분리**: 합류 지점에서 3분 분리 기준 충족

### 2. 충돌 감지
- MEKIL: 김포 + 청주 합류
- MANGI: 군산 합류
- DALSU: 광주 합류

### 3. 시뮬레이션
- 실시간/배속 재생 (1x, 2x, 5x, 10x, 20x)
- 항공기 위치 시각화
- 분리 분석 표시

### 4. 데이터 관리
- Excel 파일 업로드 지원
- localStorage 기반 데이터 저장
- 요일별 스케줄 필터링

---

## main.js 구조

### 전역 설정
```javascript
separationInterval = 180;  // 분리 기준 (초)

segmentConfig = {
    'RKSS_BULTI': 8,   // 김포→BULTI 8분
    'RKTU_MEKIL': 7,   // 청주→MEKIL 7분
    'RKJK_MANGI': 3,   // 군산→MANGI 3분
    'RKJJ_DALSU': 1    // 광주→DALSU 1분
};

waypoints = [
    { from: 'BULTI', to: 'MEKIL', duration: 2 },
    { from: 'MEKIL', to: 'GONAX', duration: 2 },
    // ...
];
```

### 주요 함수

| 함수 | 역할 |
|------|------|
| `updateCTOTs()` | 모든 항공편 CTOT 계산 |
| `calculateFlightWaypoints()` | 웨이포인트별 도착 시간 계산 |
| `detectConflicts()` | 충돌 감지 |
| `calculatePosition()` | 항공기 위치 계산 (애니메이션) |
| `renderFlightQueue()` | 항공편 목록 렌더링 |
| `renderTimelineFlights()` | 타임라인 렌더링 |

### 코드 섹션 (라인 기준)
```
Line 1-64      : DATABASE (SQLite 초기화)
Line 66-143    : GLOBAL STATE & DATA
Line 184-451   : HELPERS (유틸리티)
Line 453-571   : LOGIC: WAYPOINTS & CTOT
Line 713-1122  : RENDERING
Line 1171-1323 : POSITION & AIRCRAFT
Line 1326-1481 : EVENT SETUP
Line 1483-1735 : DATA LOADING
Line 1737-1877 : TIMELINE & MAP
Line 1879-2109 : SIMULATION & SETTINGS
Line 2111-2149 : APP INITIALIZATION
```

---

## CTOT 계산 로직

```
┌─────────────────────────────────────────┐
│         updateCTOTs() 흐름               │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ Priority 1: EOBT 기준 최소값 설정         │
│   tentativeCtot = eobtSec               │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ Priority 2: 같은 공항 이륙 간격           │
│   prevCtot + depInterval                │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ Priority 3: 웨이포인트 충돌 검사          │
│   separationInterval(180초) 미만이면 지연 │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│ 결과 저장 및 캐스케이딩                   │
│   flight.ctot = secToTime(tentativeCtot)│
└─────────────────────────────────────────┘
```

---

## 설정 화면 (Configuration)

### Entry Segments (진입 시간)
공항에서 첫 번째 합류 웨이포인트까지의 시간

### Waypoints (웨이포인트 구간)
각 웨이포인트 간 비행 시간

### Separation (분리 기준)
웨이포인트에서의 최소 분리 시간 (1~10분)

---

## Excel 파일 형식

업로드할 Excel 파일은 다음 컬럼을 포함해야 합니다:

| 컬럼 | 설명 | 예시 |
|------|------|------|
| CALLSIGN | 콜사인 | KAL1234 |
| DEPT | 출발 공항 | RKSS |
| DEST | 도착 공항 | RKPC |
| CFL | 순항 고도 | F280 |
| EOBT_UTC | 예상 이륙 시간 | 0530 |
| DAY_OF_WEEK | 운항 요일 | 1 (월요일) |

---

## API 서버 (선택사항)

Oracle DB 연동이 필요한 경우 `api-server.js` 사용

```bash
# 환경 변수 설정 (.env)
ORACLE_USER=username
ORACLE_PASSWORD=password
ORACLE_CONNECT_STRING=localhost:1521/ORCL

# 서버 실행
node api-server.js
```

상세 내용은 `backup/README-API.md` 참조

---

## 기술 스택

- **Frontend**: Vanilla JavaScript, CSS3
- **Build**: Vite
- **Database**: sql.js (브라우저 SQLite)
- **Libraries**:
  - xlsx.js (Excel 파싱)
  - Sortable.js (드래그앤드롭)

---

## 참고 자료

- `backup/fix.txt`: 웨이포인트 시간 및 설정값 메모
- `backup/README-API.md`: API 서버 상세 문서
- `backup/rpl.xlsx`: 샘플 스케줄 데이터
