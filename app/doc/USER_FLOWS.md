# USER FLOWS — 3대 사용자 흐름

acc-v2 의 가치는 다음 세 가지 사용자 흐름에 압축된다. 각 흐름은 **목적 / 현재 단계(소스 인용) / 사용자 마찰 / 개선 후 단계** 의 구조로 정리한다.

---

## A. ATD 발부 (목표 1 — 쉽게 발부)

### 목적
관제사가 NOW ±30분 항공편의 ATD 를 빠르고 정확하게 결정한다. 결정 즉시 후속 항공편의 CTOT 가 재계산되고 변경 이력이 남는다.

### 현재 단계 (현행)
1. 좌측 캔버스 또는 Departure Queue 에서 항공편 식별
2. **다음 셋 중 하나로** ATD 결정:
   - **TimeRibbon 드래그** (`acc-v2/main.js:228~230` `onAtdDrop`) — 어포던스 없음
   - **Inspector 버튼**: `NOW`, `−1m`, `+1m` (`Inspector.js`)
   - **Departure Queue 버튼**: `NOW`, `+1m`, `+5m` (`DepartureQueue.js`)
3. `atdManager.setAtd()` 호출 → `recalcFrom()` 으로 후속 CTOT 갱신 → `/api/v2/atd` 저장 → `atd:updated` 이벤트 발행
4. Audit Timeline 에 항목 추가

### 사용자 마찰
| ID | 마찰 | 영향 |
|----|------|------|
| U5 | 드래그가 어포던스 없이 즉시 적용됨 | 실수로 15분 지연 입력 시 복구 어려움 |
| U6 | Undo 부재 (`atdManager.js:97` 의 `prevFlights` 미노출) | 복구 = 직접 역방향 입력 |
| F7 | HH:MM 직접 입력 불가 | NOW±N 으로 끼워맞춰야 함 |
| F15 | API 실패가 console.warn 로만 처리 | 사용자가 저장 여부 확신 못함 |

### 개선 후 단계 (목표)
1. Departure Queue 카드 클릭 → Inspector 강조(border 깜빡임)
2. Inspector 에 **HH:MM 입력란** + 기존 `NOW / ±1m / ±5m` 버튼 함께 노출
3. 또는 캔버스에서 **`cursor: grab` + 드래그 가이드선 + 임시 라벨**(`+5m` 미리보기) → 드롭 시 적용
4. 적용 즉시 화면 우하단에 **"↶ 5초 내 되돌리기"** 토스트
5. 키보드 단축키: `↑/↓ ±1m`, `Shift+↑/↓ ±5m`, `Enter NOW`, `Cmd/Ctrl+Z` Undo
6. 서버 저장 실패 → 토스트 + 재시도 버튼; 성공 → "저장됨" 미니 배지

> 관련 항목: [`UX_IMPROVEMENTS.md U5/U6/U9/U11`](./UX_IMPROVEMENTS.md), [`FEATURE_GAPS.md F7/F15`](./FEATURE_GAPS.md).

---

## B. 충돌 방지 (목표 2 — 서로의 충돌 방지)

### 목적
합류 웨이포인트(BULTI/MEKIL/MANGI/DALSU 등)에서 분리 기준(180s 기본) 미만인 항공편 쌍을 사전에 감지하고 해결한다.

### 현재 단계 (현행)
1. 데이터 로드 또는 ATD 변경 시 `detectConflicts(state.flights)` (`acc-v2/main.js:62`) 실행
2. Alert Bar 에 **가장 critical 한 1건** 표시 (`main.js:240~260`)
3. **Conflict Watchlist 패널** (bottom panel 가운데) 에 **활성 충돌 N건 모두** 카드 형태로 나열 — `NEW` / `ACK` 상태 표시
4. 헤더 `충돌 N` 클릭, Alert Bar `[Resolve]`, 또는 Watchlist 카드 `[Resolve]` → ConflictWizard 모달
5. 옵션 A/B/C/D 선택 → 즉시 적용
   - A: 후행편 지연(권장)
   - B: 선행편 보류
   - C: 항로/고도 변경 (메모)
   - D: 수용 (메모)
6. 적용 후 분리 충족 시 Watchlist 카드 자동 페이드 → 제거. 사용자가 인지만 하고 처리 보류 시 `[Ack]` 로 우선순위 하향.

> **Alert Bar 와 Watchlist 의 역할 분리** — Alert Bar = "지금 이거 봐" (critical 1건 즉시 알림 / ×로 임시 숨김). Watchlist = "처리 대기열" (모든 활성 충돌 영속 / 닫음 ≠ 해결). 자세한 설계는 [`CONFLICT_WATCHLIST_DESIGN.md`](./CONFLICT_WATCHLIST_DESIGN.md).

### 사용자 마찰
| ID | 마찰 | 영향 |
|----|------|------|
| F1 | `Math.abs(diff) < zone.separationMin*60` 가 앞서 가는 비행도 충돌로 간주 | False-positive → 잘못된 지연 |
| U8 | Alert Bar 1건만 보여주고, ×로 닫으면 새 충돌이 와도 재출현 보장 약함 | 다중 충돌 누락 위험 |
| F6 | 옵션 클릭 = 즉시 적용 (미리보기 없음) | 연쇄 영향 사전 검토 불가 |
| F2 | `recalcFrom` 이 변경 인덱스 이후만 재정렬·재계산, 그래프 추적 없음 | 중간 비행 변경 시 후속 누락 가능 |
| U9 | A/B/C/D 핫키 / ESC 닫기 미지원 | 마우스 의존 → 느림 |

### 개선 후 단계 (목표)
1. ~~충돌 N건일 때 Alert Bar "1/N" 페이지네이션~~ ([P1-5 완료](./ROADMAP.md))
2. **Conflict Watchlist 패널** — 활성 충돌 N건을 영속 카드 목록으로 (W1~W5, [`CONFLICT_WATCHLIST_DESIGN.md`](./CONFLICT_WATCHLIST_DESIGN.md))
3. 새 충돌 발생 시 **자동 재출현** + 헤더 배지 깜빡임 + 짧은 알림음
4. ConflictWizard 옵션 **hover** 시 우측에 미리보기 패널: "이 결정의 영향: B+3m, C+5m" — `atdManager.previewAtd()` 활용
5. **A/B/C/D 핫키** + **ESC 닫기**, 권장 옵션은 Enter 로 즉시 적용
6. 적용 시 `recalcAll(state.flights)` 로 전체 재검사 (F2 보강)
7. F1 부등호 수정으로 false-positive 제거 → 후행편(`diff > 0` 인 경우)에 한정해 분리 검사

> 관련 항목: [`UX_IMPROVEMENTS.md U8/U9`](./UX_IMPROVEMENTS.md), [`FEATURE_GAPS.md F1/F2/F6/F19`](./FEATURE_GAPS.md), [`CONFLICT_WATCHLIST_DESIGN.md`](./CONFLICT_WATCHLIST_DESIGN.md).

---

## C. 시각적 시뮬레이션 (목표 3 — 가장 부족)

### 목적
관제사가 결정한 ATD/CTOT 가 시간이 흐를 때 **언제 어디서** 충돌 가능성이 있는지 시각적으로 확인한다. 1×~20× 배속 재생, 임의 시각 점프, MiniMap 상의 항공기 이동을 지원한다.

### 현재 단계 (현행)
- **acc-v2 에는 시뮬레이션 자체가 없다.** 모든 표시는 NOW 기준 정적.
- 메인 SPA 의 `src/services/simulation.js` 가 1×~20× 배속·위치 보간 로직을 이미 보유하지만 acc-v2 에 미통합.

### 사용자 마찰
- 미래 시점의 항공기 위치/충돌을 머릿속으로만 추정해야 함.
- What-if 모드 가 있지만 "값이 바뀌었다" 만 보여줄 뿐 시간 흐름을 표현하지 못함.
- 훈련/리허설 도구로 부족.

### 개선 후 단계 (목표 — ROADMAP P0)
1. 헤더에 **`▶ 시뮬레이션`** 토글 + **배속 선택**(1×/2×/5×/10×/20×)
2. **시간 슬라이더 (NOW ±2시간)** — 임의 시각으로 점프 가능
3. 시뮬레이션 시각이 진행되면 **MiniMap 상에 항공기 점이 이동** — 위치 보간은 `src/services/simulation.js` 로직 재사용
4. **TimeRibbon 의 NOW 라인이 함께 이동** + 통과한 충돌 영역 강조
5. **What-if 모드와 결합**: 시뮬레이션 도중 ATD 를 바꾸면 가상 시각화로 결과 확인
6. **종료** 시 NOW 로 즉시 복귀, 시뮬레이션 중 발생한 변경은 폐기 또는 적용 선택

### MVP 분해 (P0 범위)
- 1단계: 시간 슬라이더 + NOW 라인 이동 + 정적 항공기 점
- 2단계: 1×/5× 배속 자동 재생
- 3단계: MiniMap 항공기 위치 보간
- 4단계: 충돌 영역 시각 강조

> 관련 항목: [`FEATURE_GAPS.md F10`](./FEATURE_GAPS.md), [`ROADMAP.md P0`](./ROADMAP.md).

---

## 흐름 간 상호작용 정리

```
[ATD 발부 A]   ──ATD 변경──►   [충돌 재검사 B]   ──충돌 N건──►   [Alert/Wizard]
     │                                                              │
     └──시뮬레이션 C─────────────────────────────────────────────► 시각 검증
```

세 흐름은 독립적이지 않다. ATD 변경(A) 은 충돌(B) 을 유발/해소하며, 시뮬레이션(C) 은 (A)·(B) 의 결과를 시간 축에서 검증한다. UI 는 이 세 흐름이 하나의 작업 사이클임을 시각적으로 드러내야 한다.
