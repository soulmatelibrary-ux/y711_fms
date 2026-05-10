/**
 * MiniMap 지리 설정 — MiniMap.js 와 simulationBridge.js 가 공유
 *
 * ★ 노드 위치(GEO)를 변경하면 이 파일만 수정하면 됩니다.
 *   MiniMap 렌더링과 시뮬레이션 항공기 이동이 자동으로 동기화됩니다.
 *
 * 스파인: RKSS → BULTI → MEKIL → JNKR → MANGI → DALSU → RKPC
 */

// ── SVG 좌표 공간 크기 ────────────────────────────────────────
export const MAP_W = 360;
export const MAP_H = 520;

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

// ── 노드 좌표 (SVG 기준) ─────────────────────────────────────
// type: 'airport' | 'conv' | 'junction' | 'dest'
// junction: 레이블 없는 소형 합류 다이아몬드
export const GEO = {
    RKSS:  { x: 72,  y: 35,  label: '김포',  type: 'airport',  side: 'left'  },
    RKJK:  { x: 72,  y: 240, label: '군산',  type: 'airport',  side: 'left'  },
    RKTU:  { x: 262, y: 175, label: '청주',  type: 'airport',  side: 'right' },
    RKJJ:  { x: 262, y: 315, label: '광주',  type: 'airport',  side: 'right' },
    BULTI: { x: 152, y: 95,  label: 'BULTI', type: 'conv' },
    MEKIL: { x: 152, y: 175, label: 'MEKIL', type: 'conv' },
    JNKR:  { x: 152, y: 290, label: '',      type: 'junction' },
    MANGI: { x: 152, y: 335, label: 'MANGI', type: 'conv' },
    DALSU: { x: 152, y: 415, label: 'DALSU', type: 'conv' },
    RKPC:  { x: 152, y: 490, label: '제주',  type: 'dest'  },
};

// ── MiniMap 렌더링용 경로 엣지 ───────────────────────────────
export const ROUTES = [
    ['RKSS',  'BULTI'],
    ['BULTI', 'MEKIL'],
    ['RKTU',  'MEKIL'],
    ['MEKIL', 'JNKR'],
    ['RKJK',  'JNKR'],
    ['JNKR',  'MANGI'],
    ['RKJJ',  'MANGI'],
    ['MANGI', 'DALSU'],
    ['DALSU', 'RKPC'],
];

// ── MiniMap 경로 하이라이트용 (공항 클릭/선택 시 활성 구간 판별) ──
export const ROUTE_MAP = {
    RKSS: ['RKSS', 'BULTI', 'MEKIL', 'JNKR', 'MANGI', 'DALSU', 'RKPC'],
    RKTU: ['RKTU', 'MEKIL', 'JNKR', 'MANGI', 'DALSU', 'RKPC'],
    RKJK: ['RKJK', 'JNKR', 'MANGI', 'DALSU', 'RKPC'],
    RKJJ: ['RKJJ', 'MANGI', 'DALSU', 'RKPC'],
};

// ── 시뮬레이션 경로 타이밍 (출발로부터 경과 초) ──────────────
export const ROUTE_CONFIG = {
    RKSS: [
        { name: 'RKSS',  t:     0 },
        { name: 'BULTI', t:  5*60 },
        { name: 'MEKIL', t: 15*60 },
        { name: 'JNKR',  t: 22*60 },
        { name: 'MANGI', t: 25*60 },
        { name: 'DALSU', t: 35*60 },
        { name: 'RKPC',  t: 50*60 },
    ],
    RKTU: [
        { name: 'RKTU',  t:     0 },
        { name: 'MEKIL', t: 10*60 },
        { name: 'JNKR',  t: 17*60 },
        { name: 'MANGI', t: 20*60 },
        { name: 'DALSU', t: 30*60 },
        { name: 'RKPC',  t: 45*60 },
    ],
    RKJK: [
        { name: 'RKJK',  t:     0 },
        { name: 'JNKR',  t:  7*60 },
        { name: 'MANGI', t: 12*60 },
        { name: 'DALSU', t: 22*60 },
        { name: 'RKPC',  t: 37*60 },
    ],
    RKJJ: [
        { name: 'RKJJ',  t:     0 },
        { name: 'MANGI', t:  8*60 },
        { name: 'DALSU', t: 18*60 },
        { name: 'RKPC',  t: 33*60 },
    ],
};
