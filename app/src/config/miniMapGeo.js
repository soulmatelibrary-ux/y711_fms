/**
 * MiniMap 지리 설정 — MiniMap.js 와 simulationBridge.js 가 공유
 *
 * ★ y 좌표는 시간 비례 배치 (PX_PER_MIN = 14)
 *   RKSS 출발 기준 t분 → y = TOP_Y + t * PX_PER_MIN
 *
 *   스파인: RKSS(t=0) → BULTI(t=8) → MEKIL(t=10) → MANGI(t=21)
 *           → DALSU(t=23) → RKPC(t=33)
 *
 *   측면 공항: 해당 합류점 도달 시각에서 각 공항→합류점 비행시간을 역산
 *     RKTU(t=3):  MEKIL(t=10) − 7분 = t=3
 *     RKJK(t=18): MANGI(t=21) − 3분 = t=18
 *     RKJJ(t=22): DALSU(t=23) − 1분 = t=22
 */

export const MAP_W = 360;

/** 시간→픽셀 기본 스케일 (1분 = 20px) */
export const PX_PER_MIN = 20;
/** 스파인 최상단 y 여백 */
export const TOP_Y = 50;
/** 전체 경로 소요 시간(분) */
export const ROUTE_TOTAL_MIN = 33;

/** 기본 맵 총 높이 (동적 변경 시 MiniMap._mapH() 사용) */
export const MAP_H = TOP_Y + ROUTE_TOTAL_MIN * PX_PER_MIN + 60;

// ── 공항 색상 ────────────────────────────────────────────────
export const AIRPORT_COLOR = {
    RKSS: '#58a6ff',
    RKTU: '#bc8cff',
    RKJK: '#39c5bb',
    RKJJ: '#d29922',
};

export const AIRPORT_BG = {
    RKSS: '#0d2040',
    RKTU: '#1a0d2e',
    RKJK: '#0d2020',
    RKJJ: '#281a00',
};

// ── 시간 비례 y 계산 헬퍼 ───────────────────────────────────
const t = (min, ppm = PX_PER_MIN) => TOP_Y + min * ppm;

/**
 * 주어진 px/분 스케일로 GEO 좌표를 재계산한다.
 * pxPerMin 기본값 = PX_PER_MIN (14)
 */
export function buildGeo(pxPerMin = PX_PER_MIN) {
    return {
        RKSS:  { x: 72,  y: t(0,  pxPerMin), label: '김포', type: 'airport', side: 'left'  },
        RKTU:  { x: 262, y: t(3,  pxPerMin), label: '청주', type: 'airport', side: 'right' },
        RKJK:  { x: 72,  y: t(18, pxPerMin), label: '군산', type: 'airport', side: 'left'  },
        RKJJ:  { x: 262, y: t(22, pxPerMin), label: '광주', type: 'airport', side: 'right' },
        BULTI: { x: 152, y: t(8,  pxPerMin), label: 'BULTI', type: 'conv' },
        MEKIL: { x: 152, y: t(10, pxPerMin), label: 'MEKIL', type: 'conv', labelDy: -8 },
        MANGI: { x: 152, y: t(21, pxPerMin), label: 'MANGI', type: 'conv' },
        DALSU: { x: 152, y: t(23, pxPerMin), label: 'DALSU', type: 'conv' },
        RKPC:  { x: 152, y: t(33, pxPerMin), label: '제주',  type: 'dest'  },
    };
}

// ── 기본 GEO (backward-compat) ───────────────────────────────
export const GEO = buildGeo();

// ── MiniMap 렌더링용 경로 엣지 ───────────────────────────────
export const ROUTES = [
    ['RKSS',  'BULTI'],
    ['BULTI', 'MEKIL'],
    ['RKTU',  'MEKIL'],
    ['MEKIL', 'MANGI'],
    ['RKJK',  'MANGI'],
    ['RKJJ',  'DALSU'],
    ['MANGI', 'DALSU'],
    ['DALSU', 'RKPC'],
];

// ── MiniMap 경로 하이라이트용 ────────────────────────────────
export const ROUTE_MAP = {
    RKSS: ['RKSS', 'BULTI', 'MEKIL', 'MANGI', 'DALSU', 'RKPC'],
    RKTU: ['RKTU', 'MEKIL', 'MANGI', 'DALSU', 'RKPC'],
    RKJK: ['RKJK', 'MANGI', 'DALSU', 'RKPC'],
    RKJJ: ['RKJJ', 'DALSU', 'RKPC'],
};

// ── 시뮬레이션 경로 타이밍 (출발로부터 경과 초) ──────────────
export const ROUTE_CONFIG = {
    RKSS: [
        { name: 'RKSS',  t:     0 },
        { name: 'BULTI', t:  8*60 },
        { name: 'MEKIL', t: 10*60 },
        { name: 'MANGI', t: 21*60 },
        { name: 'DALSU', t: 23*60 },
        { name: 'RKPC',  t: 33*60 },
    ],
    RKTU: [
        { name: 'RKTU',  t:     0 },
        { name: 'MEKIL', t:  7*60 },
        { name: 'MANGI', t: 18*60 },
        { name: 'DALSU', t: 20*60 },
        { name: 'RKPC',  t: 30*60 },
    ],
    RKJK: [
        { name: 'RKJK',  t:    0 },
        { name: 'MANGI', t: 3*60 },
        { name: 'DALSU', t: 5*60 },
        { name: 'RKPC',  t: 15*60 },
    ],
    RKJJ: [
        { name: 'RKJJ',  t:    0 },
        { name: 'DALSU', t: 1*60 },
        { name: 'RKPC',  t: 11*60 },
    ],
};
