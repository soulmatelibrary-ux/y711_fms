/**
 * DB 설정을 API에서 로드하여 캐시
 */
import { apiGet } from './api.js';

let cached = null;

// API 로드 실패 시 사용할 기본값 (실제 운영 값과 일치)
const DEFAULT_AIRPORTS = {
    RKSS: { depInterval: 4,  mergePoint: 'BULTI', nameKo: '김포', icao: 'RKSS', gateToRunwayMin: 10, runwayTakeoffMin: 2 },
    RKTU: { depInterval: 10, mergePoint: 'MEKIL', nameKo: '청주', icao: 'RKTU', gateToRunwayMin: 10, runwayTakeoffMin: 2 },
    RKJK: { depInterval: 10, mergePoint: 'MANGI', nameKo: '군산', icao: 'RKJK', gateToRunwayMin: 10, runwayTakeoffMin: 2 },
    RKJJ: { depInterval: 10, mergePoint: 'DALSU', nameKo: '광주', icao: 'RKJJ', gateToRunwayMin: 10, runwayTakeoffMin: 2 },
};

const DEFAULT_SEGMENTS = {
    'RKSS_BULTI': 8,
    'RKTU_MEKIL': 7,
    'RKJK_MANGI': 3,
    'RKJJ_DALSU': 1,
};

export async function loadSettings() {
    const [airports, zones] = await Promise.all([
        apiGet('/api/v2/settings/airports'),
        apiGet('/api/v2/settings/conflict-zones')
    ]);

    cached = {
        airports: {},      // { RKSS: { depInterval, mergePoint, nameKo } }
        segments: {},      // (사용 안 함 - EXFIXTIME 기반)
        waypointChain: [], // (사용 안 함 - EXFIXTIME 기반)
        conflictZones: []  // [{ waypoint, name, separationMin }]
    };

    (airports.data || []).forEach(r => {
        cached.airports[r.icao] = {
            depInterval: r.dep_interval,
            mergePoint: r.merge_point,
            nameKo: r.name_ko,
            icao: r.icao,
            gateToRunwayMin: r.gate_to_runway_min ?? 10,
            runwayTakeoffMin: r.runway_takeoff_min ?? 2
        };
    });

    cached.conflictZones = (zones.data || []).map(r => ({
        waypoint: r.waypoint,
        name: r.name,
        separationMin: r.separation_min
    }));

    return cached;
}

export function getSettings() {
    return cached;
}

export function getAirportConfig(icao) {
    return cached?.airports[icao] || DEFAULT_AIRPORTS[icao] || { depInterval: 10, mergePoint: icao, nameKo: icao, icao };
}

export function getSegmentTime(fromIcao, toWaypoint) {
    const key = `${fromIcao}_${toWaypoint}`;
    return cached?.segments[key] ?? DEFAULT_SEGMENTS[key] ?? 8;
}

export function getWaypointChain() {
    return cached?.waypointChain || [];
}

export function getConflictZones() {
    return cached?.conflictZones || [];
}

export async function refreshSettings() {
    cached = null;
    return loadSettings();
}
