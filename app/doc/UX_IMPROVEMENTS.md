# UX IMPROVEMENTS — 사용성 개선 항목 (U1~U14)

발견성(Discoverability) / 어포던스(Affordance) / 가독성(Readability) 3분류로 정리. 각 항목에 대응 우선순위(P0~P3)는 [`ROADMAP.md`](./ROADMAP.md) 와 연동된다.

---

## A. 발견성 (Discoverability) — 첫 사용자가 무엇을 할 수 있는지 알게 한다

### U1. 코치마크 + 도움말 모달 — `P0`
- **문제**: 첫 진입 시 빈 캔버스와 약어 배지(충돌/권고/WHAT-IF)만 보인다. 무엇을 클릭/드래그할지 알 수 없다.
- **근거**: `acc-v2/main.js:83~131` `renderApp()` — 가이드 요소 없음.
- **권장**:
  - 첫 진입 시 1회성 코치마크(점선 + 화살표): ① 헤더 배지 의미 ② 캔버스 드래그=ATD 변경 ③ Departure Queue 카드 클릭=Inspector 로딩
  - 헤더 우측에 `?` 도움말 버튼 상시 노출 → "이 화면 사용법" 모달
  - `localStorage.acc_v2_seen_intro` 플래그로 1회 표시

### U2. 평문 자격증명 노출 제거 — `P0`
- **문제**: 로그인 화면에 `기본 계정: admin / katc0012#$` 가 그대로 노출되어 있다.
- **근거**: `acc-v2/login.html:69`
- **권장**: 평문 제거 → "관리자에게 문의하세요" 안내. 첫 로그인 후 강제 비밀번호 변경 플로우(서버 측 `mustChangePassword` 플래그) 추가는 P2.

### U3. 약어 / 색상 범례 — `P2`
- **문제**: CTOT, EOBT, ATD, CFL, RKSS/RKTU/RKJK/RKJJ 색상 의미를 화면 어디에서도 설명하지 않음.
- **근거**: Inspector 라벨 11px (작음) + MiniMap 색상 코딩 미문서화.
- **권장**:
  - 모든 약어 라벨에 `title=` 툴팁 일괄 추가 (`EOBT → 예상 이륙시각 (Estimated Off-Block Time)`)
  - 헤더 우측 "용어" 모달 — 표 형태로 약어 + 한국어 + 색상 범례 정리
  - MiniMap 우상단에 미니 범례(공항 색상 dot · 충돌 영역 빨강 · 활성 경로 실선)

### U4. 빈 상태 다음 행동 안내 — `P2`
- **문제**: "항공편을 선택하세요", "NOW±30분 내 출발편 없음" 등은 사실만 알려준다.
- **근거**: `Inspector.js`, `DepartureQueue.js` 빈 상태.
- **권장**: 다음 행동을 명시. 예: "← 좌측 큐에서 카드를 클릭하거나 캔버스에서 항공편을 클릭하세요". 비어있는 큐의 경우 "10분 후 자동 새로고침. [지금 새로고침]" 버튼.

---

## B. 어포던스 (Affordance) — 가능한 행동을 시각·키보드로 드러낸다

### U5. 드래그 가이드 + 미리보기 — `P1`
- **문제**: TimeRibbon 드래그=ATD 변경이 비가시. 드롭 시점에서야 결과만 표시되며, 실수로 15분 늦게 드롭하면 즉시 반영.
- **근거**: `acc-v2/main.js:228~230` `onAtdDrop`
- **권장**:
  - hover 시 `cursor: grab`
  - 드래그 중 가이드 점선 + 임시 라벨 미리보기 (`+5m`, `−2m`)
  - 드롭 후 5초 Undo 토스트 ("↶ 되돌리기")

### U6. Undo / Redo 노출 — `P1`
- **문제**: `atdManager` 가 `prevFlights` 스냅샷(`atdManager.js:97`)을 저장하지만 사용자에게 노출 안 됨.
- **권장**:
  - 헤더에 `↶ 되돌리기` 버튼
  - 단축키: Cmd/Ctrl+Z (Undo), Cmd/Ctrl+Shift+Z (Redo)
  - 마지막 N(=10) 단계 스택 유지 (메모리 안전)

### U7. What-if 진입/이탈 띠 — `P3`
- **문제**: 활성화 시 본문 가장자리에 금색 테두리만 추가되어 "변경이 가짜다" 는 인식이 약하다.
- **근거**: `main.js:274~290`, `style.css:537~540`
- **권장**:
  - 활성 시 본문 상단에 고정 띠: "WHAT-IF 시나리오 모드 — 변경은 저장되지 않습니다 [적용 / 취소]"
  - 종료 시 다이얼로그: "변경 사항을 적용하시겠습니까?"

### U8. 충돌 N건 페이지네이션 — `P1` _(완료 + Watchlist 로 보강 예정)_
- **문제**: Alert Bar 가 가장 critical 한 1건만 보여주고, ×로 닫으면 새 충돌이 와도 재출현 보장이 약함.
- **근거**: `main.js:528~573` `updateAlertBar` (P1-5 에서 페이지네이션 적용 완료)
- **권장**:
  - ✅ "1/N" 페이지네이션 (`◀ 1/3 ▶`) — 완료
  - ✅ 새 충돌 발생 시 자동 재출현 + 헤더 배지 깜빡임 — 완료
  - 🆕 **Conflict Watchlist** 패널 도입 — Alert Bar 와 별도로 N건 영속 카드 목록 ([`CONFLICT_WATCHLIST_DESIGN.md`](./CONFLICT_WATCHLIST_DESIGN.md), W1~W5)
  - 닫음 ≠ 해결, 새 충돌 발생 시 재표시

### U9. 키보드 접근성 — `P1`
- **문제**: ESC 로 모달이 안 닫히고, A/B/C/D 핫키 없음. NOW/+1m/+5m 도 클릭 전용.
- **근거**: ConflictWizard / DepartureQueue / Inspector 전반
- **권장**:
  - ESC = 모달 닫기
  - ↑/↓ = ATD ±1m, Shift+↑/↓ = ±5m
  - Enter = NOW
  - A/B/C/D = ConflictWizard 옵션 즉시 선택, Enter = 권장 옵션
  - 헤더 우상단 `?` → 단축키 표

---

## C. 가독성 (Readability) — 정보 위계와 형태를 다듬는다

### U10. 반응형 / 최소폭 — `P2`
- **문제**: `--right-w: 380px`, `--bottom-h: 560px` 고정. 1280px 이하에서 레이아웃 깨짐.
- **근거**: `acc-v2/style.css` 에 `@media` 부재.
- **권장**:
  - 헤더에 권장 해상도 표기 (>= 1280px)
  - 1024px 이하에서 우측/하단 패널을 토글 가능한 사이드 시트로

### U11. Inspector ATD↔CTOT 편차 강조 — `P2`
- **문제**: 약어 라벨 11px + 한 컬럼. 핵심 수치(ATD vs CTOT 편차) 가 한눈에 안 들어옴.
- **근거**: `acc-v2/src/components/Inspector.js`
- **권장**:
  - 편차(Δ)를 큰 글씨(24~32px)로 강조, 색상 (+지연=빨강, −조기=파랑)
  - 같은 줄에 단축 액션(NOW/±1m/HH:MM)

### U12. MiniMap 범례 + 클릭 선택 — `P2`
- **문제**: 색상/충돌 영역/대시 라인 범례가 없다. 또한 항공편 클릭이 비활성.
- **근거**: `acc-v2/src/components/MiniMap.js`
- **권장**:
  - 우상단 미니 범례 (공항 dot · 충돌 영역 · 활성/비활성 경로)
  - 항공편 클릭 시 `onFlightSelect()` 연결

### U13. Audit 클릭 → 캔버스 하이라이트 — `P2`
- **문제**: 단방향 텍스트 로그. 어떤 항공편을 클릭해도 캔버스에서 하이라이트되지 않음.
- **근거**: `acc-v2/src/components/AuditTimeline.js`
- **권장**:
  - 항목 클릭 시 해당 flightId 를 `onFlightSelect()` 로 연결
  - CSV 내보내기 / 클립보드 복사 / 인쇄

### U14. Advisory 전송 실패 토스트 — ~~`P1`~~ _(deprecated — Tower Advisory 제거됨, 2026-05-10)_
- **문제**: 전송 실패가 `console.warn` 만 호출 → 사용자가 알 수 없음.
- **근거**: `acc-v2/src/components/TowerAdvisory.js:75`
- **상태**: Tower Advisory 패널 자체가 운영 미사용으로 제거됨 ([`F19/F20`](./FEATURE_GAPS.md), [`CONFLICT_WATCHLIST_DESIGN.md`](./CONFLICT_WATCHLIST_DESIGN.md)). 본 항목 무효.
- **승계 항목**: API 실패 토스트는 [`F15`](./FEATURE_GAPS.md) 로 일반화하여 유지 (이미 P1-7 에서 구현 완료).

---

## 우선순위 분포 요약

| 우선순위 | 항목 |
|---------|------|
| **P0** | U1, U2 |
| **P1** | U5, U6, U8, U9, ~~U14~~ |
| **P2** | U3, U4, U10, U11, U12, U13 |
| **P3** | U7 |

> U14 는 Tower Advisory 제거(F19/F20)와 함께 deprecated. F15 (일반 API 실패 토스트) 로 승계.

전체 로드맵 및 검증 시나리오는 [`ROADMAP.md`](./ROADMAP.md).
