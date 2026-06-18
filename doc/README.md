# ACC ATD v2 — 사용자 중심 개요

`acc-v2/` 는 **ACC(접근관제) 관제사가 ATD(Actual Take-Off Time)를 빠르게 발부하고, 합류 웨이포인트의 충돌을 즉시 방지하기 위한** v2 콘솔 프로토타입입니다. 메인 SPA(`src/main-modular.js`)가 "스케줄 작성 + CTOT 산출"에 무게를 둔다면, acc-v2 는 **"NOW ±30분 운영"** 에 집중합니다.

> 도메인 기준(공항·웨이포인트·CTOT 흐름)은 루트 [`doc/README.md`](../../doc/README.md) 와 동일합니다. 본 문서는 그 위에 사용자 흐름과 화면을 덧입힙니다.

---

## 1. Why acc-v2

| 메인 SPA (`src/`) | acc-v2 (`acc-v2/`) |
|--------------------|--------------------|
| 스케줄 입력(Excel), CTOT 사전 산출 | NOW ±30분 ATD 발부, 충돌 즉응 |
| 좌(목록) + 우(타임라인/맵) 2분할 | 헤더 + Alert + 메인 + 하단 3패널 (지휘소형) |
| 시뮬레이션 1×~20× 재생 | (현재 미통합 — ROADMAP P0 항목) |
| 사용자: 운영자/관리자 | 사용자: ACC 관제사 |

acc-v2 는 **현재 시각을 중심으로** 항공편 큐를 보고, 카드/캔버스 한 번의 입력으로 ATD 를 정하며, 충돌이 발생하면 권고/Audit 로 흐름을 잇는 데 최적화되어 있습니다.

---

## 2. 대상 공항 / 웨이포인트 (도메인 뼈대)

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

CTOT 계산 흐름은 루트 `doc/README.md` 와 동일: **EOBT → 동일공항 이륙간격 → 웨이포인트 분리(180s) → 충돌 검사**.

---

## 3. 화면 구조

```
┌─ Header ──────────────────────────────────────────────────────┐  44px
│ ✈ ACC ATD v2 │ UTC clock │ 충돌 N │ 권고 N │ WHAT-IF │ user │  로그아웃 │
├─ Alert Bar (충돌 시) ───────────────────────────────────────┤  0~36px
│ ⚠ A vs B @ZONE — 분리 X분 (필요 3분)        [Resolve] [×]   │
├─ Main ──────────────────────────────────┬─ Right ───────────┤
│                                         │ MINI MAP (280px)  │
│  Time Ribbon (Canvas)                   ├───────────────────┤
│  - 항공편 바 / 충돌 / ATD 마커           │ INSPECTOR         │
│  - 드래그=ATD 변경 (P1: 가이드 추가)     │ (선택 항공편 상세)│
├─ Splitter (드래그 / 더블클릭) ─────────┴───────────────────┤
├─ Bottom 3-Panel ───────────────────────────────────────────┤
│ DEPARTURE QUEUE      │ CONFLICT WATCHLIST │ AUDIT TIMELINE │
│ NOW±30분 카드        │ 활성 충돌 처리 대기열 │ 변경 이력      │
└─────────────────────────────────────────────────────────────┘
```

**입력 위치 요약**: ATD 발부는 `Departure Queue 카드` / `Inspector 버튼` / `Time Ribbon 드래그` 세 곳에서 가능. 충돌 해결은 `Alert Bar [Resolve]` 또는 헤더의 `충돌 N` 클릭으로 ConflictWizard 모달 진입.

---

## 4. 3대 사용자 흐름 한 줄 요약

1. **ATD 발부**: 카드 선택 → Inspector / 캔버스 / 큐 버튼 중 한 곳에서 시간 결정 → 5초 Undo 가능 → 서버 저장.
2. **충돌 방지**: Alert Bar 또는 충돌 배지 → ConflictWizard → 옵션 hover 시 영향 미리보기 → 확정.
3. **시각적 시뮬레이션**: (예정) 헤더 ▶ → 1×~20× → 시간 슬라이더 → MiniMap 항공기 이동.

자세한 단계는 [`USER_FLOWS.md`](./USER_FLOWS.md).

---

## 5. API 엔드포인트 (`/api/v2/*`)

`api-server.js:443~647` 기준. 모든 인증 라우트는 `x-user-id` / `x-username` 헤더 필요.

| 메서드 | 경로 | 인증 | 용도 |
|-------|------|------|------|
| GET | `/api/v2/settings/airports` | — | 공항 목록 |
| PUT | `/api/v2/settings/airports/:icao` | — | 공항 설정 변경 |
| GET | `/api/v2/settings/segments` | — | 구간 시간 |
| PUT | `/api/v2/settings/segments` | — | 구간 시간 변경 |
| GET | `/api/v2/settings/waypoints` | — | 웨이포인트 |
| GET | `/api/v2/settings/conflict-zones` | — | 충돌 검사 영역 |
| PUT | `/api/v2/settings/conflict-zones/:wp` | — | 영역 변경 |
| GET | `/api/v2/flights/today` | ✅ | 오늘 항공편 |
| POST | `/api/v2/atd` | ✅ | ATD 저장 |
| POST | `/api/v2/advisory` | ✅ | _(deprecated, 2026-05-10 — Tower Advisory 제거됨, [`CONFLICT_WATCHLIST_DESIGN.md`](./CONFLICT_WATCHLIST_DESIGN.md) 참조)_ |
| GET | `/api/v2/advisory/pending` | ✅ | _(deprecated, 동상)_ |
| GET | `/api/v2/audit` | ✅ | 변경 이력 |

---

## 6. 빠른 시작

```bash
# 메인 시스템과 동일한 서버 사용
npm install
npm run dev          # 7300 포트
```

브라우저 → `http://localhost:7300/acc-v2/` (접근 시 로그인 페이지 표시).

> 기본 관리자 계정은 루트 `.env` 의 `DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD` 를 따릅니다. 평문 자격증명을 화면에 노출하지 마십시오 ([`UX_IMPROVEMENTS.md U2`](./UX_IMPROVEMENTS.md)).

---

## 7. 문서 인덱스

- [`USER_FLOWS.md`](./USER_FLOWS.md) — ATD 발부 / 충돌 방지 / 시각적 시뮬레이션 (현재 vs 목표)
- [`UX_IMPROVEMENTS.md`](./UX_IMPROVEMENTS.md) — 사용성 개선 항목 (U1~U14)
- [`FEATURE_GAPS.md`](./FEATURE_GAPS.md) — 기능 부족 항목 (F1~F20)
- [`ROADMAP.md`](./ROADMAP.md) — P0~P3 + W1~W6 + 검증 시나리오
- [`CONFLICT_WATCHLIST_DESIGN.md`](./CONFLICT_WATCHLIST_DESIGN.md) — Tower Advisory → Conflict Watchlist 전환 기술 설계

---

**버전**: 1.1  ·  **마지막 업데이트**: 2026-05-10 (Tower Advisory → Conflict Watchlist 전환)
