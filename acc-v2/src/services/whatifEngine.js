/**
 * What-if 모드 스냅샷 관리
 */
import { recalcAll } from './ctotEngine.js';
import { detectConflicts } from './conflictDetector.js';
import { timeToSec, secToTime } from '../utils/timeUtils.js';
import { debounce } from '../utils/debounce.js';

export class WhatifEngine {
    constructor(baseFlights) {
        this.active = false;
        this.baseFlights = baseFlights.map(f => ({ ...f }));
        this.whatifFlights = baseFlights.map(f => ({ ...f }));
    }

    enable(currentFlights) {
        this.active = true;
        this.baseFlights = currentFlights.map(f => ({ ...f }));
        this.whatifFlights = currentFlights.map(f => ({ ...f }));
        return this.whatifFlights;
    }

    disable() {
        this.active = false;
        return this.baseFlights;
    }

    apply() {
        this.active = false;
        return this.whatifFlights;
    }

    // What-if 상태에서 CTOT 조정 — 즉시 재계산 후 최신 상태 반환, 이벤트만 debounce
    adjustCtot(flightId, deltaMins) {
        const f = this.whatifFlights.find(fl => fl.id === flightId);
        if (!f) return this.whatifFlights;
        const newSec = timeToSec(f.ctot) + deltaMins * 60;
        f.ctot = secToTime(newSec);
        this.whatifFlights = recalcAll(this.whatifFlights);
        this._scheduleNotify();
        return this.whatifFlights;
    }

    // 공항 전체 일괄 지연
    delayAirport(icao, deltaMins) {
        this.whatifFlights.forEach(f => {
            if (f.dept === icao && f.status !== 'DEP') {
                const newSec = timeToSec(f.ctot || f.eobt) + deltaMins * 60;
                f.ctot = secToTime(newSec);
            }
        });
        this.whatifFlights = recalcAll(this.whatifFlights);
        return this.whatifFlights;
    }

    // 이벤트 발행만 debounce (재계산은 adjustCtot에서 즉시 수행)
    _scheduleNotify = debounce(() => {
        document.dispatchEvent(new CustomEvent('whatif:recalculated'));
    }, 150);

    getConflicts() {
        return detectConflicts(this.whatifFlights);
    }

    // diff: whatif vs base
    getDiff() {
        return this.whatifFlights
            .map(wf => {
                const bf = this.baseFlights.find(f => f.id === wf.id);
                if (!bf || bf.ctot === wf.ctot) return null;
                return {
                    id: wf.id,
                    callsign: wf.callsign,
                    baseCtot: bf.ctot,
                    whatifCtot: wf.ctot,
                    deltaMins: Math.round((timeToSec(wf.ctot) - timeToSec(bf.ctot)) / 60)
                };
            })
            .filter(Boolean);
    }
}
