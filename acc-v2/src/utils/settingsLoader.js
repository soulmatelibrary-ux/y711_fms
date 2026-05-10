/**
 * DB 설정을 API에서 로드하여 캐시
 */
import { apiGet } from './api.js';

let cached = null;

export async function loadSettings() {
    const [airports, segments, waypoints, zones] = await Promise.all([
        apiGet('/api/v2/settings/airports'),
        apiGet('/api/v2/settings/segments'),
        apiGet('/api/v2/settings/waypoints'),
        apiGet('/api/v2/settings/conflict-zones')
    ]);

    cached = {
        airports: {},      // { RKSS: { depInterval, mergePoint, nameKo } }
        segments: {},      // { 'RKSS_BULTI': 8 }
        waypointChain: [], // [{ fromWp, toWp, durationMin }]
        conflictZones: []  // [{ waypoint, name, separationMin }]
    };

    (airports.data || []).forEach(r => {
        cached.airports[r.icao] = {
            depInterval: r.dep_interval,
            mergePoint: r.merge_point,
            nameKo: r.name_ko,
            icao: r.icao
        };
    });

    (segments.data || []).forEach(r => {
        cached.segments[`${r.from_icao}_${r.to_waypoint}`] = r.duration_min;
    });

    cached.waypointChain = (waypoints.data || []).map(r => ({
        fromWp: r.from_wp,
        toWp: r.to_wp,
        durationMin: r.duration_min
    }));

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
    return cached?.airports[icao] || { depInterval: 10, mergePoint: icao, nameKo: icao };
}

export function getSegmentTime(fromIcao, toWaypoint) {
    return cached?.segments[`${fromIcao}_${toWaypoint}`] ?? 8;
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
