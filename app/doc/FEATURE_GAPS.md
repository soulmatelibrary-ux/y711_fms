# FEATURE GAPS — 기능 부족 항목 (F1~F20)

도메인 정확성 / 누락 기능 / 메인 시스템 통합 / 운영·안정성 + **운영 미사용 자산 정리** 5분류로 정리. 우선순위는 [`ROADMAP.md`](./ROADMAP.md) 와 연동.

---

## A. 도메인 정확성 (Critical)

### F1. CTOT 분리 검사 부등호 결함 — `P0`
- **문제**: `Math.abs(diff) < zone.separationMin*60` 가 앞서 가는(=조기 통과) 항공편까지 후행과 동일하게 처리해 잘못 지연시킬 수 있다.
- **근거**: `acc-v2/src/services/ctotEngine.js` 의 분리 검사 로직 (line ~88)
- **권장**: 후행편(`diff > 0` 즉 자기 시각이 선행보다 늦을 때)에 한정해 `diff < zone.separationMin*60` 검사. 선행편은 영향 없음.
- **회귀 테스트**: 동일 웨이포인트에 EOBT 가 더 늦지만 비행 시간이 짧아 먼저 도착하는 케이스 → 후행으로 잡혀 잘못 지연되지 않는지 확인.

### F2. `recalcFrom` 다운스트림 누락 — `P2`
- **문제**: 변경된 인덱스 이후만 재정렬 + 재계산 → 그래프 추적이 없어 후속 비행에 충돌 영향이 누락될 수 있음.
- **근거**: `ctotEngine.js:108~129`
- **권장**: 전체 재계산(`recalcAll`) 호출 또는 변경된 비행이 통과하는 모든 zone 의 후속 비행을 명시적으로 재검사. 성능이 우려되면 영향 그래프 캐싱.

### F3. `safety=20` hop 고정 — `P2`
- **문제**: waypoint 체인이 20개를 초과하면 침묵 종료.
- **근거**: `ctotEngine.js:23`
- **권장**: 데이터 기반 동적 한계 또는 한계 도달 시 경고 로그.

---

## B. 누락 기능 (사용자 기대)

### F4. 검색 / 필터 — `P2`
- **문제**: 콜사인 / 출발지 / 시간대로 항공편을 빠르게 찾을 방법이 없다.
- **권장**: Header 또는 Departure Queue 상단에 검색박스. `Cmd/Ctrl+F` 단축키. 출발지·상태 다중 필터 토글.

### F5. 일괄 처리 — `P2`
- **문제**: ConflictWizard 는 1건씩만 처리. 공항 단위 일괄 지연이 UI 에 노출되지 않음.
- **근거**: `whatifEngine.js` 의 `delayAirport()` 는 이미 구현됨.
- **권장**: 헤더 메뉴 "공항별 일괄 지연" → 공항 선택 + 지연 분 입력 → 일괄 적용 + Audit 1건으로 묶음 기록.

### F6. 충돌 해결 미리보기 — `P1`
- **문제**: ConflictWizard 옵션이 클릭 즉시 적용 → 연쇄 영향을 사전에 알 수 없다.
- **근거**: `atdManager.previewAtd()` 가 이미 존재.
- **권장**: 옵션 hover 시 우측 미리보기 패널: "이 결정의 영향: B+3m, C+5m, D+0m". 확정 버튼 누르기 전에는 적용 안 함.

### F7. Inspector HH:MM 직접 입력 — `P1`
- **문제**: NOW / ±1m / ±5m 버튼만 존재 → 임의 시각 지정 불가.
- **권장**: Inspector 에 `HH:MM` 텍스트 입력 + Enter 로 확정. 형식 검증 + 잘못된 입력 시 빨간 테두리.

### F8. Audit / Advisory 내보내기 — `P2`
- **문제**: 화면 내 표시만 가능. 사후 보고서/감사에 활용 불가.
- **권장**: AuditTimeline 우상단 "↓ CSV", "📋 복사", "🖨 인쇄" 버튼. Advisory 도 동일.

### F9. 멀티유저 표시 — `P3`
- **문제**: 화면에 다른 ACC 사용자가 있는지 알 수 없음.
- **권장**:
  - 헤더에 접속자 수 / 아바타
  - 변경 시 Audit 항목에 `by username` 표시 (서버 audit 테이블에 user 컬럼 존재)
  - 동시 수정 충돌 시 경고

### F10. 시각적 시뮬레이션 — `P0` (가장 부족)
- **문제**: acc-v2 에 시뮬레이션 자체가 없음. 메인 SPA 의 1×~20× 재생이 미통합.
- **근거**: `src/services/simulation.js` (메인 SPA) 는 이미 존재.
- **권장 (MVP 분해)**:
  1. 헤더에 `▶ 시뮬레이션` 토글 + 배속 셀렉트(1×/2×/5×/10×/20×)
  2. 시간 슬라이더 (NOW ±2시간) + 임의 시각 점프
  3. 시뮬레이션 시각이 진행되면 TimeRibbon 의 NOW 라인 이동 + MiniMap 항공기 점 보간 이동
  4. What-if 모드와 결합: 가상 시각화
  5. 종료 시 NOW 로 복귀

상세 단계는 [`USER_FLOWS.md C`](./USER_FLOWS.md) 참조.

---

## C. 메인 시스템 통합

### F11. 루트 README 에 acc-v2 섹션 추가 — `P0`
- **문제**: 루트 `README.md` 어디에도 acc-v2 미언급 → 발견 불가.
- **권장**: 루트 README 의 "주요 기능" 또는 "디렉터리 구조" 다음에 "ACC 콘솔 v2" 한 단락 추가. 진입 URL `http://localhost:7300/acc-v2/` 명시.

### F12. Excel 업로드 경로 통합 — `P3`
- **문제**: 메인 SPA 가 Excel 업로드(SheetJS) 를 담당하는데 acc-v2 는 별도 진입점.
- **권장**: acc-v2 헤더에 "메인 시스템에서 업로드 →" 링크. 또는 메인 모달 컴포넌트를 재사용.

### F13. 401 응답 통일 / 세션 일관화 — `P3`
- **문제**: acc-v2 도 `localStorage.getItem('userId')` 만 보고 통과 (`acc-v2/main.js:23`). 메인의 30분 idle 타임아웃과 일관되지 않을 수 있음.
- **권장**:
  - 모든 API 호출에서 401 응답 → 로그인 페이지로 즉시 리다이렉트
  - 30분 idle 타이머 acc-v2 에도 적용 (메인 SPA `main-modular.js` 참조)

### F14. 로그아웃 서버 호출 — `P3`
- **문제**: localStorage 만 제거. 서버 세션 무효화 호출 없음.
- **권장**: `/api/auth/logout` POST → redirect.

---

## D. 운영 / 안정성

### F15. API 실패 토스트 / 재시도 — `P1`
- **문제**: `apiPost('/api/v2/atd', ...)` 실패가 silent (`atdManager.js:81`).
- **권장**:
  - 실패 시 토스트 + 재시도 버튼
  - 오프라인 시 대기 큐 → 복귀 시 자동 재전송 (선택)

### F16. UI 환경설정 영속화 — `P3`
- **문제**: 새로고침 시 What-if / 선택 / 스플리터 위치 모두 초기화.
- **권장**: `localStorage` 에 `splitterHeight`, `selectedFlightId`, `whatifActive` 저장.

### F17. Whatif `O(n²)` 재계산 — `P3`
- **문제**: `adjustCtot()` 가 호출마다 전체 재계산 (`whatifEngine.js:38`).
- **권장**: 디바운스(150ms) + diff 기반 부분 재계산.

### F18. i18n 분리 — `P3`
- **문제**: 한국어 하드코딩.
- **권장**: i18n 모듈 도입은 먼 미래. 우선순위 낮음.

---

## E. 운영 미사용 자산 정리

### F19. Conflict Watchlist 도입 (Tower Advisory 대체) — `P1`
- **문제**: bottom panel 가운데의 `TOWER ADVISORY` 패널은 자동 권고문을 생성·전송하도록 설계됐지만, 실제 운영에서는 ATD 정보를 본 시스템을 통해 타워와 송수신하지 않고 외부 채널로 관리한다. 결과적으로 패널이 사장되어 가치가 없는 화면 영역을 점유 중이며, Alert Bar 의 critical 1건 표시 한계(U8)로 다중 충돌 가시성도 부족하다.
- **근거**: `acc-v2/main.js:147` (TOWER ADVISORY 헤더), `acc-v2/src/components/TowerAdvisory.js`, `acc-v2/src/services/advisoryGen.js`, `acc-v2/src/services/atdManager.js:100~140` (`generateAdvisories()`)
- **권장**: 해당 슬롯을 **Conflict Watchlist** (활성 충돌 처리 대기열) 로 전환. NEW/ACK/AUTO_RESOLVED 상태 머신, 카드 단위 Resolve/Ack/Dismiss, Alert Bar 와 역할 분리(영속 vs 즉시 알림). 헤더 `권고 N` 배지는 제거하고 `충돌 N` 배지에 통합.
- **상세 설계**: [`CONFLICT_WATCHLIST_DESIGN.md`](./CONFLICT_WATCHLIST_DESIGN.md)
- **회귀 테스트**: ATD 변경 → 충돌 N건 발생 → 카드 N개 노출 / 자동 해소 시 5초 페이드 / `Ack` 후 새로고침 시 초기화(메모리만) / `×` 후 동일 충돌 재계산 시 재출현.

### F20. Tower Advisory 자산 deprecate — `P2`
- **문제**: F19 도입 후 `TowerAdvisory.js`, `advisoryGen.js`, `atdManager.generateAdvisories()`, `state.pendingAdvisories`, 헤더 `badge-adv` 가 미참조 자산으로 남는다. 서버 측 `/api/v2/advisory*` 라우트와 `advisory_*` DB 테이블도 동상.
- **근거**: 동상 + `api-server.js` 의 `/api/v2/advisory` 라우트들 (README 5절 참조)
- **권장**:
  - **클라이언트** — 컴포넌트/서비스/state 즉시 제거 (W3, [`ROADMAP.md`](./ROADMAP.md))
  - **서버 라우트** — `// DEPRECATED 2026-05-10` 주석 + 호출 없음 확인. 코드 보존(롤백 용이) — 별도 cleanup PR 에서 삭제 (W6)
  - **DB 테이블** — 마이그레이션 미수행. 차후 데이터 정책 수립 후 결정.
- **회귀 테스트**: `grep -rn "TowerAdvisory\|pendingAdvisories\|advisoryGen\|badge-adv" acc-v2/src acc-v2/main.js acc-v2/style.css` → 0 hit (서버 코드 제외).

---

## 우선순위 분포 요약

| 우선순위 | 항목 |
|---------|------|
| **P0** | F1, F10, F11 |
| **P1** | F6, F7, F15, F19 |
| **P2** | F2, F3, F4, F5, F8, F20 |
| **P3** | F9, F12, F13, F14, F16, F17, F18 |

전체 로드맵·검증·체크리스트는 [`ROADMAP.md`](./ROADMAP.md).
