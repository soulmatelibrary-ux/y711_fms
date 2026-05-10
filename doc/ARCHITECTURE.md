# Y711 FMS - 모듈식 아키텍처

진입점은 `index.html` → `/src/main-modular.js`이며, 구버전 모놀리식 `main.js`(약 2,935줄)는 [`backup/misc/main.js.bak`](../backup/misc/main.js.bak)으로 보관됩니다.

## 📁 디렉토리 구조

```
src/
├── components/          # UI 컴포넌트
│   ├── Header.js        # 상단 헤더 (Excel 업로드, 로그아웃)
│   ├── LeftPanel.js     # 왼쪽 패널 (항공편 목록 / EOBT·ATD·CTOT)
│   ├── RightPanel.js    # 오른쪽 패널 (Timeline + Live Route Map)
│   └── Modals.js        # 모달 4종 (스케줄 기간 선택 외)
│
├── services/            # 비즈니스 로직
│   ├── ctot.js          # CTOT 계산 / 충돌 감지
│   └── simulation.js    # 시뮬레이션 엔진 (1×~20×)
│
├── utils/               # 공용 유틸
│   ├── database.js      # sql.js 초기화 / 쿼리
│   ├── helpers.js       # 시간·UUID·포맷 유틸
│   └── notifications.js # 토스트 알림
│
├── style.css            # 전역 스타일
└── main-modular.js      # 진입점 (DOM 부트스트랩 + 글로벌 이벤트 바인딩)
```

## 🏗️ 컴포넌트 설계

### LeftPanel (왼쪽 메뉴)
```javascript
class LeftPanel {
    - render()              // HTML 생성
    - init()                // 초기화 및 이벤트 바인딩
    - loadFlights()         // DB에서 항공편 로드
    - renderFlightList()    // 목록 렌더링
    - selectFlight()        // 항공편 선택
    - calculateCTOT()       // CTOT 계산
    - deleteFlight()        // 항공편 삭제
}
```

**역할:**
- 항공편 목록 표시
- 날짜 선택
- CTOT 계산 및 관리
- 항공편 데이터 편집

---

### RightPanel (오른쪽 메뉴)
```javascript
class RightPanel {
    - render()              // HTML 생성
    - init()                // 초기화
    - loadFlights()         // 항공편 데이터 로드
    - renderTimeline()      // Gantt Chart 렌더링
    - renderMap()           // 지도 렌더링
    - playSim()             // 시뮬레이션 재생
    - stopSim()             // 시뮬레이션 중지
}
```

**역할:**
- Timeline (Time Flow) 표시
- Live Route Map 표시
- 시뮬레이션 제어

---

## 🔧 Utils (유틸리티)

### database.js
```javascript
- initDatabase()         // 데이터베이스 초기화
- getDatabase()          // DB 인스턴스 반환
- queryFlights()         // 항공편 조회
- insertFlights()        // 항공편 추가
- updateFlightRecord()   // 항공편 수정
- deleteFlightRecord()   // 항공편 삭제
```

### notifications.js
```javascript
- initToastContainer()   // 토스트 컨테이너 초기화
- showToast()            // 일반 토스트 표시
- showSuccessToast()     // 성공 토스트
- showErrorToast()       // 오류 토스트
- showInfoToast()        // 정보 토스트
- showWarningToast()     // 경고 토스트
```

### helpers.js
```javascript
- generateUUID()         // UUID 생성
- formatTime()           // 시간 포맷
- formatDateRange()      // 날짜 범위 포맷
- validateTime()         // 시간 유효성 검증
- altitudeToY()          // 고도를 Y 좌표로 변환
```

---

## 📊 데이터 흐름

```
사용자 입력
   ↓
LeftPanel/RightPanel (이벤트 핸들러)
   ↓
utils/database.js (DB 조작)
   ↓
SQLite (fms.db)
   ↓
utils/notifications.js (피드백)
   ↓
사용자 화면
```

---

## 🚀 사용 방법

### 1. 진입점

`index.html`은 다음 한 줄로 모듈식 진입점을 로드합니다:

```html
<script type="module" src="/src/main-modular.js"></script>
```

`main-modular.js`는 인증 확인 → DB 초기화 → 컴포넌트 렌더 → 이벤트 바인딩 → 시뮬레이션 초기화 순서로 부트스트랩합니다.

### 2. 새로운 컴포넌트 추가

```javascript
// src/components/NewComponent.js
export class NewComponent {
    constructor() {
        this.data = [];
    }

    render() {
        return `<div>...</div>`;
    }

    init() {
        // 이벤트 바인딩
    }
}

// src/main-modular.js에서 import
import { NewComponent } from './components/NewComponent.js';
```

### 3. 새로운 유틸 함수 추가

```javascript
// src/utils/newUtil.js
export function myFunction() {
    // 구현
}

// 다른 파일에서 import
import { myFunction } from '../utils/newUtil.js';
```

---

## 📦 번들링

Vite가 자동으로 모든 모듈을 번들링합니다:

```bash
npm run build

# 결과:
# dist/assets/main-CTukNf4t.js (번들된 파일)
```

---

## 🔄 마이그레이션 진행 (완료)

### Phase 1: 기본 구조 분리 ✅
- [x] LeftPanel / RightPanel / Utils 분리

### Phase 2: 나머지 컴포넌트 분리 ✅
- [x] Header / Modals 컴포넌트
- [x] Services (CTOT, Simulation)

### Phase 3: 기존 main.js 제거 ✅
- [x] 호환성 테스트 통과
- [x] 모든 기능을 모듈식으로 이동
- [x] 모놀리식 `main.js` → `backup/misc/main.js.bak` 보관

> 자세한 운영 사항은 [`operations/OPERATIONS.md`](./operations/OPERATIONS.md) 참고.

---

## 💡 장점

| 항목 | 이전 | 이후 |
|------|------|------|
| **파일 크기** | 2500줄/파일 | 200-300줄/파일 |
| **유지보수** | 어려움 | 쉬움 |
| **테스트** | 불가능 | 가능 |
| **재사용성** | 낮음 | 높음 |
| **팀 협업** | 어려움 | 용이 |
| **디버깅** | 어려움 | 쉬움 |

---

**생성일**: 2026-02-07
**상태**: Phase 1~3 완료 (모듈식 전환 완료, 모놀리식 백업 보관)
