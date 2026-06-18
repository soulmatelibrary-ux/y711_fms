/**
 * Simulation Bridge — 항공편 경로 위치 보간
 * 노드 좌표/경로 설정: src/config/miniMapGeo.js
 */
import { timeToSec, toAbsSec } from '../utils/timeUtils.js';
import { GEO, AIRPORT_COLOR, ROUTE_CONFIG } from '../config/miniMapGeo.js';

/**
 * 시뮬레이션 시각(simTimeSec)에 각 항공편의 SVG 좌표를 반환한다.
 * @param {string|null} targetFlightId - SIM 버튼으로 시작된 대상 항공편 id
 * @returns {{ id, callsign, x, y, color, altitudeFt, isAtd, isTarget }[]}
 */
export function computeSimPositions(flights, simTimeSec, targetFlightId = null) {
    const dots = [];
    for (const f of flights) {
        const isAtd = !!f.atd;
        // ATD = 실제 이륙시각, CTOT = 이륙 예정 시각 (groundSec 미포함)
        const groundSec = f.groundTimeSec || 0;
        const depTime = isAtd ? toAbsSec(timeToSec(f.atd)) : toAbsSec(timeToSec(f.ctot || f.eobt));
        if (!depTime) continue;

        const elapsed = simTimeSec - depTime;
        if (elapsed < 0) continue;

        const fl = parseInt(String(f.cfl || '').replace(/[^0-9]/g, ''), 10) || 250;
        const targetAltFt = fl * 100;
        const climbRatio = Math.max(0, Math.min(1, elapsed / (10 * 60)));
        const altitudeFt = Math.round(targetAltFt * climbRatio);

        // ── routeWaypoints(EXFIXTIME) 기반 보간 — ALT맵과 동일한 데이터 소스 사용 ──
        // 두 뷰가 항상 같은 위치를 가리키도록 우선 적용하고 없으면 ROUTE_CONFIG fallback
        if (f.routeWaypoints && f.routeWaypoints.length > 0) {
            const depPos = GEO[f.dept];
            if (depPos) {
                const pts = [
                    { t: depTime, pos: depPos },
                    ...f.routeWaypoints
                        .filter(w => Number.isFinite(w.timeSec) && GEO[w.name])
                        .map(w => ({ t: w.timeSec, pos: GEO[w.name] }))
                ];
                if (simTimeSec <= pts[pts.length - 1].t) {
                    let ai = pts.length - 1;
                    for (let i = 1; i < pts.length; i++) {
                        if (simTimeSec <= pts[i].t) { ai = i; break; }
                    }
                    const a = pts[ai - 1], b = pts[ai];
                    const dt = b.t - a.t;
                    const frac = dt > 0 ? Math.max(0, Math.min(1, (simTimeSec - a.t) / dt)) : 0;
                    dots.push({
                        id: f.id,
                        callsign: f.callsign,
                        x: a.pos.x + (b.pos.x - a.pos.x) * frac,
                        y: a.pos.y + (b.pos.y - a.pos.y) * frac,
                        color: AIRPORT_COLOR[f.dept] || '#4fc3f7',
                        altitudeFt,
                        isAtd,
                        isTarget: f.id === targetFlightId,
                    });
                }
                continue;
            }
        }

        // ── ROUTE_CONFIG fallback (EXFIXTIME 없는 경우) ──
        const route = ROUTE_CONFIG[f.dept];
        if (!route) continue;

        const totalT = route[route.length - 1].t;
        if (elapsed >= totalT) continue;

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
            altitudeFt,
            isAtd,
            isTarget: f.id === targetFlightId,
        });
    }
    return dots;
}
