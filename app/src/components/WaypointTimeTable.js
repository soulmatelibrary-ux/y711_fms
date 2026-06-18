/**
 * WaypointTimeTable - 합류점 통과 시간표
 * 각 항공편의 MEKIL/MANGI/DALSU 등 합류점 통과 예정시간 표시
 */

import { secToTime, escapeHtml, toAbsSec } from '../utils/timeUtils.js';
import { getConflictZones } from '../utils/settingsLoader.js';

export class WaypointTimeTable {
    constructor(container, { onFlightSelect } = {}) {
        this.container = container;
        this.onFlightSelect = onFlightSelect || (() => {});
        this.flights = [];
        this.zones = [];
        this._render();
    }

    setFlights(flights) {
        this.flights = flights || [];
        this.zones = getConflictZones() || [];
        this._render();
    }

    _render() {
        const zoneNames = this.zones.map(z => z.waypoint);

        // DEP 상태가 아닌 항공편만 필터링 + EOBT 순 정렬
        const activeFlights = this.flights
            .filter(f => f.status !== 'DEP' && f.routeWaypoints?.length)
            .sort((a, b) => {
                const aFirst = toAbsSec(a.routeWaypoints?.[0]?.timeSec || 0);
                const bFirst = toAbsSec(b.routeWaypoints?.[0]?.timeSec || 0);
                return aFirst - bFirst;
            })
            .slice(0, 20); // 최대 20편

        if (!activeFlights.length) {
            this.container.innerHTML = `
                <div class="wtt-empty">통과 예정 항공편 없음</div>`;
            return;
        }

        // 테이블 헤더
        const headerCells = zoneNames.map(z => `<th class="wtt-zone-header">${escapeHtml(z)}</th>`).join('');

        // 테이블 바디
        const rows = activeFlights.map(f => {
            const wps = f.routeWaypoints || [];
            const cells = zoneNames.map(zoneName => {
                const wp = wps.find(w => w.name === zoneName);
                if (wp && wp.timeSec) {
                    const timeStr = secToTime(wp.timeSec);
                    return `<td class="wtt-time">${timeStr}</td>`;
                }
                return `<td class="wtt-time wtt-na">-</td>`;
            }).join('');

            const eobtStr = f.eobt ? f.eobt : '-';
            const ctotStr = f.ctot ? f.ctot : '-';

            return `
                <tr class="wtt-row" data-flight-id="${f.id}">
                    <td class="wtt-callsign">${escapeHtml(f.callsign || '')}</td>
                    <td class="wtt-dept">${escapeHtml(f.dept || '')}</td>
                    <td class="wtt-eobt">${eobtStr}</td>
                    <td class="wtt-ctot">${ctotStr}</td>
                    ${cells}
                </tr>`;
        }).join('');

        this.container.innerHTML = `
            <table class="wtt-table">
                <thead>
                    <tr>
                        <th class="wtt-header-callsign">편명</th>
                        <th class="wtt-header-dept">출발</th>
                        <th class="wtt-header-eobt">EOBT</th>
                        <th class="wtt-header-ctot">CTOT</th>
                        ${headerCells}
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>`;

        // 클릭 이벤트
        this.container.querySelectorAll('.wtt-row').forEach(row => {
            row.addEventListener('click', () => {
                const flightId = row.dataset.flightId;
                this.onFlightSelect(flightId);
            });
        });
    }
}
