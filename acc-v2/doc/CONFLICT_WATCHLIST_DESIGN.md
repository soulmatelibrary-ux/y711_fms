# CONFLICT WATCHLIST — 기술 설계서

`acc-v2/` 의 `TOWER ADVISORY` 패널을 **`CONFLICT WATCHLIST` (충돌 감시 목록)** 으로 대체하기 위한 설계 문서. 운영 현장에서 ATD 정보가 본 시스템을 통해 타워와 송수신되지 않으므로 Tower Advisory 패널은 사장된 공간이며, 이를 acc-v2 의 두 번째 사용자 목표(`충돌 방지`) 를 직접 지원하는 처리 대기열 패널로 전환한다.

> 관련 문서: [`README.md`](./README.md) · [`USER_FLOWS.md B`](./USER_FLOWS.md) · [`FEATURE_GAPS.md F19/F20`](./FEATURE_GAPS.md) · [`UX_IMPROVEMENTS.md U8`](./UX_IMPROVEMENTS.md) · [`ROADMAP.md W1~W6`](./ROADMAP.md)

---

## 1. 동기 (Why)

| 현재 (TOWER ADVISORY) | 목표 (CONFLICT WATCHLIST) |
|----------------------|---------------------------|
| ATD 변경 → 후속 항공편 권고문 자동 생성 | ATD 변경 → 후속 충돌 항목 처리 대기열 갱신 |
| `Send` 버튼 = `/api/v2/advisory` 전송 | `Resolve` = ConflictWizard, `Ack` = 인지 처리, `×` = 임시 해제 |
| 실제 운영 미사용 (외부 채널로 관리) | 실제 운영 핵심 — 모든 활성 충돌 한눈에 |
| Alert Bar 가 critical 1건만, 나머지 묻힘 (U8) | Alert Bar 보완 — 전체 충돌 영속 목록 |

**핵심 차별화** — Alert Bar 는 "지금 이거 봐" (1건 즉시 알림), Watchlist 는 "처리 대기열" (N건 영속). 닫음 ≠ 해결.

---

## 2. 요구사항

### 기능 요구
- F1. 모든 활성 충돌(`state.conflicts`) 을 시간순/심각도순으로 나열한다.
- F2. 항목 상태: `NEW`(새로 감지), `ACK`(사용자가 인지), `AUTO_RESOLVED`(분리 충족으로 자동 소멸 — 5초 페이드 후 제거).
- F3. 항목 액션: `Resolve` (ConflictWizard 진입), `Ack` (인지 표시 — 처리 우선순위 하향), `×` (이번 세션 한정 숨김).
- F4. `atd:updated` 이벤트마다 동기 갱신: 새 충돌은 `NEW` 추가, 사라진 충돌은 `AUTO_RESOLVED` 마킹.
- F5. 헤더 `충돌 N` 배지 클릭 시 Watchlist 컨테이너로 스크롤/포커스(스크롤은 bottom panel 안에서, 포커스는 첫 항목).
- F6. 키보드: Watchlist 포커스 상태에서 `J/K` 항목 이동, `Enter` Resolve, `Space` Ack.

### 비기능 요구
- N1. ack 상태는 메모리만(새로고침 시 초기화) — P2 이상에서 localStorage 확장 가능.
- N2. 신규 서버 API 없음 — 모든 데이터는 클라이언트 `detectConflicts()` 에서 도출.
- N3. 60Hz 시뮬레이션 재생 시에도 패널 갱신 비용 < 5ms.

### 비요구
- 멀티유저 ack 공유 (P3).
- 서버 ack 영속화 (P3).
- 충돌 이력 무제한 보관 — `AUTO_RESOLVED` 는 5초 후 DOM 제거.

---

## 3. 사용자 흐름 (UX)

### 시나리오 A — 충돌 발생 → 인지 → 해결
1. ATD 변경 → BULTI 충돌 2건 신규 발생.
2. Alert Bar 에 critical 1건 노출, Watchlist 에 2건 모두 `NEW` 카드로 추가.
3. 관제사가 첫 번째 충돌을 `Ack` → 카드 회색 처리, "확인됨" 배지.
4. 두 번째 충돌 카드 `Resolve` → ConflictWizard 진입 → 옵션 확정.
5. 분리 충족 → 두 카드 모두 `AUTO_RESOLVED` 5초 페이드 → 제거.

### 시나리오 B — 충돌이 다른 액션으로 자동 해소
1. 충돌 카드 `NEW` 표시 중, 관제사가 다른 항공편 ATD 변경.
2. 재계산 결과 분리 충족 → Watchlist 에서 해당 카드 `AUTO_RESOLVED` 페이드 → 제거.
3. 별도 클릭 불필요. Audit 에는 자동 해소 사유 미기록(이미 `atd:updated` audit 항목이 존재).

### 시나리오 C — `×` 임시 해제
1. 관제사가 의도적으로 충돌을 수용(D 옵션 메모) 후 `×` 클릭.
2. 카드 사라짐. **단, 해당 충돌이 다음 `atd:updated` 에서도 여전히 존재하면 다시 `NEW` 로 재출현** (닫음 ≠ 해결 원칙).

---

## 4. 컴포넌트 / 파일 구조

### 신규
- `acc-v2/src/components/ConflictWatchlist.js` — 패널 컴포넌트
- `acc-v2/src/services/watchlistState.js` — ack/dismiss 메모리 상태 관리 (선택 — 외부화 안 하면 컴포넌트 내부에서 관리)

### 수정
- `acc-v2/main.js` — import 교체, `state.pendingAdvisories` → `state.watchlist`, 헤더 `권고 N` 배지 제거, bottom panel 헤더 텍스트 갱신, `atd:updated` 핸들러에서 watchlist 갱신
- `acc-v2/style.css` — `.adv-*` 클래스를 `.wl-*` 로 대체 (재활용 + 신규 상태 스타일)
- `acc-v2/index.html` — 변경 없음

### 제거
- `acc-v2/src/components/TowerAdvisory.js` — 완전 삭제
- `acc-v2/src/services/advisoryGen.js` — 완전 삭제
- `acc-v2/src/services/atdManager.js` 의 `generateAdvisories()` 함수 및 `_state.pendingAdvisories` 참조 제거

### deprecate (보존, 클라이언트 호출만 제거)
- 서버 `api-server.js` 의 `/api/v2/advisory*` 라우트 — 코드 그대로 두되 본 PR 에서 호출하지 않음. 추후 별도 PR 로 제거.
- `advisory_*` DB 테이블 — 마이그레이션 미수행, 차후 cleanup PR.

---

## 5. 데이터 모델

### 5-1. 충돌 키 (정규화)
충돌 객체의 안정적 식별을 위해 `(zone, callsignA, callsignB)` 의 **정렬된 callsign 쌍** 으로 키를 만든다 (역순도 같은 키).

```javascript
function conflictKey(c) {
  const [a, b] = [c.f1.callsign, c.f2.callsign].sort();
  return `${c.zone}|${a}|${b}`;
}
```

> `flightId` 가 변하지 않는다는 가정이 약하다면 callsign 기반이 더 안정적.

### 5-2. Watchlist 상태
```javascript
state.watchlist = {
  items: Map<conflictKey, WatchItem>,  // 활성 항목
  ackedKeys: Set<conflictKey>,          // 사용자가 ack 한 키
  dismissedKeys: Set<conflictKey>,      // 이번 세션 한정 ×로 숨긴 키
  filter: 'all' | 'critical' | 'warning' | 'unacked'
};

interface WatchItem {
  key: string;
  conflict: ConflictObject;     // detectConflicts() 결과 1건
  state: 'new' | 'acked' | 'resolved';
  detectedAt: number;            // unix sec
  resolvedAt: number | null;     // AUTO_RESOLVED 시점 (페이드용)
}
```

### 5-3. 갱신 알고리즘 (`atd:updated` 마다 호출)
```text
input: 새로 계산된 conflicts[]
1. newKeys = conflicts.map(conflictKey)
2. 기존 items 중 newKeys 에 없는 것:
   - state = 'resolved', resolvedAt = now
   - 5초 후 setTimeout 으로 items.delete(key)
3. newKeys 중 items 에 없는 것:
   - dismissedKeys 에 있으면 → items 추가하되 'new' 로 (재출현)
   - 신규 items.set(key, { state: ackedKeys.has(key) ? 'acked' : 'new', ... })
4. 기존 items 중 newKeys 에 있는 것:
   - conflict 객체 업데이트 (timeDiffSec 변동 반영), state 유지
5. 렌더 트리거
```

핵심: **`ackedKeys` 와 `dismissedKeys` 는 충돌이 사라져도 보존**한다 (같은 충돌이 다시 나타날 때 ack 가 유지되도록). 단, `dismissedKeys` 는 다음 발생 시점에 1회 무시 후 자동 해제(원칙: "닫음은 일시적").

세션 한정으로 두는 이유: 영속화(localStorage) 는 P2 이상 항목.

---

## 6. 컴포넌트 API

### `ConflictWatchlist`
```javascript
new ConflictWatchlist(container, {
  onResolve: (conflict) => void,    // → conflictWizard.open(conflict)
  onSelect:  (flightId) => void,    // 카드 클릭 시 main 의 onFlightSelect
})

watchlist.update(conflicts, { ackedKeys, dismissedKeys })
//   외부 state 와 동기화. 내부에서 items Map 갱신 + 렌더.

watchlist.focusFirst()
//   헤더 배지 클릭 시 첫 카드 포커스.

watchlist.setFilter('critical' | 'warning' | 'unacked' | 'all')
```

### 이벤트 흐름
```
ATD 변경
  └─ atdManager.setAtd()
       ├─ recalcFrom() → conflicts 재계산
       └─ document.dispatchEvent('atd:updated', { conflicts })
            └─ main.js 핸들러:
                 ├─ watchlist.update(state.conflicts, state.watchlist)
                 ├─ updateAlertBar()
                 ├─ updateBadges()  ← 권고 N 제거, 충돌 N 만 갱신
                 └─ ribbon/miniMap/queue 갱신 (기존)
```

---

## 7. 헤더 / Alert Bar 통합

### 헤더 변경 (main.js:92~94)
```diff
- <span class="h-badge badge-conflicts zero" id="badge-conflicts" title="충돌 클릭 시 첫 번째 충돌로 이동">충돌 0</span>
- <span class="h-badge badge-adv" id="badge-adv">권고 0</span>
+ <span class="h-badge badge-conflicts zero" id="badge-conflicts" title="클릭 시 Watchlist 첫 항목으로 포커스">충돌 0</span>
```

### `badge-conflicts` 클릭 동작 (main.js:464)
```diff
- if (e.target.id === 'badge-conflicts') scrollToFirstConflict();
+ if (e.target.id === 'badge-conflicts') {
+   // 1. Alert Bar 가 visible 이면 첫 충돌로 ConflictWizard 열기
+   // 2. 아니면 Watchlist 컨테이너로 스크롤 + 첫 카드 포커스
+   if (document.getElementById('alert-bar')?.classList.contains('visible')) {
+     openFirstConflict();
+   } else {
+     watchlist.focusFirst();
+   }
+ }
```

### Alert Bar 와의 역할 분리
| 항목 | Alert Bar | Conflict Watchlist |
|------|-----------|--------------------|
| 위치 | 헤더 아래 (top, 36px) | bottom panel 가운데 슬롯 |
| 표시 | critical 1건 (페이지네이션) | 전체 N건, 영속 |
| 닫기 | × 로 임시 숨김, 새 충돌 시 재출현 | × 임시 dismiss, 다음 갱신 시 재평가 |
| 액션 | Resolve, ◀▶ 페이지네이션 | Resolve, Ack, × |
| 자동 갱신 | 새 충돌 시 즉시 노출 | 모든 변경 시 동기화 |

---

## 8. UI 사양

### 8-1. 패널 헤더
```
┌─ CONFLICT WATCHLIST   [모두] [critical] [unacked]   N건 ──┐
```
- 우측 필터 토글 — 기본 `모두`. 활성 시 `.wl-filter-active`.
- N건 = `items.size` (resolved 제외).

### 8-2. 카드 레이아웃
```
┌──────────────────────────────────────────────┐
│ ● BULTI    KAL123 vs AAR456   [NEW]          │
│   분리 1m 32s  /  필요 4m  (Δ −2m 28s)        │
│   [Resolve]  [Ack]  [×]                       │
└──────────────────────────────────────────────┘
```
- 좌상단 점: severity (critical=빨강, warning=노랑).
- 우상단 배지: `NEW` (파랑) / `ACK` (회색) / `RESOLVED` (초록 페이드).
- 본문 1줄: callsign 쌍 + zone, 2줄: 분리/필요/Δ.
- 액션 버튼 — `Resolve` 강조(파랑), `Ack` 보조, `×` 작게.

### 8-3. 빈 상태
```
충돌 없음 — NOW±30분 분리 충족
```

### 8-4. CSS 클래스 (style.css)
```
.wl-card        — 기본 카드 (세로 8px, 가로 12px padding)
.wl-card.new    — 좌측 4px 파란 띠
.wl-card.acked  — opacity 0.55, 띠 회색
.wl-card.resolved — opacity 0 transition, 5s 후 제거
.wl-sev-critical / .wl-sev-warning — 좌상단 점 색
.wl-empty       — 빈 상태 안내
.wl-filter      — 헤더 필터 토글
```

기존 `.adv-*` 의 padding/border 토큰은 재사용 가능 (디자인 일관성 유지).

---

## 9. 단계별 PR 분해

각 단계는 단일 PR / 단일 commit 그룹.

### W1 — 컴포넌트 신설 (UI 만, 더미)
- `ConflictWatchlist.js` 신규 (렌더 + 이벤트 hook 만)
- `style.css` 에 `.wl-*` 클래스 추가
- `main.js` 에서는 아직 미사용 — Storybook 처럼 더미 데이터로 동작 확인 (또는 임시 import 후 테스트)

### W2 — state.watchlist 도입 + atd:updated 연결
- `state.watchlist` 객체 추가
- `main.js` 의 `atd:updated` 핸들러에서 `watchlist.update(...)` 호출
- 카드 클릭 → `onFlightSelect`, Resolve → `conflictWizard.open` 연동
- Alert Bar 와 병존 (이중 표시 OK — 의미 차별화 검증 단계)

### W3 — Tower Advisory 자산 제거
- `TowerAdvisory.js`, `advisoryGen.js` 삭제
- `atdManager.js` 의 `generateAdvisories()` 함수 + `pendingAdvisories` 참조 제거
- `main.js` 의 `import TowerAdvisory`, `advisory` 변수, `bp-section` 헤더 텍스트 변경 (`TOWER ADVISORY` → `CONFLICT WATCHLIST`), `advisory-body` → `watchlist-body`
- `style.css` 의 `.adv-*` 잔재 제거

### W4 — 헤더 배지 통합
- `badge-adv` (권고 N) DOM 제거
- `updateBadges()` 함수에서 `pendingAdv` 계산 로직 제거
- `badge-conflicts` 클릭 동작을 Alert Bar visible 여부에 따라 분기 (Section 7 참조)

### W5 — 키보드 접근성
- Watchlist 포커스 상태에서 J/K, Enter, Space 단축키
- 도움말 모달의 단축키 표(main.js:349~360) 갱신

### W6 — 서버 라우트 deprecate 표기 (별도 PR)
- `api-server.js` 의 `/api/v2/advisory*` 라우트 위에 `// DEPRECATED 2026-05-10 — Tower Advisory removed in favor of Conflict Watchlist` 주석
- DB 테이블/마이그레이션은 후속 cleanup PR (선택)

---

## 10. 검증 시나리오

매 PR 마무리 시 통과:

1. **수동 시나리오** (`npm run dev` → `http://localhost:7300/acc-v2/`)
   - ① 항공편 ATD 변경 → 충돌 2건 발생 → Watchlist 에 2건 표시 + Alert Bar 1건 표시
   - ② 카드 `Ack` → 회색 처리, ackedKeys 에 추가
   - ③ 다른 ATD 변경으로 충돌 자동 해소 → 카드 페이드아웃 5초 후 제거
   - ④ 카드 `×` → 즉시 사라짐, 다음 변경에서 동일 충돌 존재 시 NEW 로 재출현
   - ⑤ `Resolve` → ConflictWizard 진입, 확정 후 Watchlist 갱신
   - ⑥ 헤더 `충돌 N` 클릭 → Alert Bar visible 여부에 따라 동작 분기 정상

2. **회귀**
   - Tower Advisory 제거에도 ATD 변경 흐름(setAtd → recalc → audit) 정상
   - `pendingAdvisories` 참조 잔재 없음 (`grep -rn pendingAdvisories acc-v2/src acc-v2/main.js` → 0)

3. **빌드**: `npm run build` — 0 errors

4. **반응형**: 1024 / 1280 / 1920 px Watchlist 카드 가독성

---

## 11. 결정 기록 (ADR 요약)

| ID | 결정 | 근거 |
|----|------|------|
| D1 | ack 상태 메모리만, localStorage 미사용 | MVP 단순화. P2 에서 확장. |
| D2 | 서버 advisory 라우트 deprecate 보존 | DB 마이그레이션 분리. 롤백 용이. |
| D3 | 헤더 `권고 N` 배지 제거, `충돌 N` 통합 | 정보 위계 단순화. Watchlist 가 처리 대기열 역할. |
| D4 | 충돌 키 = `(zone, sorted callsigns)` | flightId 변동 가능성 < callsign 안정성. |
| D5 | dismissed 는 1회성, 다음 발생 시 자동 재출현 | "닫음 ≠ 해결" 원칙. |
| D6 | 자동 해소 항목은 5초 페이드 후 DOM 제거 | 영속 이력은 AuditTimeline 에 이미 존재. |

---

## 12. 후속 (out of scope)

- **localStorage ack 영속화** — 재로그인/새로고침 시 처리 상태 유지 (P2)
- **서버 ack 공유** — 멀티 ACC 환경에서 한 명이 ack 하면 다른 사람도 보임 (P3)
- **자동 해소 사유 audit** — Watchlist 카드가 사라진 이유를 audit 에 기록 (P3)
- **필터 영속화** — 마지막 선택 필터 localStorage (P3)
- **CSV 내보내기** — Audit 와 동일 패턴 (P2, F8 와 묶음)

---

**버전**: 1.0 · **작성**: 2026-05-10
