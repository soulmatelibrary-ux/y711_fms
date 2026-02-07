# Y711 FMS - 모듈식 아키텍처

## 📁 디렉토리 구조

```
src/
├── components/          # 재사용 가능한 UI 컴포넌트
│   ├── LeftPanel.js     # 왼쪽 패널 (항공편 목록)
│   ├── RightPanel.js    # 오른쪽 패널 (Timeline + Map)
│   └── Header.js        # (준비 중) 헤더 컴포넌트
│
├── utils/              # 공용 유틸 함수
│   ├── database.js     # SQLite 데이터베이스 관리
│   ├── notifications.js # 토스트 알림 시스템
│   ├── helpers.js      # 일반 헬퍼 함수
│   └── api.js          # (준비 중) API 호출
│
├── services/           # 비즈니스 로직 (준비 중)
│   ├── ctot.js         # CTOT 계산
│   └── simulation.js    # 시뮬레이션 엔진
│
├── style.css           # 전역 스타일
├── main.js             # 기존 메인 파일 (호환성 유지)
└── main-modular.js     # ✨ 새로운 모듈식 메인 파일
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

### 1. 모듈식 구조 활성화

기본값은 여전히 `src/main.js`를 사용합니다.
새로운 모듈식 구조를 사용하려면 `index.html`에서:

```html
<!-- 기존 (호환성) -->
<script type="module" src="/src/main.js"></script>

<!-- 새로운 모듈식 -->
<script type="module" src="/src/main-modular.js"></script>
```

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

## 🔄 마이그레이션 계획

### Phase 1: 기본 구조 분리 ✅
- [x] LeftPanel 분리
- [x] RightPanel 분리
- [x] Utils 분리
- [x] 새로운 main.js 작성

### Phase 2: 나머지 컴포넌트 분리 (준비 중)
- [ ] Header 컴포넌트
- [ ] Modals 컴포넌트
- [ ] Services (CTOT, Simulation)

### Phase 3: 기존 main.js 점진적 제거
- [ ] 호환성 테스트
- [ ] 기존 기능 모두 이동
- [ ] main.js 정리

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

## 🎯 다음 단계

1. 새로운 구조로 빌드 & 테스트
2. 나머지 컴포넌트 분리
3. 통합 테스트
4. 기존 main.js 제거

---

**생성일**: 2026-02-07
**상태**: Phase 1 완료, Phase 2 준비 중
