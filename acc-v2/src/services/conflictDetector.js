/**
 * 합류점 분리간격 충돌 감지
 */
import { getConflictZones } from '../utils/settingsLoader.js';
import { timeToSec } from '../utils/timeUtils.js';

/**
 * @returns [{zone, f1, f2, timeDiffSec, severity: 'warning'|'critical'}]
 */
export function detectConflicts(flights) {
    const zones = getConflictZones();
    const conflicts = [];

    for (const zone of zones) {
        // 해당 합류점을 통과하는 항공편 수집 (통과 시간 기준 정렬)
        const passings = [];
        for (const f of flights) {
            const wps = f.routeWaypoints || [];
            const wp = wps.find(w => w.name === zone.waypoint);
            if (wp) passings.push({ flight: f, timeSec: wp.timeSec });
        }
        passings.sort((a, b) => a.timeSec - b.timeSec);

        for (let i = 1; i < passings.length; i++) {
            const diff = passings[i].timeSec - passings[i - 1].timeSec;
            const reqSec = zone.separationMin * 60;
            if (diff < reqSec) {
                const severity = diff < (zone.separationMin - 1) * 60 ? 'critical' : 'warning';
                conflicts.push({
                    zone: zone.waypoint,
                    zoneName: zone.name,
                    f1: passings[i - 1].flight,
                    f2: passings[i].flight,
                    f1TimeSec: passings[i - 1].timeSec,
                    f2TimeSec: passings[i].timeSec,
                    timeDiffSec: diff,
                    requiredSec: reqSec,
                    severity
                });
            }
        }
    }

    return conflicts;
}

export function getFlightConflicts(flightId, conflicts) {
    return conflicts.filter(c => c.f1.id === flightId || c.f2.id === flightId);
}

export function hasCritical(conflicts) {
    return conflicts.some(c => c.severity === 'critical');
}
