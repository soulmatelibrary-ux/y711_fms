/**
 * DepartureQueue — NOW+60분 출발 대기열 카드 목록
 */
import { timeToSec, secToTime, nowUtcSec, formatDisplay, escapeHtml } from '../utils/timeUtils.js';
import { setAtd, adjustCtot } from '../services/atdManager.js';
import { getSettings } from '../utils/settingsLoader.js';

export class DepartureQueue {
    constructor(container, {
        onFlightSelect, onFlightDblClick,
        onSetAirportRef, onClearAirportRef, getAirportRefTimes,
        onSetAirportRefByFlight
    } = {}) {
        this.container = container;
        this.flights = [];
        this.conflicts = [];
        this.onFlightSelect = onFlightSelect || (() => {});
        this.onFlightDblClick = onFlightDblClick || (() => {});
        this.onSetAirportRef = onSetAirportRef || (() => {});
        this.onClearAirportRef = onClearAirportRef || (() => {});
        this.getAirportRefTimes = getAirportRefTimes || (() => ({}));
        this.onSetAirportRefByFlight = onSetAirportRefByFlight || (() => {});
        this._searchQuery = '';
        this._filterApt = '';
        this._refBarEl = null;
        this._interval = setInterval(() => this._render(), 10000);
        this._renderSearchBar();
        this._renderRefBar();
    }

    _renderRefBar() {
        const bar = document.createElement('div');
        bar.className = 'apt-ref-bar';
        bar.innerHTML = this._refBarHTML(this.getAirportRefTimes());
        bar.addEventListener('click', (e) => {
            const chip = e.target.closest('.apt-ref-chip');
            if (chip) this.onSetAirportRef(chip.dataset.icao);
        });
        bar.addEventListener('contextmenu', (e) => {
            const chip = e.target.closest('.apt-ref-chip');
            if (!chip) return;
            e.preventDefault();
            this.onClearAirportRef(chip.dataset.icao);
        });
        this._refBarEl = bar;
        this.container.parentElement?.insertBefore(bar, this.container);
    }

    _refBarHTML(refTimes) {
        const APT_COLOR = { RKSS: '#58a6ff', RKTU: '#bc8cff', RKJK: '#39c5bb', RKJJ: '#d29922' };
        return Object.keys(APT_COLOR).map(icao => {
            const rt = (refTimes || {})[icao];
            const label = rt ? `${rt.slice(0, 2)}:${rt.slice(2)}` : '--:--';
            const active = rt ? ' apt-ref-chip--active' : '';
            const tooltip = icao === 'RKSS'
                ? '클릭: Set Now / 우클릭: 초기화'
                : '기준편 카드의 [기준] 버튼으로 설정 / 우클릭: 초기화';
            return `<span class="apt-ref-chip${active}" data-icao="${icao}"
                          style="--apt-color:${APT_COLOR[icao]}"
                          title="${tooltip}">
                <span class="apt-ref-label">${icao}</span>
                <span class="apt-ref-time">${label}</span>
            </span>`;
        }).join('');
    }

    updateRefBar(refTimes) {
        if (this._refBarEl) this._refBarEl.innerHTML = this._refBarHTML(refTimes || {});
    }

    _renderSearchBar() {
        const bar = document.createElement('div');
        bar.className = 'queue-search-bar';
        const aptOptions = Object.values(getSettings()?.airports || {})
            .map(a => `<option value="${escapeHtml(a.icao)}">${escapeHtml(a.nameKo || a.icao)}</option>`)
            .join('');
        bar.innerHTML = `
            <input class="queue-search-input" type="text" placeholder="콜사인 검색...">
            <select class="queue-filter-apt">
                <option value="">전체</option>
                ${aptOptions}
            </select>`;
        bar.querySelector('.queue-search-input').addEventListener('input', (e) => {
            this._searchQuery = e.target.value.trim().toUpperCase();
            this._render();
        });
        bar.querySelector('.queue-filter-apt').addEventListener('change', (e) => {
            this._filterApt = e.target.value;
            this._render();
        });
        this.container.parentElement?.insertBefore(bar, this.container);
    }

    setFlights(flights) { this.flights = flights; this._render(); }
    setConflicts(conflicts) { this.conflicts = conflicts; this._render(); }

    destroy() { clearInterval(this._interval); }

    _render() {
        const now = nowUtcSec();
        const window60 = 60 * 60;
        const queue = this.flights
            .filter(f => {
                const ctotSec = timeToSec(f.ctot || f.eobt);
                if (ctotSec < now - 5 * 60 || ctotSec > now + window60) return false;
                if (this._searchQuery && !f.callsign?.toUpperCase().includes(this._searchQuery)) return false;
                if (this._filterApt && f.dept !== this._filterApt) return false;
                return true;
            })
            .sort((a, b) => {
                // KST 하루 경계: UTC 15:00 미만(00:xx~14:xx)은 +86400 처리
                const toAbs = s => (s > 0 && s < 15 * 3600 ? s + 86400 : s);
                return toAbs(timeToSec(a.eobt)) - toAbs(timeToSec(b.eobt));
            });

        if (!queue.length) {
            this.container.innerHTML = `
                <div class="queue-empty">
                    <div class="empty-title">NOW+60분 내 출발편 없음</div>
                    <div class="empty-hint">10분 후 자동 새로고침됩니다.<br>
                    <button class="btn-empty-refresh">지금 새로고침</button></div>
                </div>`;
            this.container.querySelector('.btn-empty-refresh')?.addEventListener('click', () => this._render());
            return;
        }

        const rowsHtml = queue.map(f => {
            const ctotSec = timeToSec(f.ctot || f.eobt);
            const diffMins = Math.round((ctotSec - now) / 60);
            const hasConflict = this.conflicts.some(c => c.f1.id === f.id || c.f2.id === f.id);
            const isImminent = Math.abs(diffMins) <= 5;
            const isDep = f.status === 'DEP';

            let cardClass = 'queue-card';
            if (isDep) cardClass += ' card-dep';
            else if (hasConflict) cardClass += ' card-conflict';
            else if (isImminent) cardClass += ' card-imminent';

            const timeLabel = diffMins > 0 ? `+${diffMins}m` : `${diffMins}m`;
            const aptColor = { RKSS: '#58a6ff', RKTU: '#bc8cff', RKJK: '#39c5bb', RKJJ: '#d29922' }[f.dept] || '#4fc3f7';

            const rfl = f.cfl ? String(f.cfl).toUpperCase().replace(/^(?!FL)/i, 'FL') : '—';
            return `<div class="${cardClass}" data-id="${f.id}" style="border-left: 4px solid ${aptColor}">
                <div class="qc-line">
                    <span class="qc-cell qc-callsign" style="color:${aptColor}">${escapeHtml(f.callsign)}</span>
                    <span class="qc-cell qc-alt">${rfl}</span>
                    <span class="qc-cell qc-time">${formatDisplay(f.eobt)}</span>
                    <span class="qc-cell qc-time">${formatDisplay(f.ctot || f.eobt)}</span>
                    <span class="qc-cell qc-delta ${diffMins < 0 ? 'past' : ''}">${timeLabel}</span>
                    ${hasConflict ? '<span class="qc-conflict-badge">⚠</span>' : ''}
                    ${isDep
                        ? `<span class="qc-dep-badge qc-inline">출발완료 ✓</span>`
                        : `<span class="qc-actions-inline"><button class="btn-qnow" data-id="${f.id}">NOW</button>
                           <button class="btn-qadj" data-id="${f.id}" data-d="-5">-5m</button>
                           <button class="btn-qadj" data-id="${f.id}" data-d="-1">-1m</button>
                           <button class="btn-qadj" data-id="${f.id}" data-d="1">+1m</button>
                           <button class="btn-qadj" data-id="${f.id}" data-d="5">+5m</button>
                           ${f.dept !== 'RKSS' ? `<button class="btn-qref" data-id="${f.id}">기준</button>` : ''}</span>`
                    }
                </div>
            </div>`;
        }).join('');

        this.container.innerHTML = `
            <div class="queue-col-head">
                <span class="qch-cell qch-callsign">CALLSIGN</span>
                <span class="qch-cell qch-alt">고도</span>
                <span class="qch-cell qch-time">EOBT</span>
                <span class="qch-cell qch-time">CTOT</span>
                <span class="qch-cell qch-delta">Δ</span>
                <span class="qch-cell qch-actions">조작</span>
            </div>
            ${rowsHtml}
        `;

        // 이벤트 바인딩
        this.container.querySelectorAll('[data-id]').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.classList.contains('btn-qnow') || e.target.classList.contains('btn-qadj') || e.target.classList.contains('btn-qref')) return;
                const id = el.dataset.id;
                const f = this.flights.find(fl => fl.id === id);
                if (f) this.onFlightSelect(f);
            });
            el.addEventListener('dblclick', (e) => {
                if (e.target.classList.contains('btn-qnow') || e.target.classList.contains('btn-qadj') || e.target.classList.contains('btn-qref')) return;
                const id = el.dataset.id;
                const f = this.flights.find(fl => fl.id === id);
                if (f) this.onFlightDblClick(f, e);
            });
        });
        this.container.querySelectorAll('.btn-qnow').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                setAtd(btn.dataset.id, secToTime(nowUtcSec()), 'now_btn');
            });
        });
        this.container.querySelectorAll('.btn-qadj').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const f = this.flights.find(fl => fl.id === btn.dataset.id);
                if (!f) return;
                const delta = parseInt(btn.dataset.d, 10);
                const base = timeToSec(f.ctot || f.eobt) + delta * 60;
                adjustCtot(f.id, secToTime(base));
            });
        });
        this.container.querySelectorAll('.btn-qref').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const f = this.flights.find(fl => fl.id === btn.dataset.id);
                if (!f) return;
                this.onSetAirportRefByFlight(f.dept, f.ctot || f.eobt);
            });
        });
    }
}
