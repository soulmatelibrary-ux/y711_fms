/**
 * 시뮬레이션 서비스
 * 시뮬레이션 상태, 위치 계산, 애니메이션
 */

import { timeToSec, secToTime } from './ctot.js';

// 시뮬레이션 상태
let simTimeSeconds = 0;
let simRunning = false;
let simSpeed = 1;
let simStartTime = null;
let animationFrameId = null;

// 공항 X 좌표 맵 (SVG 좌표계)
const airportXCoordinates = {
    'RKSS': 120,  // 김포
    'RKTU': 250,  // 청주
    'RKJK': 420,  // 군산
    'RKJJ': 550   // 광주
};

// 웨이포인트 X 좌표 맵 (SVG 좌표계)
const waypointsXCoordinates = {
    'BULTI': 150,
    'MEKIL': 300,
    'GONAX': 450,
    'BEDES': 600,
    'ELPOS': 750,
    'MANGI': 900,
    'DALSU': 1050,
    'NULDI': 1200,
    'DOTOL': 1350,
    'RKPC': 1500
};

/**
 * 시뮬레이션 초기화
 */
export function initSimulation() {
    simTimeSeconds = 0;
    simRunning = false;
    simSpeed = 1;
    simStartTime = null;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

/**
 * 시뮬레이션 재생 시작
 */
export function startSimulation() {
    simRunning = true;
    simStartTime = Date.now();
    console.log('🎬 Simulation started');
    animateSimulation();
}

/**
 * 시뮬레이션 중지
 */
export function stopSimulation() {
    simRunning = false;
    simTimeSeconds = 0;
    simStartTime = null;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    console.log('⏹ Simulation stopped');
}

/**
 * 시뮬레이션 일시 정지
 */
export function pauseSimulation() {
    simRunning = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

/**
 * 시뮬레이션 계속 재생
 */
export function resumeSimulation() {
    if (!simRunning) {
        simRunning = true;
        simStartTime = Date.now() - (simTimeSeconds * 1000 / simSpeed);
        animateSimulation();
    }
}

/**
 * 시뮬레이션 재생 속도 설정
 */
export function setSimulationSpeed(speed) {
    const prevSpeed = simSpeed;
    simSpeed = speed;

    // 속도 변경 시 타이밍 재조정
    if (simRunning && simStartTime) {
        const elapsed = Date.now() - simStartTime;
        simTimeSeconds = (elapsed * prevSpeed / 1000);
        simStartTime = Date.now() - (simTimeSeconds * 1000 / speed);
    }
}

/**
 * 시뮬레이션 시간 이전으로 5분 이동
 */
export function previousSimulation() {
    simTimeSeconds = Math.max(0, simTimeSeconds - 300);
    if (simRunning && simStartTime) {
        simStartTime = Date.now() - (simTimeSeconds * 1000 / simSpeed);
    }
}

/**
 * 시뮬레이션 시간 다음으로 5분 이동
 */
export function nextSimulation() {
    simTimeSeconds += 300;
    if (simRunning && simStartTime) {
        simStartTime = Date.now() - (simTimeSeconds * 1000 / simSpeed);
    }
}

/**
 * 시뮬레이션 시간 직접 설정 (초 단위)
 */
export function setSimulationTime(seconds) {
    simTimeSeconds = Math.max(0, seconds);
    if (simRunning && simStartTime) {
        simStartTime = Date.now() - (simTimeSeconds * 1000 / simSpeed);
    }
}

/**
 * 현재 시뮬레이션 시간 조회 (초)
 */
export function getSimulationTime() {
    if (simRunning && simStartTime) {
        const elapsed = Date.now() - simStartTime;
        simTimeSeconds = (elapsed * simSpeed / 1000);
    }
    return simTimeSeconds;
}

/**
 * 시뮬레이션 시간을 시간:분 형식으로 조회
 */
export function getSimulationTimeString() {
    return secToTime(Math.floor(getSimulationTime()));
}

/**
 * 시뮬레이션 재생 상태 조회
 */
export function isSimulationRunning() {
    return simRunning;
}

/**
 * 시뮬레이션 속도 조회
 */
export function getSimulationSpeed() {
    return simSpeed;
}

/**
 * 항공기의 현재 위치 계산
 */
export function calculateAircraftPosition(flight, routeWaypoints = [], isFullscreen = true) {
    const ctotSec = timeToSec(flight.ctot);
    const groundY = isFullscreen ? 800 : 330;
    const cruiseY = isFullscreen ? 200 : 270;

    const currentTimeSec = getSimulationTime();
    const startX = airportXCoordinates[flight.dept] || 100;

    // 항공기가 아직 출발하지 않음
    if (currentTimeSec < ctotSec) {
        return {
            x: startX,
            y: groundY,
            altitude: 0,
            phase: 'ground'
        };
    }

    // 웨이포인트가 없으면 기본 계산
    if (!routeWaypoints || routeWaypoints.length === 0) {
        return {
            x: startX,
            y: groundY,
            altitude: 0,
            phase: 'ground'
        };
    }

    const airborneSecond = currentTimeSec - ctotSec;
    const altitudeFL = parseInt(flight.cfl?.replace(/[^0-9]/g, '') || '250');
    const altitude = (altitudeFL * 100);

    // 고도 계산 (선형)
    let climbProgress = Math.min(airborneSecond / 600, 1); // 10분 동안 상승
    const currentAltitude = altitude * climbProgress;

    // 첫 번째 웨이포인트로 진입하는 구간
    if (routeWaypoints.length > 0) {
        const firstWp = routeWaypoints[0];
        if (currentTimeSec < firstWp.time) {
            const progress = (currentTimeSec - ctotSec) / (firstWp.time - ctotSec);
            const targetX = waypointsXCoordinates[firstWp.name] || startX;
            return {
                x: startX + (targetX - startX) * progress,
                y: groundY - (groundY - cruiseY) * progress,
                altitude: currentAltitude,
                phase: 'climb'
            };
        }
    }

    // 웨이포인트 사이에서 비행
    let prevX = airportXCoordinates[flight.dept] || 100;
    let prevTime = ctotSec;
    let nextX = prevX;
    let nextTime = ctotSec + 3600; // 기본 1시간

    for (let i = 0; i < routeWaypoints.length; i++) {
        const wp = routeWaypoints[i];
        if (currentTimeSec < wp.time) {
            nextX = waypointsXCoordinates[wp.name] || prevX;
            nextTime = wp.time;
            break;
        }
        prevX = waypointsXCoordinates[wp.name] || prevX;
        prevTime = wp.time;
    }

    const progress = (nextTime > prevTime) ? (currentTimeSec - prevTime) / (nextTime - prevTime) : 0;
    const x = prevX + (nextX - prevX) * Math.max(0, Math.min(progress, 1));

    return {
        x: x,
        y: cruiseY,
        altitude: altitude,
        phase: 'cruise'
    };
}

/**
 * 공항 X 좌표 조회
 */
export function getAirportXCoordinate(airportCode) {
    return airportXCoordinates[airportCode] || 100;
}

/**
 * 웨이포인트 X 좌표 조회
 */
export function getWaypointXCoordinate(waypointName) {
    return waypointsXCoordinates[waypointName] || 100;
}

/**
 * 모든 공항 X 좌표 조회
 */
export function getAirportXCoordinates() {
    return { ...airportXCoordinates };
}

/**
 * 모든 웨이포인트 X 좌표 조회
 */
export function getWaypointXCoordinates() {
    return { ...waypointsXCoordinates };
}

/**
 * 공항 X 좌표 업데이트
 */
export function updateAirportXCoordinates(newCoordinates) {
    Object.assign(airportXCoordinates, newCoordinates);
}

/**
 * 웨이포인트 X 좌표 업데이트
 */
export function updateWaypointXCoordinates(newCoordinates) {
    Object.assign(waypointsXCoordinates, newCoordinates);
}

/**
 * 시뮬레이션 애니메이션 루프
 */
function animateSimulation() {
    if (!simRunning) return;

    // 시간 업데이트
    getSimulationTime();

    // 클라이언트에서 업데이트 콜백 호출 (UI 업데이트용)
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('simulation-update', {
            detail: {
                time: simTimeSeconds,
                speed: simSpeed,
                running: simRunning
            }
        }));
    }

    animationFrameId = requestAnimationFrame(animateSimulation);
}

/**
 * 고도를 Y 좌표로 변환
 */
export function altitudeToY(altitudeFL, maxY = 200) {
    // FL250 = Y 200 (cruise altitude)
    // FL350 = Y 50
    const baseAltitude = 250;
    const maxAltitude = 350;
    const yPercent = (altitudeFL - baseAltitude) / (maxAltitude - baseAltitude);
    return maxY - (yPercent * maxY * 0.5);
}

/**
 * 공항 코드로 X 좌표 조회 (SVG 맵에서의 위치)
 */
export function getAirportX(airportCode) {
    const coordinates = getAirportXCoordinates();
    return coordinates[airportCode] || 100;
}

/**
 * SVG 요소 생성
 */
export function createSvgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) {
        el.setAttribute(k, attrs[k]);
    }
    return el;
}

/**
 * 첫 번째 웨이포인트에서 특정 웨이포인트까지의 시간 계산 (분 단위, 초로 반환)
 */
export function getTimeToWaypoint(fromWaypoint, toWaypoint) {
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

    let totalTime = 0;
    let currentWaypoint = fromWaypoint;
    let safety = 0;

    while (currentWaypoint !== toWaypoint && safety < 20) {
        const leg = waypoints.find(wp => wp.from === currentWaypoint);
        if (!leg) break;
        totalTime += leg.duration * 60; // 분을 초로 변환
        currentWaypoint = leg.to;
        safety++;
    }

    return totalTime;
}
