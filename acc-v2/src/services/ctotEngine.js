/**
 * CTOT 계산 엔진 — DB 설정 기반 (settingsLoader에서 로드한 설정 사용)
 */
import { timeToSec, secToTime } from '../utils/timeUtils.js';
import { getAirportConfig, getSegmentTime, getWaypointChain, getConflictZones } from '../utils/settingsLoader.js';

// 공항별 기준시각 — main.js에서 setAirportRefTimes()로 주입 (HHmm 문자열, null=미설정)
let _airportRefTimes = {};

export function setAirportRefTimes(refTimes) {
    _airportRefTimes = refTimes || {};
}

/**
 * 항공편의 각 웨이포인트 통과 시간 계산
 * @returns [{name, timeSec}]
 */
export function calcWaypoints(flight, ctotSec) {
    const apt = getAirportConfig(flight.dept);
    const mergePoint = apt.mergePoint;
    const entryDur = getSegmentTime(flight.dept, mergePoint);
    const chain = getWaypointChain();

    const route = [];
    let curSec = ctotSec + entryDur * 60;
    route.push({ name: mergePoint, timeSec: curSec });

    let cur = mergePoint;
    let safety = 0;
    const MAX_HOPS = 20;
    while (safety < MAX_HOPS) {
        const leg = chain.find(wp => wp.fromWp === cur);
        if (!leg) break;
        curSec += leg.durationMin * 60;
        route.push({ name: leg.toWp, timeSec: curSec });
        cur = leg.toWp;
        safety++;
    }
    if (safety === MAX_HOPS) {
        console.warn(`[ctotEngine] calcWaypoints: hop 한계(${MAX_HOPS}) 도달 — flight ${flight.dept}, 라우트가 잘렸을 수 있습니다`);
    }
    return route;
}

/**
 * 모든 항공편의 CTOT 재계산
 * flights는 { id, dept, eobt, atd, ctot, status } 배열
 * ATD가 설정된 항공편은 ATD를 기준으로 웨이포인트 재계산만 수행
 */
export function recalcAll(flights) {
    if (!flights?.length) return [];

    const updated = flights.map(f => ({ ...f }));

    // 자정 경계 처리: KST 하루 = UTC 15:00 ~ 다음날 UTC 14:59
    // UTC 15:00(54000s) 미만인 시간(00:xx~14:xx)은 같은 KST 날의 연속 → +86400
    const toAbsSec = s => (s > 0 && s < 15 * 3600 ? s + 86400 : s);

    updated.sort((a, b) => toAbsSec(timeToSec(a.eobt)) - toAbsSec(timeToSec(b.eobt)));

    // 공항별 그룹 (EOBT 순으로 이미 정렬됨)
    const byAirport = {};
    updated.forEach(f => {
        if (!byAirport[f.dept]) byAirport[f.dept] = [];
        byAirport[f.dept].push(f);
    });

    // 각 항공편 CTOT 계산
    updated.forEach((flight, idx) => {
        // ATD 확정편은 CTOT = ATD (출발 완료)
        if (flight.status === 'DEP' && flight.atd) {
            flight.ctot = flight.atd;
            flight.routeWaypoints = calcWaypoints(flight, toAbsSec(timeToSec(flight.atd)));
            return;
        }

        const apt = getAirportConfig(flight.dept);
        const depInterval = apt.depInterval;
        const refTime = _airportRefTimes[flight.dept];
        const refSec = refTime ? toAbsSec(timeToSec(refTime)) : 0;
        let tentative = Math.max(toAbsSec(timeToSec(flight.eobt)), refSec);

        // Priority 1: 동일 공항 출발 간격
        const sameApt = byAirport[flight.dept] || [];
        const myIdx = sameApt.findIndex(f => f.id === flight.id);
        if (myIdx > 0) {
            const prev = sameApt[myIdx - 1];
            const prevCtotSec = toAbsSec(timeToSec(prev.ctot || prev.eobt));
            tentative = Math.max(tentative, prevCtotSec + depInterval * 60);
        }

        // Priority 2: 합류점 분리 확인 (이전 항공편과 비교)
        // tentative 변경 시 myWps를 재계산해야 정확한 지연값을 산출할 수 있다.
        const zones = getConflictZones();
        const maxReqSepSec = zones.reduce((m, z) => Math.max(m, z.separationMin * 60), 0);
        if (idx > 0) {
            for (let i = 0; i < idx; i++) {
                const prev = updated[i];
                const prevCtotSec = toAbsSec(timeToSec(prev.ctot || prev.eobt));

                // 출발 간격이 최대 요구 분리보다 충분히 크면 웨이포인트 계산 생략
                if (tentative - prevCtotSec >= maxReqSepSec) continue;

                const prevWps = prev.routeWaypoints || calcWaypoints(prev, prevCtotSec);

                // 이 이전편과 충돌이 없어질 때까지 tentative를 올리고 재계산 반복
                let adjusted = true;
                let iter = 0;
                const MAX_ITER = 20;
                while (adjusted && iter < MAX_ITER) {
                    adjusted = false;
                    iter++;
                    const myWps = calcWaypoints(flight, tentative);
                    for (const myWp of myWps) {
                        const zone = zones.find(z => z.waypoint === myWp.name);
                        if (!zone) continue;
                        const prevWp = prevWps.find(w => w.name === myWp.name);
                        if (!prevWp) continue;
                        const diff = myWp.timeSec - prevWp.timeSec;
                        // diff < 0: 현재편이 DEP편보다 먼저 통과 → 역방향 충돌도 처리
                        if (Math.abs(diff) < zone.separationMin * 60) {
                            tentative += (zone.separationMin * 60 - diff);
                            adjusted = true;
                            break; // tentative가 바뀌었으므로 myWps 재계산
                        }
                    }
                }
                if (iter === MAX_ITER) {
                    console.warn(`[ctotEngine] CTOT 수렴 실패: flight ${flight.id}, tentative=${tentative}`);
                }
            }
        }

        // 수동 CTOT 잠금: adjustCtot으로 설정된 값을 하한으로 유지
        if (flight.ctotFloor) {
            tentative = Math.max(tentative, toAbsSec(timeToSec(flight.ctotFloor)));
        }

        flight.ctot = secToTime(tentative);
        flight.routeWaypoints = calcWaypoints(flight, tentative);
    });

    return updated;
}

/**
 * 특정 항공편 변경 후 전체 재계산 — 다운스트림 충돌 누락 방지
 * fromFlightId는 호환성 유지용으로 받지만, 항상 전체 재계산을 수행한다.
 */
export function recalcFrom(flights, fromFlightId) {
    if (!flights?.length) return flights;
    const result = recalcAll(flights);
    // 원본 배열 순서 유지
    const map = new Map(result.map(f => [f.id, f]));
    return flights.map(f => map.get(f.id) || f);
}
