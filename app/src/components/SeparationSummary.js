/**
 * SeparationSummary - 분리간격 요약
 * 가장 촉박한 분리 TOP N 표시
 */

import { escapeHtml, toAbsSec } from '../utils/timeUtils.js';
import { getConflictZones } from '../utils/settingsLoader.js';

function formatClockHHMMSS(totalSec) {
    const s = ((totalSec % 86400) + 86400) % 86400;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export class SeparationSummary {
    constructor(container, { onFlightSelect, onPairSelect, maxItems = 8 } = {}) {
        this.container = container;
        this.onFlightSelect = onFlightSelect || (() => {});
        this.onPairSelect = onPairSelect || (() => {}); // 두 항공편 쌍 선택 콜백
        this.maxItems = maxItems;
        this.flights = [];
        this.zones = [];
        this._render();
    }

    setFlights(flights) {
        this.flights = flights || [];
        this.zones = getConflictZones() || [];
        this._render();
    }

    _computeSeparations() {
        const separations = [];

        for (const zone of this.zones) {
            // 해당 합류점을 통과하는 항공편 수집
            const passings = [];
            for (const f of this.flights) {
                if (f.status === 'DEP') continue;
                const wps = f.routeWaypoints || [];
                const wp = wps.find(w => w.name === zone.waypoint);
                if (wp && wp.timeSec) {
                    passings.push({ flight: f, timeSec: toAbsSec(wp.timeSec) });
                }
            }

            // 시간순 정렬
            passings.sort((a, b) => a.timeSec - b.timeSec);

            // 연속 쌍의 분리간격 계산
            for (let i = 1; i < passings.length; i++) {
                const prev = passings[i - 1];
                const curr = passings[i];
                const diffSec = curr.timeSec - prev.timeSec;
                const reqSec = zone.separationMin * 60;

                separations.push({
                    zone: zone.waypoint,
                    f1: prev.flight,
                    f2: curr.flight,
                    f1TimeSec: prev.timeSec,
                    f2TimeSec: curr.timeSec,
                    diffSec,
                    reqSec,
                    margin: diffSec - reqSec // 음수면 미충족
                });
            }
        }

        // 분리간격 촉박한 순 정렬 (margin이 작을수록 촉박)
        separations.sort((a, b) => a.margin - b.margin);

        return separations.slice(0, this.maxItems);
    }

    _render() {
        const separations = this._computeSeparations();

        if (!separations.length) {
            this.container.innerHTML = `
                <div class="sep-empty">분리 데이터 없음</div>`;
            return;
        }

        const items = separations.map(s => {
            const diffMin = Math.floor(s.diffSec / 60);
            const diffSec = s.diffSec % 60;
            const reqMin = s.reqSec / 60;
            const f1MergeTime = formatClockHHMMSS(s.f1TimeSec);
            const f2MergeTime = formatClockHHMMSS(s.f2TimeSec);
            const absMargin = Math.abs(s.margin);
            const marginMin = Math.floor(absMargin / 60);
            const marginSec = absMargin % 60;
            const marginText = s.margin < 0
                ? `부족 ${marginMin}분 ${String(marginSec).padStart(2, '0')}초`
                : `여유 ${marginMin}분 ${String(marginSec).padStart(2, '0')}초`;

            // 상태 결정
            let statusClass = 'sep-ok';
            let statusIcon = '●';
            if (s.margin < 0) {
                statusClass = 'sep-critical';
                statusIcon = '●';
            } else if (s.margin < 60) {
                statusClass = 'sep-warning';
                statusIcon = '●';
            }

            return `
                <div class="sep-item ${statusClass}" data-f1="${s.f1.id}" data-f2="${s.f2.id}">
                    <span class="sep-icon">${statusIcon}</span>
                    <span class="sep-pair">${escapeHtml(s.f1.callsign)} (${f1MergeTime}) → ${escapeHtml(s.f2.callsign)} (${f2MergeTime})</span>
                    <span class="sep-zone">@ ${escapeHtml(s.zone)}</span>
                    <span class="sep-value">${diffMin}분 ${String(diffSec).padStart(2, '0')}초</span>
                    <span class="sep-req">/ ${reqMin}분</span>
                    <span class="sep-gap">(${marginText})</span>
                </div>`;
        }).join('');

        this.container.innerHTML = items;

        // 클릭 이벤트 - 두 항공편 쌍을 미니맵에 하이라이트
        this.container.querySelectorAll('.sep-item').forEach(item => {
            item.addEventListener('click', () => {
                const f1Id = item.dataset.f1;
                const f2Id = item.dataset.f2;
                this.onPairSelect(f1Id, f2Id);
            });
        });
    }
}
