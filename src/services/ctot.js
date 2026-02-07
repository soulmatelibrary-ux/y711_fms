/**
 * CTOT 계산 서비스
 * CTOT 계산, 웨이포인트 도착 시간, 충돌 감지
 */

// 웨이포인트 정의
const waypoints = [
    { from: 'BULTI', to: 'MEKIL', duration: 2 },
    { from: 'MEKIL', to: 'GONAX', duration: 2 },
    { from: 'GONAX', to: 'BEDES', duration: 2 },
    { from: 'BEDES', to: 'ELPOS', duration: 3 },
    { from: 'ELPOS', to: 'MANGI', duration: 4 },
    { from: 'MANGI', to: 'DALSU', duration: 2 },
    { from: 'DALSU', to: 'NULDI', duration: 2 },
    { from: 'NULDI', to: 'DOTOL', duration: 3 },
    { from: 'DOTOL', to: 'RKPC', duration: 5 }
];

// 공항별 설정
const airportDatabase = {
    'RKSS': { name: '김포', mergePoint: 'BULTI', depInterval: 4 },
    'RKTU': { name: '청주', mergePoint: 'MEKIL', depInterval: 10 },
    'RKJK': { name: '군산', mergePoint: 'MANGI', depInterval: 10 },
    'RKJJ': { name: '광주', mergePoint: 'DALSU', depInterval: 10 }
};

// 진입 시간 설정
const segmentConfig = {
    'RKSS_BULTI': 8,
    'RKTU_MEKIL': 7,
    'RKJK_MANGI': 3,
    'RKJJ_DALSU': 1
};

// 충돌 감지 영역
const conflictZones = [
    { name: 'MEKIL Convergence', waypoint: 'MEKIL', separationMinutes: 3 },
    { name: 'MANGI Convergence', waypoint: 'MANGI', separationMinutes: 3 },
    { name: 'DALSU Convergence', waypoint: 'DALSU', separationMinutes: 3 }
];

/**
 * 시간 문자열(HHmm)을 초로 변환
 */
export function timeToSec(timeStr) {
    if (!timeStr) return 0;
    const clean = timeStr.toString().replace(/[^\d]/g, '');
    if (clean.length < 4) return 0;
    const hours = parseInt(clean.substring(0, clean.length - 2), 10);
    const minutes = parseInt(clean.substring(clean.length - 2), 10);
    if (isNaN(hours) || isNaN(minutes) || hours > 23 || minutes > 59) return 0;
    return hours * 3600 + minutes * 60;
}

/**
 * 초를 시간 문자열(HHmm)로 변환
 */
export function secToTime(totalSec) {
    totalSec = totalSec % 86400;
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    return String(hours).padStart(2, '0') + String(minutes).padStart(2, '0');
}

/**
 * 항공편의 웨이포인트 도착 시간 계산
 */
export function calculateFlightWaypoints(flight, startTimeSec) {
    const route = [];
    const apt = airportDatabase[flight.dept];
    const firstMerge = apt?.mergePoint || 'BULTI';
    const entryKey = `${flight.dept}_${firstMerge}`;
    const entryDur = segmentConfig[entryKey] || 8;

    // startTimeSec = CTOT (이륙 시간)
    let currentSec = startTimeSec + (entryDur * 60);
    route.push({ name: firstMerge, time: currentSec });

    // 웨이포인트 체인 따라가기
    let currentName = firstMerge;
    let safety = 0;
    while (safety < 20) {
        const leg = waypoints.find(wp => wp.from === currentName);
        if (!leg) break;
        currentSec += (leg.duration * 60);
        route.push({ name: leg.to, time: currentSec });
        currentName = leg.to;
        safety++;
    }

    return route;
}

/**
 * 모든 항공편의 CTOT 계산 및 업데이트
 */
export function updateCTOTs(flights, separationMinutes = 3) {
    if (!Array.isArray(flights) || flights.length === 0) {
        return flights;
    }

    const separationSec = separationMinutes * 60;
    const updated = JSON.parse(JSON.stringify(flights)); // 깊은 복사

    // EOBT 기준으로 정렬
    updated.sort((a, b) => timeToSec(a.eobt) - timeToSec(b.eobt));

    // 공항별 그룹화
    const airportGroups = {};
    updated.forEach(flight => {
        if (!airportGroups[flight.dept]) {
            airportGroups[flight.dept] = [];
        }
        airportGroups[flight.dept].push(flight);
    });

    // 각 항공편의 CTOT 계산
    updated.forEach((flight, index) => {
        let tentativeCtot = timeToSec(flight.eobt);

        // Priority 1: 같은 공항 이륙 간격
        const apt = airportDatabase[flight.dept];
        const depInterval = apt?.depInterval || 4;
        const sameAirportFlights = airportGroups[flight.dept] || [];
        const flightIndexInAirport = sameAirportFlights.findIndex(f => f.id === flight.id);

        if (flightIndexInAirport > 0) {
            const prevFlight = sameAirportFlights[flightIndexInAirport - 1];
            const prevCtot = timeToSec(prevFlight.ctot || prevFlight.eobt);
            const minCtot = prevCtot + (depInterval * 60);
            tentativeCtot = Math.max(tentativeCtot, minCtot);
        }

        // Priority 2: 웨이포인트 분리 확인
        if (index > 0) {
            const prevFlight = updated[index - 1];
            const prevRouteWaypoints = calculateFlightWaypoints(prevFlight, timeToSec(prevFlight.ctot || prevFlight.eobt));
            const currentRouteWaypoints = calculateFlightWaypoints(flight, tentativeCtot);

            // 공통 웨이포인트에서 분리 확인
            for (const wpCurrent of currentRouteWaypoints) {
                const wpPrev = prevRouteWaypoints.find(wp => wp.name === wpCurrent.name);
                if (wpPrev) {
                    const timeDiff = wpCurrent.time - wpPrev.time;
                    if (timeDiff < separationSec && timeDiff > 0) {
                        // CTOT 지연 필요
                        const delayNeeded = separationSec - timeDiff;
                        tentativeCtot += delayNeeded;
                    }
                }
            }
        }

        // CTOT 업데이트
        flight.ctot = secToTime(tentativeCtot);
        flight.routeWaypoints = calculateFlightWaypoints(flight, tentativeCtot);
    });

    return updated;
}

/**
 * 충돌 감지
 */
export function detectConflicts(flights) {
    const conflicts = [];

    conflictZones.forEach(zone => {
        const flightsAtWaypoint = [];

        flights.forEach(flight => {
            if (!flight.routeWaypoints) {
                // 웨이포인트 계산 (아직 계산되지 않은 경우)
                flight.routeWaypoints = calculateFlightWaypoints(flight, timeToSec(flight.ctot || flight.eobt));
            }

            const waypoint = flight.routeWaypoints.find(wp => wp.name === zone.waypoint);
            if (waypoint) {
                flightsAtWaypoint.push({
                    flight: flight,
                    time: waypoint.time,
                    callsign: flight.callsign
                });
            }
        });

        // 분리 기준 확인
        for (let i = 0; i < flightsAtWaypoint.length; i++) {
            for (let j = i + 1; j < flightsAtWaypoint.length; j++) {
                const timeDiff = Math.abs(flightsAtWaypoint[i].time - flightsAtWaypoint[j].time);
                const separationSec = zone.separationMinutes * 60;

                if (timeDiff < separationSec && timeDiff > 0) {
                    conflicts.push({
                        zone: zone.name,
                        waypoint: zone.waypoint,
                        flight1: flightsAtWaypoint[i].flight,
                        flight2: flightsAtWaypoint[j].flight,
                        timeDiff: timeDiff,
                        separation: zone.separationMinutes,
                        severity: timeDiff < 30 ? 'critical' : 'warning'
                    });

                    console.warn(`🚨 CONFLICT at ${zone.waypoint}: ${flightsAtWaypoint[i].callsign} and ${flightsAtWaypoint[j].callsign} separated by ${Math.round(timeDiff)}s`);
                }
            }
        }
    });

    return conflicts;
}

/**
 * CTOT 구성 조회
 */
export function getSegmentConfig() {
    return { ...segmentConfig };
}

/**
 * 공항 데이터베이스 조회
 */
export function getAirportDatabase() {
    return { ...airportDatabase };
}

/**
 * 웨이포인트 조회
 */
export function getWaypoints() {
    return [...waypoints];
}

/**
 * 충돌 감지 영역 조회
 */
export function getConflictZones() {
    return [...conflictZones];
}

/**
 * 설정 업데이트 (진입 시간, 이륙 간격 등)
 */
export function updateSegmentConfig(newConfig) {
    Object.assign(segmentConfig, newConfig);
}

export function updateAirportDatabase(newDatabase) {
    Object.assign(airportDatabase, newDatabase);
}

export function updateWaypoints(newWaypoints) {
    waypoints.length = 0;
    waypoints.push(...newWaypoints);
}

export function updateConflictZones(newZones) {
    conflictZones.length = 0;
    conflictZones.push(...newZones);
}
