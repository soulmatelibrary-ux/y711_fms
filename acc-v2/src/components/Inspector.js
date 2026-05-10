/**
 * Inspector — 더블클릭 팝업으로 선택된 항공편 상세 표시
 */
import { formatDisplay, diffMinutes, nowUtcTime, escapeHtml, timeToSec, secToTime } from '../utils/timeUtils.js';
import { setAtd, adjustCtot } from '../services/atdManager.js';

export class Inspector {
    constructor() {
        this.flight = null;
        this._popup = null;
        this._outsideHandler = null;
    }

    showPopup(flight, clientX, clientY) {
        this.close();
        this.flight = flight;
        const popup = document.createElement('div');
        popup.className = 'insp-popup';
        popup.setAttribute('tabindex', '0');

        // keydown은 팝업 생성 시 1회만 등록 (_renderContent 재호출 시 누적되지 않도록)
        popup.addEventListener('keydown', (e) => {
            const f = this.flight;
            if (!f) return;
            if (!['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) return;
            if (e.target.matches('input')) return;
            e.preventDefault();
            if (e.key === 'Escape') { this.close(); return; }
            if (e.key === 'Enter') { setAtd(f.id, nowUtcTime(), 'now_btn'); return; }
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 5 : 1);
            if (f.status === 'DEP') {
                setAtd(f.id, secToTime(timeToSec(f.atd) + delta * 60), 'adj_key');
            } else {
                adjustCtot(f.id, secToTime(timeToSec(f.ctot || f.eobt) + delta * 60));
            }
        });

        document.body.appendChild(popup);
        this._popup = popup;
        this._renderContent();

        // 뷰포트 밖으로 나가지 않도록 위치 조정
        const W = 284, H = 360;
        const x = Math.min(clientX + 10, window.innerWidth - W - 8);
        const y = Math.min(clientY + 10, window.innerHeight - H - 8);
        popup.style.left = `${Math.max(8, x)}px`;
        popup.style.top = `${Math.max(8, y)}px`;

        this._outsideHandler = (e) => {
            if (this._popup && !this._popup.contains(e.target)) this.close();
        };
        setTimeout(() => document.addEventListener('mousedown', this._outsideHandler), 0);
    }

    setFlight(flight) {
        this.flight = flight;
        if (this._popup) this._renderContent();
    }

    close() {
        if (this._popup) {
            this._popup.remove();
            this._popup = null;
        }
        if (this._outsideHandler) {
            document.removeEventListener('mousedown', this._outsideHandler);
            this._outsideHandler = null;
        }
        this.flight = null;
    }

    _renderContent() {
        if (!this._popup) return;
        const f = this.flight;
        const statusColor = { SCH: '#4fc3f7', DEP: '#4caf50', ARR: '#81c784' }[f.status] || '#888';
        const ctotDelta = f.atd ? diffMinutes(f.ctot, f.atd) : null;

        this._popup.innerHTML = `
        <div class="insp-popup-header">
            <span class="insp-callsign">${escapeHtml(f.callsign)}</span>
            <span class="insp-status" style="color:${statusColor}" title="SCH=예정/DEP=출발완료">${f.status || 'SCH'}</span>
            <button class="insp-close-btn" title="닫기 (ESC)">×</button>
        </div>
        <div class="insp-row"><span class="insp-lbl">출발</span><span class="insp-val">${f.dept}</span></div>
        <div class="insp-row"><span class="insp-lbl">도착</span><span class="insp-val">${f.dest || 'RKPC'}</span></div>
        <div class="insp-row">
            <span class="insp-lbl" title="Estimated Off-Block Time">EOBT</span>
            <span class="insp-val mono">${formatDisplay(f.eobt)}</span>
        </div>
        <div class="insp-row">
            <span class="insp-lbl" title="Calculated Take-Off Time">CTOT</span>
            <span class="insp-val mono" style="color:#ffd700">${formatDisplay(f.ctot)}</span>
        </div>
        <div class="insp-row">
            <span class="insp-lbl" title="Actual Take-off Departure">ATD</span>
            <span class="insp-val mono" style="color:#4caf50">${f.atd ? formatDisplay(f.atd) : '——'}</span>
        </div>
        ${ctotDelta !== null ? `
        <div class="insp-delta-big ${ctotDelta > 0 ? 'delta-delay' : 'delta-early'}">
            <span class="delta-sign">${ctotDelta > 0 ? '+' : ''}${ctotDelta}m</span>
            <span class="delta-label">ATD vs CTOT</span>
        </div>` : ''}
        <div class="insp-row"><span class="insp-lbl" title="Cleared Flight Level">CFL</span><span class="insp-val">${f.cfl || '—'}</span></div>
        <div class="insp-actions">
            <button class="btn-now" data-id="${f.id}">SET NOW</button>
            <button class="btn-adj" data-id="${f.id}" data-delta="-1">−1m</button>
            <button class="btn-adj" data-id="${f.id}" data-delta="+1">+1m</button>
        </div>
        <div class="insp-hhmm-row">
            <input class="insp-hhmm-input" id="insp-hhmm" type="text" maxlength="5" placeholder="HH:MM" autocomplete="off">
            <button class="btn-hhmm-set">SET</button>
        </div>
        <div class="insp-hhmm-err" id="insp-hhmm-err"></div>
        <div class="insp-hint">↑↓ ±1m &nbsp;|&nbsp; Shift+↑↓ ±5m &nbsp;|&nbsp; Enter = NOW</div>`;

        this._popup.querySelector('.insp-close-btn')?.addEventListener('click', () => this.close());

        this._popup.querySelector('.btn-now')?.addEventListener('click', () => {
            setAtd(f.id, nowUtcTime(), 'now_btn');
        });

        this._popup.querySelectorAll('.btn-adj').forEach(btn => {
            btn.addEventListener('click', () => {
                const delta = parseInt(btn.dataset.delta, 10);
                if (f.status === 'DEP') {
                    setAtd(f.id, secToTime(timeToSec(f.atd) + delta * 60), 'adj_btn');
                } else {
                    adjustCtot(f.id, secToTime(timeToSec(f.ctot || f.eobt) + delta * 60));
                }
            });
        });

        const hhmmInput = this._popup.querySelector('#insp-hhmm');
        const hhmmErr = this._popup.querySelector('#insp-hhmm-err');

        const applyHHMM = () => {
            const raw = hhmmInput.value.replace(':', '').trim();
            if (!/^\d{4}$/.test(raw)) {
                hhmmErr.textContent = '형식 오류 — HH:MM 또는 HHMM';
                hhmmInput.style.borderColor = '#ff3b30';
                return;
            }
            const h = parseInt(raw.slice(0, 2), 10);
            const m = parseInt(raw.slice(2, 4), 10);
            if (h > 23 || m > 59) {
                hhmmErr.textContent = '유효하지 않은 시각';
                hhmmInput.style.borderColor = '#ff3b30';
                return;
            }
            hhmmErr.textContent = '';
            hhmmInput.style.borderColor = '';
            setAtd(f.id, raw, 'manual');
            hhmmInput.value = '';
        };

        this._popup.querySelector('.btn-hhmm-set')?.addEventListener('click', applyHHMM);
        hhmmInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); applyHHMM(); }
            if (e.key === 'Escape') { this.close(); }
        });

        // 팝업 열리면 포커스 (keydown은 showPopup에서 1회만 등록)
        requestAnimationFrame(() => this._popup?.focus());
    }
}
