/**
 * CTOT 계산 엔진 — DB 설정 기반 (settingsLoader에서 로드한 설정 사용)
 */
import { timeToSec, secToTime, toAbsSec } from '../utils/timeUtils.js';
import { getAirportConfig, getSegmentTime, getWaypointChain, getConflictZones } from '../utils/settingsLoader.js';

/**
 * 항공편의 각 웨이포인트 통과 시간 계산
 * - EXFIXTIME 기반 routeWaypoints가 있으면 CTOT 차이만큼 보정하여 사용
 * - 없으면 기존 DB 설정 기반 계산
 * @returns [{name, timeSec}]
 */
export function calcWaypoints(flight, ctotSec) {
    // ─────────────────────────────────────────────────────────
    // EXFIXTIME 기반 routeWaypoints 우선 사용
    // ATD가 있으면 ATD 기준, 없으면 CTOT와 EOBT 차이만큼 보정
    // ─────────────────────────────────────────────────────────
    if (flight.routeWaypoints && flight.routeWaypoints.length > 0) {
        const origRoute = flight.routeWaypoints;
        const eobtSec = toAbsSec(timeToSec(flight.eobtUtc || flight.eobt));

        // CTOT = gate departure 기준(EOBT와 동일 레퍼런스), ATD = 실제 이륙 시각
        // EXFIXTIME은 EOBT 기준 절대 UTC → delta는 각 기준의 차이로 계산
        let deltaSec = 0;
        if (flight.atd) {
            const atdSec = toAbsSec(timeToSec(flight.atdUtc || flight.atd));
            // ATD(이륙) → EOBT(게이트)로 환산 후 delta 계산: 지상시간을 중복 반영 방지
            const apt = getAirportConfig(flight.dept);
            const groundSec = ((apt.gateToRunwayMin || 10) + (apt.runwayTakeoffMin || 2)) * 60;
            deltaSec = atdSec - eobtSec - groundSec;
        } else {
            // CTOT = gate departure = EOBT + 지연 → 동일 레퍼런스 차이
            // ctotSec은 recalcAll에서 이미 toAbsSec 적용된 값으로 전달됨
            deltaSec = ctotSec - eobtSec;
        }

        // 원본 EXFIXTIME에 delta를 더해서 시뮬레이션
        return origRoute.map(wp => ({
            name: wp.name,
            time: wp.time,
            timeSec: toAbsSec(wp.timeSec || 0) + deltaSec
        }));
    }

    // ─────────────────────────────────────────────────────────
    // 기존 방식: DB 설정 기반 계산 (EXFIXTIME 없는 경우)
    // ─────────────────────────────────────────────────────────
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
        const apt = getAirportConfig(flight.dept);
        const depInterval = apt.depInterval;
        const gateToRunwayMin = apt.gateToRunwayMin || 10;
        const runwayTakeoffMin = apt.runwayTakeoffMin || 2;
        // 지상 준비시간 (게이트→활주로 + 활주로 이륙) — 시뮬레이션/ALT맵 이륙 기준시각 계산에 사용
        flight.groundTimeSec = (gateToRunwayMin + runwayTakeoffMin) * 60;

        // DEP 확정편: CTOT는 계획된 출발시각 유지 (ATD로 덮어쓰지 않음 — cascade는 계획 기준)
        // routeWaypoints는 ATD 기준으로 계산 (calcWaypoints 내부에서 atd 우선 적용)
        if (flight.status === 'DEP' && flight.atd) {
            flight.routeWaypoints = calcWaypoints(flight, toAbsSec(timeToSec(flight.atd)));
            return;
        }
        let tentative = toAbsSec(timeToSec(flight.eobt));

        // DEP 확정편의 기준 시각: ATD(실제 출발) 우선, 없으면 CTOT/EOBT
        const getRefSec = f =>
            (f.status === 'DEP' && f.atd)
                ? toAbsSec(timeToSec(f.atdUtc || f.atd))
                : toAbsSec(timeToSec(f.ctot || f.eobt));

        // Priority 1: 동일 공항 출발 간격
        // 이전 항공편 활주로 출발 시각 + depInterval <= 현재 항공편 활주로 진입 시각
        // prevCTOT + prevGateToRunwayMin + prevRunwayTakeoffMin + depInterval 
        //   <= tentative + gateToRunwayMin
        const sameApt = byAirport[flight.dept] || [];
        const myIdx = sameApt.findIndex(f => f.id === flight.id);
        if (myIdx > 0) {
            const prev = sameApt[myIdx - 1];
            const prevCtotSec = getRefSec(prev);
            const prevApt = getAirportConfig(prev.dept);
            const prevGateToRunway = prevApt.gateToRunwayMin || 10;
            const prevRunwayTakeoff = prevApt.runwayTakeoffMin || 2;
            
            // 필요한 CTOT 최소값 계산 (gate departure 기준)
            // prev_이륙 = prevCTOT + prevGate + prevTakeoff
            // curr_이륙 >= prev_이륙 + depInterval
            // currCTOT + curGate + curTakeoff >= prev_이륙 + depInterval
            const minCtot = prevCtotSec + prevGateToRunway * 60 + prevRunwayTakeoff * 60 + depInterval * 60 - gateToRunwayMin * 60 - runwayTakeoffMin * 60;
            tentative = Math.max(tentative, minCtot);
        }

        // Priority 2: 합류점 분리 확인 (이전 항공편과 비교)
        // tentative 변경 시 myWps를 재계산해야 정확한 지연값을 산출할 수 있다.
        const zones = getConflictZones();
        const maxReqSepSec = zones.reduce((m, z) => Math.max(m, z.separationMin * 60), 0);
        if (idx > 0) {
            for (let i = 0; i < idx; i++) {
                const prev = updated[i];
                const prevCtotSec = getRefSec(prev);

                // 같은 공항 출발이면 경로가 동일하므로 CTOT 차이로 웨이포인트 계산 생략 가능
                // 다른 공항 출발편은 경로 길이가 달라 반드시 웨이포인트 검사 필요
                if (prev.dept === flight.dept && tentative - prevCtotSec >= maxReqSepSec) continue;

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
                        const reqSec = zone.separationMin * 60;
                        // EOBT 순서 강제: 현재편은 이전편보다 reqSec 이상 늦게 통과해야 함
                        // diff < 0: 역방향 (현재편이 먼저 도착) → 지연 필요
                        // diff >= 0 && diff < reqSec: 순방향이지만 분리 부족 → 지연 필요
                        if (diff < reqSec) {
                            tentative += (reqSec - diff);
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
