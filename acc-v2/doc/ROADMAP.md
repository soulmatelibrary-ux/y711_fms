# ROADMAP & CHECKLIST

[`UX_IMPROVEMENTS.md`](./UX_IMPROVEMENTS.md) (U1~U14) + [`FEATURE_GAPS.md`](./FEATURE_GAPS.md) (F1~F20) 를 우선순위 P0~P3 로 묶은 **개발 체크리스트**다. 위에서 아래 순서대로 진행한다. 별도 워크스트림 W1~W6 (Tower Advisory → Conflict Watchlist 전환) 는 별도 섹션 참조.

체크박스: `[ ]` 미착수 · `[~]` 진행 중 · `[x]` 완료

---

## P0 — 즉시 (정확성 + 신뢰 + 발견성 + 시각화)

3대 사용자 목표 중 "정확성/신뢰" 와 "시각화" 의 발판을 동시에 마련한다.

- [x] **P0-1 · F1 CTOT 분리 검사 부등호 수정**
  - 파일: `acc-v2/src/services/ctotEngine.js`
  - 변경: `Math.abs(diff) < zone.separationMin*60` → `(diff > 0 && diff < zone.separationMin*60)`
  - 검증: 앞서 가는 비행 케이스로 false-positive 부재 확인.
- [x] **P0-2 · U2 평문 자격증명 노출 제거**
  - 파일: `acc-v2/login.html`
  - 변경: 하단 "기본 계정: admin / katc0012#$" 영역 제거 → "관리자에게 문의" 안내.
- [x] **P0-3 · F11 루트 README 에 acc-v2 섹션 추가**
  - 파일: `README.md`, `doc/README.md`
  - 변경: 진입 URL · 용도 · 문서 링크 1단락 추가.
- [x] **P0-4 · U1 코치마크 + 도움말 모달 (최소판)**
  - 파일: `acc-v2/main.js`, `acc-v2/style.css`
  - 변경: 헤더에 `?` 버튼 → 모달 (3대 사용자 흐름 요약 + 단축키). `localStorage.acc_v2_seen_intro` 미설정 시 첫 방문 자동 표시.
- [x] **P0-5 · F10 시각적 시뮬레이션 MVP**
  - 파일: `acc-v2/main.js`, `acc-v2/style.css`, 신규 `acc-v2/src/services/simulationBridge.js` (메인 SPA `src/services/simulation.js` 의 위치 보간 로직 재사용 어댑터)
  - 단계 분해:
    - [x] P0-5a · 헤더에 `▶ 시뮬레이션` 토글 + 배속 셀렉트
    - [x] P0-5b · 시간 슬라이더 (NOW ±2h) + TimeRibbon NOW 라인 이동
    - [x] P0-5c · 1×/5×/10×/30× 자동 재생 루프 (requestAnimationFrame 기반)
    - [x] P0-5d · MiniMap 항공기 점 보간 이동
    - [x] P0-5e · 종료 시 NOW 복귀 (✕ 버튼 / ESC)

---

## P1 — 단기 (일상 ATD 발부 / 충돌 방지 마찰 해소)

목표 1·2 의 핵심 마찰을 제거한다.

- [x] **P1-1 · U5 드래그 가이드 + 미리보기**
  - 파일: `acc-v2/src/components/TimeRibbon.js`, `acc-v2/style.css`
  - hover `cursor: grab`, drag 중 가이드 점선 + `±Nm` 라벨, drop 5초 Undo 토스트.
- [x] **P1-2 · U6 Undo / Redo 노출**
  - 파일: `acc-v2/src/services/atdManager.js`, `acc-v2/main.js`
  - 마지막 10단계 스택. 헤더 `↶` 버튼 + Cmd/Ctrl+Z. 기존 `prevFlights` 활용.
- [x] **P1-3 · F7 Inspector HH:MM 직접 입력**
  - 파일: `acc-v2/src/components/Inspector.js`
  - 텍스트 입력 + Enter 확정 + 형식 검증.
- [x] **P1-4 · F6 충돌 해결 미리보기**
  - 파일: `acc-v2/src/components/ConflictWizard.js`, `acc-v2/src/services/atdManager.js`
  - 옵션 hover → 우측 미리보기 패널 (`atdManager.previewAtd()` 활용). 확정 버튼 명시.
- [x] **P1-5 · U8 충돌 N건 페이지네이션 + 자동 재출현**
  - 파일: `acc-v2/main.js` (`updateAlertBar`)
  - `1/N` 페이지네이션, 새 충돌 시 재출현, 헤더 배지 깜빡임.
- [x] **P1-6 · U9 키보드 접근성**
  - 파일: 전 컴포넌트
  - ESC 모달 닫기, ↑/↓ ATD ±1m, Shift+↑/↓ ±5m, A/B/C/D ConflictWizard 옵션, 헤더 `?` 단축키 표.
- [x] **P1-7 · U14 / F15 API/Advisory 실패 토스트**
  - 파일: `acc-v2/src/components/TowerAdvisory.js`, `acc-v2/src/services/atdManager.js`, 신규 `acc-v2/src/utils/toast.js`
  - 실패 시 토스트 + 재시도 버튼.

---

## P2 — 중기 (가독성 / 정보 위계 / 도메인 정합성)

- [x] **P2-1 · U3 약어/색상 범례 + `title=` 일괄**
- [x] **P2-2 · U4 빈 상태 다음 행동 안내**
- [x] **P2-3 · U10 반응형 / 최소폭 표기**
- [x] **P2-4 · U11 Inspector ATD↔CTOT 편차 강조**
- [x] **P2-5 · U12 MiniMap 범례 + 클릭 선택**
- [x] **P2-6 · U13 Audit 클릭 → 캔버스 하이라이트 + CSV**
- [x] **P2-7 · F4 검색 / 필터**
- [x] **P2-8 · F5 공항별 일괄 지연 UI**
- [x] **P2-9 · F8 Audit / Advisory 내보내기**
- [x] **P2-10 · F2 `recalcFrom` 다운스트림 보강**
- [x] **P2-11 · F3 hop 한계 동적/경고**

---

## P3 — 장기 (멀티유저 / 성능 / 국제화)

- [x] **P3-1 · U7 What-if 진입 띠 + 적용/취소**
- [x] **P3-2 · F9 멀티유저 표시 (변경자 username, 접속자 수)**
- [x] **P3-3 · F12 Excel 업로드 통합 / 링크**
- [x] **P3-4 · F13 401 응답 통일 + idle 타임아웃**
- [x] **P3-5 · F14 로그아웃 서버 호출**
- [x] **P3-6 · F16 UI 환경설정 영속화**
- [x] **P3-7 · F17 Whatif 디바운스 + 부분 재계산**
- [x] **P3-8 · F18 i18n 분리**

---

## W — Conflict Watchlist 전환 (Tower Advisory 대체)

운영 현장에서 ATD 정보가 본 시스템을 통해 타워와 송수신되지 않으므로 `TOWER ADVISORY` 패널을 **`CONFLICT WATCHLIST`** (활성 충돌 처리 대기열) 로 전환한다. 전체 설계는 [`CONFLICT_WATCHLIST_DESIGN.md`](./CONFLICT_WATCHLIST_DESIGN.md). 단계별 PR 로 분해.

- [ ] **W1 · 컴포넌트 신설 (UI 만, 더미)** — `P1`
  - 신규 파일: `acc-v2/src/components/ConflictWatchlist.js`
  - 변경: `acc-v2/style.css` (`.wl-*` 클래스 추가)
  - 검증: 더미 데이터로 카드 렌더링 / NEW·ACK·RESOLVED 시각 차이 / 빈 상태 안내
- [ ] **W2 · state.watchlist 도입 + atd:updated 연결** — `P1`
  - 변경: `acc-v2/main.js` (`state.watchlist` 추가, `atd:updated` 핸들러에 `watchlist.update(...)`)
  - 카드 → `onFlightSelect`, `Resolve` → `conflictWizard.open` 연동
  - 이 단계까지는 Tower Advisory 와 병존 (의미 차별화 검증)
  - 검증: ATD 변경 시 카드 동기 갱신 / 자동 해소 5초 페이드 / `Ack` 회색 처리 / `×` dismiss 후 재출현
- [ ] **W3 · Tower Advisory 자산 제거** — `P1`
  - 삭제: `acc-v2/src/components/TowerAdvisory.js`, `acc-v2/src/services/advisoryGen.js`
  - 변경: `acc-v2/src/services/atdManager.js` (`generateAdvisories()` 함수 + `_state.pendingAdvisories` 참조 제거)
  - 변경: `acc-v2/main.js` (import, `advisory` 변수, `bp-section` 헤더 텍스트 `TOWER ADVISORY` → `CONFLICT WATCHLIST`, `advisory-body` → `watchlist-body`)
  - 변경: `acc-v2/style.css` (`.adv-*` 잔재 제거)
  - 검증: `grep -rn "TowerAdvisory\|pendingAdvisories\|advisoryGen" acc-v2/src acc-v2/main.js` → 0
- [ ] **W4 · 헤더 배지 통합** — `P2`
  - 변경: `acc-v2/main.js` (`badge-adv` DOM 제거, `updateBadges()` 에서 권고 N 제거, `badge-conflicts` 클릭 동작을 Alert Bar visible 여부에 따라 분기)
  - 검증: Alert Bar 표시 중 충돌 N 클릭 → `openFirstConflict` / 미표시 시 → `watchlist.focusFirst()`
- [ ] **W5 · 키보드 접근성** — `P2`
  - Watchlist 포커스 상태에서 J/K 항목 이동, Enter Resolve, Space Ack
  - 도움말 모달 단축키 표 (`acc-v2/main.js:349~360`) 갱신
- [ ] **W6 · 서버 advisory 라우트 deprecate 표기** — `P3`
  - 변경: `api-server.js` 의 `/api/v2/advisory*` 라우트 위에 `// DEPRECATED 2026-05-10` 주석
  - DB 테이블/마이그레이션은 별도 cleanup PR (선택)
  - 검증: 클라이언트가 advisory 엔드포인트 미호출 (네트워크 탭)

---

## 검증 시나리오 (각 PR 단위)

매 PR 마무리 시 아래 절차 통과:

1. **수동 시나리오** (`npm run dev` → `http://localhost:7300/acc-v2/`)
   - ① 첫 방문자 코치마크 표시 (`localStorage.removeItem('acc_v2_seen_intro')` 후)
   - ② Departure Queue 카드 클릭 → Inspector 강조
   - ③ Inspector 에서 HH:MM 입력 → Undo 토스트 → 되돌리기
   - ④ 충돌 클릭 → Wizard 옵션 hover 미리보기 → 확정
   - ⑤ 시뮬레이션 ▶ 5× → MiniMap 항공기 이동 / 시간 슬라이더 점프
   - ⑥ What-if 토글 → 띠 표시 → 취소
2. **도메인 회귀**
   - 앞서 가는 비행 케이스 (F1) — false-positive 부재
   - 중간 비행 ATD 변경 시 후속 비행 재계산 (F2)
3. **API 회귀**
   - `/api/v2/atd`, `/api/v2/advisory`, `/api/v2/audit` 정상 응답
   - 서버 정지 시 토스트 노출
4. **반응형**: Chrome DevTools 1024 / 1280 / 1920 px 폭 확인
5. **빌드**: `npm run build` 0 errors

---

## 진행 원칙

- **체크리스트 위에서 아래로** 순차 진행. 단, P0 은 서로 독립적이라 병렬 PR 가능.
- 각 항목은 **단일 PR / 단일 commit 그룹**으로 묶어 리뷰성 유지.
- P0-5 (시뮬레이션 MVP) 는 5개 하위 단계로 분리되어 있으므로 단계별 PR 권장.
- W1~W6 (Watchlist 전환) 도 6개 하위 단계로 분리되어 있으므로 단계별 PR 권장. W1→W2→W3 가 핵심 경로.
- 모든 변경은 위 검증 시나리오 통과 후 머지.
