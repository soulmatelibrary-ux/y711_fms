/**
 * DepartureQueue — NOW+60분 출발 대기열 카드 목록
 */
import { timeToSec, secToTime, nowUtcSec, formatDisplay, escapeHtml, toAbsSec } from '../utils/timeUtils.js';
import { setAtd, adjustCtot } from '../services/atdManager.js';
import { getSettings } from '../utils/settingsLoader.js';
import { AIRPORT_COLOR } from '../config/miniMapGeo.js';

export class DepartureQueue {
    constructor(container, {
        onFlightSelect, onFlightDblClick,
        onSimulationRequest
    } = {}) {
        this.container = container;
        this.flights = [];
        this.conflicts = [];
        this.onFlightSelect = onFlightSelect || (() => {});
        this.onFlightDblClick = onFlightDblClick || (() => {});
        this.onSimulationRequest = onSimulationRequest || (() => {});
        this._searchQuery = '';
        this._filterApt = '';
        this._nextSlotBarEl = null;
        this._interval = setInterval(() => this._render(), 10000);
        this._renderNextSlotBar();
        this._renderSearchBar();
    }

    _renderNextSlotBar() {
        const bar = document.createElement('div');
        bar.className = 'apt-next-slot-bar';
        bar.innerHTML = this._nextSlotHTML();
        this._nextSlotBarEl = bar;
        this.container.parentElement?.insertBefore(bar, this.container);
    }

    _nextSlotHTML() {
        return Object.entries(AIRPORT_COLOR).map(([icao, color]) => {
            const earliest = this.flights
                .filter(f => f.dept === icao && !f.atd && f.status !== 'DEP')
                .map(f => ({ f, t: toAbsSec(timeToSec(f.ctot || f.eobt)) }))
                .filter(({ t }) => t > 0)
                .sort((a, b) => a.t - b.t)[0];
            const label = earliest ? formatDisplay(earliest.f.ctot || earliest.f.eobt) : '--:--';
            return `<span class="apt-next-slot-chip" style="--apt-color:${color}">
                <span class="apt-next-slot-icao">${icao}</span>
                <span class="apt-next-slot-time">${label}</span>
            </span>`;
        }).join('');
    }

    _updateNextSlotBar() {
        if (this._nextSlotBarEl) this._nextSlotBarEl.innerHTML = this._nextSlotHTML();
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

    setFlights(flights) { this.flights = flights; this._updateNextSlotBar(); this._render(); }
    setConflicts(conflicts) { this.conflicts = conflicts; this._render(); }

    destroy() { clearInterval(this._interval); }

    _render() {
        // 포커스 상태 저장 (render 후 복원용)
        const activeInput = this.container.querySelector('.input-ctot:focus');
        const focusedId = activeInput?.dataset.id || null;
        const focusedValue = activeInput?.value || null;

        const now = toAbsSec(nowUtcSec());
        const windowSec = 3 * 60 * 60;
        const queue = this.flights
            .filter(f => {
                const ctotSec = toAbsSec(timeToSec(f.ctot || f.eobt));

                if (f.atd) {
                    // ATD 항공기: RKPC 도착 시각까지 표시 (웨이포인트 없으면 ATD+90분)
                    const rkpcWp = (f.routeWaypoints || []).find(w => w.name === 'RKPC');
                    const removeSec = (rkpcWp && Number.isFinite(rkpcWp.timeSec))
                        ? toAbsSec(rkpcWp.timeSec)
                        : toAbsSec(timeToSec(f.atd)) + 90 * 60;
                    if (removeSec < now) return false;
                } else {
                    // ATD 미입력: CTOT ±3시간 이내만 표시
                    if (ctotSec < now - 3 * 60 * 60) return false;
                    if (ctotSec > now + windowSec) return false;
                }

                if (this._searchQuery && !f.callsign?.toUpperCase().includes(this._searchQuery)) return false;
                if (this._filterApt && f.dept !== this._filterApt) return false;
                return true;
            })
            .sort((a, b) => toAbsSec(timeToSec(a.eobt)) - toAbsSec(timeToSec(b.eobt)));

        if (!queue.length) {
            this.container.innerHTML = `
                <div class="queue-empty">
                    <div class="empty-title">표시할 출발편 없음</div>
                    <div class="empty-hint">10분 후 자동 새로고침됩니다.<br>
                    <button class="btn-empty-refresh">지금 새로고침</button></div>
                </div>`;
            this.container.querySelector('.btn-empty-refresh')?.addEventListener('click', () => this._render());
            return;
        }

        const rowsHtml = queue.map(f => {
            const ctotSec = toAbsSec(timeToSec(f.ctot || f.eobt));
            const diffMins = Math.round((ctotSec - now) / 60);
            const hasConflict = this.conflicts.some(c => c.f1.id === f.id || c.f2.id === f.id);
            const isImminent = Math.abs(diffMins) <= 5;
            const isDep = f.status === 'DEP';

            let cardClass = 'queue-card';
            if (isDep) cardClass += ' card-dep';
            else if (hasConflict) cardClass += ' card-conflict';
            else if (isImminent) cardClass += ' card-imminent';

            const timeLabel = diffMins > 0 ? `+${diffMins}m` : `${diffMins}m`;
            const aptColor = AIRPORT_COLOR[f.dept] || '#4fc3f7';

            const rfl = f.cfl ? String(f.cfl).toUpperCase() : '—';
            const atdDisplay = f.atd
                ? `<span class="qc-cell qc-time qc-atd">${formatDisplay(f.atd)}</span>`
                : `<span class="qc-cell qc-time qc-atd qc-atd-empty">--:--</span>`;

            const actype = escapeHtml(f.actype || '—');
            return `<div class="${cardClass}" data-id="${f.id}" style="border-left: 4px solid ${aptColor}">
                <div class="qc-line">
                    <span class="qc-cell qc-callsign" style="color:${aptColor}">${escapeHtml(f.callsign)}</span>
                    <span class="qc-cell qc-type">${actype}</span>
                    <span class="qc-cell qc-alt">${rfl}</span>
                    <span class="qc-cell qc-time">${formatDisplay(f.eobt)}</span>
                    <span class="qc-cell qc-time">${formatDisplay(f.ctot || f.eobt)}</span>
                    ${atdDisplay}
                    <span class="qc-cell qc-delta ${diffMins < 0 ? 'past' : ''}">${timeLabel}</span>
                    ${hasConflict ? '<span class="qc-conflict-badge">⚠</span>' : ''}
                    ${isDep
                        ? `<span class="qc-dep-badge qc-inline">출발완료 ✓</span>`
                        : `<span class="qc-actions-inline"><button class="btn-qnow" data-id="${f.id}">NOW</button>
                           <button class="btn-qsim" data-id="${f.id}" title="시뮬레이션 미리보기">SIM</button>
                           <input type="text" class="input-ctot${f.ctotFloor ? ' input-ctot--manual' : ''}" data-id="${f.id}" value="${formatDisplay(f.ctot || f.eobt)}" maxlength="5" placeholder="HH:MM"${f.ctotFloor ? ' title="수동 입력됨"' : ''}></span>`
                    }
                </div>
            </div>`;
        }).join('');

        this.container.innerHTML = `
            <div class="queue-col-head">
                <span class="qch-cell qch-callsign">CALLSIGN</span>
                <span class="qch-cell qch-type">기종</span>
                <span class="qch-cell qch-alt">고도</span>
                <span class="qch-cell qch-time">EOBT</span>
                <span class="qch-cell qch-time">CTOT</span>
                <span class="qch-cell qch-time">ATD</span>
                <span class="qch-cell qch-delta">Δ</span>
                <span class="qch-cell qch-actions">조작</span>
            </div>
            ${rowsHtml}
        `;

        // 이벤트 바인딩
        this.container.querySelectorAll('[data-id]').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.classList.contains('btn-qnow') || e.target.classList.contains('btn-qsim') || e.target.classList.contains('input-ctot')) return;
                const id = el.dataset.id;
                const f = this.flights.find(fl => fl.id === id);
                if (f) this.onFlightSelect(f);
            });
            el.addEventListener('dblclick', (e) => {
                if (e.target.classList.contains('btn-qnow') || e.target.classList.contains('btn-qsim') || e.target.classList.contains('input-ctot')) return;
                const id = el.dataset.id;
                const f = this.flights.find(fl => fl.id === id);
                if (f) this.onFlightDblClick(f, e);
            });
        });
        this.container.querySelectorAll('.btn-qnow').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                adjustCtot(btn.dataset.id, secToTime(nowUtcSec()));
            });
        });
        // SIM 버튼 핸들러
        this.container.querySelectorAll('.btn-qsim').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const f = this.flights.find(fl => fl.id === btn.dataset.id);
                if (f) this.onSimulationRequest(f);
            });
        });
        // CTOT 직접 입력 핸들러
        this.container.querySelectorAll('.input-ctot').forEach(input => {
            let applied = false; // Enter 후 blur 중복 방지 플래그
            const applyCtot = () => {
                if (applied) { applied = false; return; }
                const f = this.flights.find(fl => fl.id === input.dataset.id);
                if (!f) return;
                const raw = input.value.trim().replace(':', '');
                // 공백 입력 시 EOBT를 기본값으로 설정
                if (!raw) {
                    input.value = formatDisplay(f.eobt);
                    adjustCtot(f.id, f.eobt);
                    return;
                }
                // HHMM 형식 검증 (4자리 숫자)
                if (!/^\d{4}$/.test(raw)) {
                    input.value = formatDisplay(f.ctot || f.eobt);
                    return;
                }
                const hh = parseInt(raw.slice(0, 2), 10);
                const mm = parseInt(raw.slice(2, 4), 10);
                if (hh > 23 || mm > 59) {
                    input.value = formatDisplay(f.ctot || f.eobt);
                    return;
                }
                const newCtot = raw;
                const currentCtot = f.ctot || f.eobt;
                // 변경이 없으면 무시
                if (newCtot === currentCtot) return;
                adjustCtot(f.id, newCtot);
            };
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    applyCtot();
                    applied = true; // blur 시 중복 실행 방지
                    input.blur();
                }
                if (e.key === 'Escape') {
                    applied = true; // blur 시 applyCtot 스킵
                    const f = this.flights.find(fl => fl.id === input.dataset.id);
                    if (f) input.value = formatDisplay(f.ctot || f.eobt);
                    input.blur();
                }
            });
            input.addEventListener('blur', applyCtot);
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('focus', () => input.select());
        });
        // 포커스 복원 (입력 중이었던 경우)
        if (focusedId) {
            const inputToRestore = this.container.querySelector(`.input-ctot[data-id="${focusedId}"]`);
            if (inputToRestore) {
                inputToRestore.value = focusedValue;
                inputToRestore.focus();
                // 커서를 끝으로 이동
                inputToRestore.setSelectionRange(focusedValue.length, focusedValue.length);
            }
        }
    }
}
