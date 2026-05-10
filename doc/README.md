# Y711 FMS — 도메인 개요

서해안 항공로(Y711)를 이용하는 제주행 항공편의 출발 시간을 관리하고, 합류 웨이포인트에서의 분리 기준을 충족하도록 CTOT를 계산하는 시스템입니다.

> 운영·배포 절차는 [`operations/`](./operations/) 폴더, 아키텍처는 [`ARCHITECTURE.md`](./ARCHITECTURE.md), 시작 방법은 루트의 [`../README.md`](../README.md)를 참고하세요.

---

## 대상 공항

| ICAO | 공항 | 합류지점 | 진입시간 | 이륙간격 |
|------|------|---------|---------|---------|
| RKSS | 김포 | BULTI | 8분 | 4분 |
| RKTU | 청주 | MEKIL | 7분 | 10분 |
| RKJK | 군산 | MANGI | 3분 | 10분 |
| RKJJ | 광주 | DALSU | 1분 | 10분 |

## 웨이포인트 토폴로지

```
RKSS ─► BULTI ─┐
RKTU ─► MEKIL ─┤
RKJK ─► MANGI ─┼─► GONAX ─► BEDES ─► ELPOS ─► NULDI ─► DOTOL ─► RKPC (제주)
RKJJ ─► DALSU ─┘
```

각 구간 시간은 `src/services/ctot.js`의 `waypoints[]` / `segmentConfig{}`에 정의되어 있으며, UI의 설정 화면에서 사용자별로 조정 가능합니다.

---

## 핵심 기능

| 영역 | 동작 |
|------|------|
| **CTOT 계산** | EOBT → 동일공항 이륙간격 → 웨이포인트 분리(180s) 순으로 적용 |
| **충돌 감지** | MEKIL / MANGI / DALSU에서 3분 미만 분리 시 경고 |
| **시뮬레이션** | 1× / 2× / 5× / 10× / 20× 배속, 항공기 위치 시각화 |
| **Excel 업로드** | 기간 기반 부분 업데이트, 중복 경고 ([EXCEL_GUIDE](./operations/EXCEL_GUIDE.md)) |
| **인증** | SQLite 사용자 테이블, 30분 idle 타임아웃 |

---

## CTOT 계산 흐름

```
EOBT 기준 최소값 결정
        │
        ▼
동일 공항 이륙 간격 적용 (prev_ctot + dep_interval)
        │
        ▼
웨이포인트 도착 시간 계산 (taxi + entry + segments)
        │
        ▼
충돌 검사 (separation < 180s 이면 지연)
        │
        ▼
flight.ctot 저장 + 후속 항공편 재계산
```

---

## 문서 인덱스

### 도메인·아키텍처
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — 모듈식 구조 (components/services/utils)
- [`QUICK_START.md`](./QUICK_START.md) — 빠른 사용 안내

### 운영
- [`operations/OPERATIONS.md`](./operations/OPERATIONS.md) — **운영 절차 통합본** (배포·포트·API·DB)
- [`operations/TROUBLESHOOTING.md`](./operations/TROUBLESHOOTING.md) — 접속·빌드·런타임 문제
- [`operations/SECURITY.md`](./operations/SECURITY.md) — 보안 정책 및 환경 변수
- [`operations/EXCEL_GUIDE.md`](./operations/EXCEL_GUIDE.md) — Excel 스케줄 업로드 규약

### ACC 콘솔 v2
- [`../acc-v2/doc/README.md`](../acc-v2/doc/README.md) — ACC ATD v2 사용자 중심 개요 (USER_FLOWS / UX / 기능격차 / ROADMAP 포함)

### 샘플
- [`samples/rpl-sample-may2026.xlsx`](./samples/rpl-sample-may2026.xlsx) — 표준 Excel 템플릿
- [`samples/atd-management-mockup.html`](./samples/atd-management-mockup.html) — UI 디자인 목업

### 과거 자료
- [`../backup/old-docs/`](../backup/old-docs/) — 과거 리뷰/체크리스트/구현 로그 원본 (참고용)
