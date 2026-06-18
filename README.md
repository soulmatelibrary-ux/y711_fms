# ACC ATD v2 - 항공편 출발시간 관리 시스템

## 개요

ACC(접근관제) 관제사가 ATD(Actual Take-Off Time)를 빠르게 발부하고, 합류 웨이포인트의 충돌을 방지하기 위한 시스템입니다.

### 주요 기능
- **ATD 발부**: NOW ±30분 항공편의 출발시간 결정
- **충돌 방지**: 합류 웨이포인트에서 분리 기준 미달 항공편 감지 및 해결
- **시각적 시뮬레이션**: 1×~30× 배속 재생으로 시간 흐름 시각화

### 대상 공항

| ICAO | 공항 | 합류지점 | 진입시간 | 이륙간격 |
|------|------|---------|---------|---------|
| RKSS | 김포 | BULTI | 8분 | 4분 |
| RKTU | 청주 | MEKIL | 7분 | 10분 |
| RKJK | 군산 | MANGI | 3분 | 10분 |
| RKJJ | 광주 | DALSU | 1분 | 10분 |

```
RKSS ─► BULTI ─┐
RKTU ─► MEKIL ─┤
RKJK ─► MANGI ─┼─► GONAX ─► BEDES ─► ELPOS ─► NULDI ─► DOTOL ─► RKPC (제주)
RKJJ ─► DALSU ─┘
```

---

## 폴더 구조

```
y711_fms/
├── app/                 # 프론트엔드 (Vite + JavaScript)
│   ├── src/             # 소스코드
│   ├── node_modules/    # npm 패키지 (폐쇄망용 포함)
│   └── doc/             # 상세 기술 문서
├── backend/             # 백엔드 API 서버 (Node.js + Express)
│   ├── api-server.js    # 메인 서버
│   ├── node_modules/    # npm 패키지 (폐쇄망용 포함)
│   └── fms.db           # SQLite 데이터베이스
├── python/              # 임베디드 Python (폐쇄망용)
├── offline_packages/    # 오프라인 설치 패키지
├── doc/                 # 문서
├── start.bat            # 서버 시작
├── stop.bat             # 서버 종료
└── install.bat          # 초기 설치 (Python 패키지)
```

---

## 빠른 시작 (폐쇄망 환경)

### 1. 사전 요구사항
- Windows 10/11
- 해상도 1280px 이상 권장

### 2. 최초 설치 (1회만)
```
install.bat 더블클릭
```
- Python 패키지 오프라인 설치
- 완료 메시지 확인 후 창 닫기

### 3. 서버 시작
```
start.bat 더블클릭
```
- Backend 서버: http://localhost:7300
- Frontend 서버: http://localhost:7301

### 4. 브라우저 접속
```
http://localhost:7301
```

### 5. 서버 종료
```
stop.bat 더블클릭
```
또는 실행 중인 창에서 `Ctrl+C`

---

## 화면 구성

```
┌─ Header ──────────────────────────────────────────────────────┐
│ ACC ATD v2 │ UTC clock │ 충돌 N │ WHAT-IF │ ▶시뮬레이션 │ ? │
├─ Alert Bar (충돌 시) ─────────────────────────────────────────┤
│ ⚠ A vs B @ZONE — 분리 X분 (필요 3분)        [Resolve] [×]    │
├─ Main ──────────────────────────────┬─ Right ─────────────────┤
│                                     │ MINI MAP (지도)         │
│  Time Ribbon (타임라인)             ├─────────────────────────┤
│  - 항공편 바 / 충돌 / ATD 마커      │ INSPECTOR (상세정보)    │
├─ Splitter ──────────────────────────┴─────────────────────────┤
├─ Bottom 3-Panel ──────────────────────────────────────────────┤
│ DEPARTURE QUEUE    │ CONFLICT WATCHLIST │ AUDIT TIMELINE      │
│ NOW±30분 카드      │ 충돌 처리 대기열    │ 변경 이력           │
└───────────────────────────────────────────────────────────────┘
```

---

## 주요 조작법

### ATD 발부 (3가지 방법)
1. **Departure Queue**: 카드의 `NOW` / `+1m` / `+5m` 버튼 클릭
2. **Inspector**: 항공편 선택 후 시간 버튼 또는 HH:MM 직접 입력
3. **Time Ribbon**: 항공편 바를 드래그하여 시간 조정

### 충돌 해결
1. Alert Bar의 `[Resolve]` 클릭 또는 헤더 `충돌 N` 클릭
2. ConflictWizard에서 옵션 선택:
   - A: 후행편 지연 (권장)
   - B: 선행편 보류
   - C: 항로/고도 변경
   - D: 현 상태 수용

### 시뮬레이션
1. 헤더의 `▶ 시뮬레이션` 클릭
2. 배속 선택: 1× / 5× / 10× / 30×
3. 시간 슬라이더로 특정 시점 이동
4. `✕` 또는 `ESC`로 종료

### 키보드 단축키

| 키 | 기능 |
|---|------|
| `↑` / `↓` | ATD ±1분 |
| `Shift+↑` / `Shift+↓` | ATD ±5분 |
| `Enter` | NOW 적용 |
| `Ctrl+Z` | 되돌리기 (Undo) |
| `ESC` | 모달 닫기 / 시뮬레이션 종료 |
| `A` `B` `C` `D` | ConflictWizard 옵션 선택 |

---

## 문제 해결

### 서버가 시작되지 않을 때
1. `stop.bat` 실행 후 다시 `start.bat` 실행
2. 포트 7300, 7301이 다른 프로그램에서 사용 중인지 확인

### 브라우저에서 접속되지 않을 때
1. 서버 창에 오류 메시지가 있는지 확인
2. 방화벽에서 포트 7300, 7301 허용 여부 확인

### node_modules 오류
- 폐쇄망 환경에서는 `node_modules`가 포함된 배포본을 사용해야 합니다
- 인터넷 환경이라면 `npm install` 실행

---

## 상세 문서

- [README.md](doc/README.md) - ACC ATD v2 상세 개요
- [USER_FLOWS.md](doc/USER_FLOWS.md) - 3대 사용자 흐름 (ATD 발부, 충돌 방지, 시뮬레이션)
- [UX_IMPROVEMENTS.md](doc/UX_IMPROVEMENTS.md) - UX 개선 항목
- [FEATURE_GAPS.md](doc/FEATURE_GAPS.md) - 기능 부족 항목
- [ROADMAP.md](doc/ROADMAP.md) - 개발 로드맵

---

## 기술 스택

- **Frontend**: Vite, Vanilla JavaScript, Canvas API
- **Backend**: Node.js, Express, SQLite
- **Python**: Oracle DB 연동용 (선택적)

---

## 버전 정보

- **버전**: 2.0
- **최종 업데이트**: 2026-06-18
