/**
 * Simulation Bridge — 항공편 경로 위치 보간
 * 노드 좌표/경로 설정: src/config/miniMapGeo.js
 */
import { timeToSec } from '../utils/timeUtils.js';
import { GEO, AIRPORT_COLOR, ROUTE_CONFIG } from '../config/miniMapGeo.js';

/**
 * 시뮬레이션 시각(simTimeSec)에 각 항공편의 SVG 좌표를 반환한다.
 * @returns {{ id, callsign, x, y, color }[]}
 */
export function computeSimPositions(flights, simTimeSec) {
    const dots = [];
    for (const f of flights) {
        if (f.status === 'DEP') continue;
        const depTime = timeToSec(f.atd || f.ctot || f.eobt);
        if (!depTime) continue;

        const elapsed = simTimeSec - depTime;
        if (elapsed < 0) continue;

        const route = ROUTE_CONFIG[f.dept];
        if (!route) continue;

        const totalT = route[route.length - 1].t;
        if (elapsed >= totalT) continue;

        // elapsed 위치의 세그먼트 찾기
        let segStart = route[0], segEnd = route[1];
        for (let i = 1; i < route.length; i++) {
            if (elapsed <= route[i].t) {
                segStart = route[i - 1];
                segEnd   = route[i];
                break;
            }
        }

        const segDur = segEnd.t - segStart.t;
        const frac = segDur > 0 ? (elapsed - segStart.t) / segDur : 0;

        const p1 = GEO[segStart.name];
        const p2 = GEO[segEnd.name];
        if (!p1 || !p2) continue;

        dots.push({
            id: f.id,
            callsign: f.callsign,
            x: p1.x + (p2.x - p1.x) * frac,
            y: p1.y + (p2.y - p1.y) * frac,
            color: AIRPORT_COLOR[f.dept] || '#4fc3f7',
        });
    }
    return dots;
}
