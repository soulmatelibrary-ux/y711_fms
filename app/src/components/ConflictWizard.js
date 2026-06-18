/**
 * ConflictWizard — 충돌 해결 모달 (4가지 옵션)
 */
import { resolveConflictDelay, setAtd, previewCtot } from '../services/atdManager.js';
import { timeToSec, secToTime } from '../utils/timeUtils.js';

export class ConflictWizard {
    constructor() {
        this._overlay = null;
        this._conflict = null;
        this._flights = null;
    }

    setFlights(flights) { this._flights = flights; }

    open(conflict) {
        this._conflict = conflict;
        this._render();
    }

    close() {
        if (this._overlay) {
            this._overlay.remove();
            this._overlay = null;
        }
    }

    _render() {
        if (this._overlay) this._overlay.remove();

        const cf = this._conflict;
        const diffMin = Math.floor(cf.timeDiffSec / 60);
        const diffSec = cf.timeDiffSec % 60;
        const neededMin = Math.ceil((cf.requiredSec - cf.timeDiffSec) / 60) + 1;

        const overlay = document.createElement('div');
        overlay.className = 'wizard-overlay';
        overlay.innerHTML = `
        <div class="wizard-modal">
            <div class="wizard-header">
                <span class="wizard-title">⚠ 충돌 해결 — ${cf.zone}</span>
                <button class="wizard-close">×</button>
            </div>
            <div class="wizard-info">
                <div class="wiz-row">
                    <span class="wiz-lbl">선행편</span>
                    <span class="wiz-val">${cf.f1.callsign} (${cf.f1.dept})</span>
                </div>
                <div class="wiz-row">
                    <span class="wiz-lbl">후행편</span>
                    <span class="wiz-val">${cf.f2.callsign} (${cf.f2.dept})</span>
                </div>
                <div class="wiz-row">
                    <span class="wiz-lbl">현재 분리</span>
                    <span class="wiz-val conflict-val">${diffMin}분 ${diffSec}초</span>
                </div>
                <div class="wiz-row">
                    <span class="wiz-lbl">필요 분리</span>
                    <span class="wiz-val">${cf.requiredSec / 60}분</span>
                </div>
            </div>
            <div class="wizard-options">
                <div class="wiz-opt" data-opt="A">
                    <span class="wiz-opt-key">A</span>
                    <div class="wiz-opt-body">
                        <strong>후행편 지연</strong>
                        <span>${cf.f2.callsign}을 +${neededMin}분 지연 (분리 충족 최소)</span>
                    </div>
                    <span class="wiz-opt-badge recommended">권장</span>
                </div>
                <div class="wiz-opt" data-opt="B">
                    <span class="wiz-opt-key">B</span>
                    <div class="wiz-opt-body">
                        <strong>선행편 보류</strong>
                        <span>${cf.f1.callsign}을 +${neededMin}분 지연</span>
                    </div>
                </div>
                <div class="wiz-opt" data-opt="C">
                    <span class="wiz-opt-key">C</span>
                    <div class="wiz-opt-body">
                        <strong>항로/고도 변경</strong>
                        <span>합류점 우회 또는 고도 분리 (메모 기록)</span>
                    </div>
                </div>
                <div class="wiz-opt" data-opt="D">
                    <span class="wiz-opt-key">D</span>
                    <div class="wiz-opt-body">
                        <strong>수동 수용</strong>
                        <span>사유 입력 후 현재 상태 유지</span>
                    </div>
                </div>
            </div>
            <div class="wizard-preview" id="wiz-preview">
                <div class="wiz-preview-hint">옵션에 마우스를 올리면 영향 미리보기가 표시됩니다</div>
            </div>
            <div class="wizard-footer">
                <button class="btn-wiz-cancel">취소</button>
            </div>
        </div>`;

        document.body.appendChild(overlay);
        this._overlay = overlay;

        overlay.querySelector('.wizard-close').addEventListener('click', () => this.close());
        overlay.querySelector('.btn-wiz-cancel').addEventListener('click', () => this.close());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });

        overlay.querySelectorAll('.wiz-opt').forEach(opt => {
            opt.addEventListener('click', () => this._applyOption(opt.dataset.opt, neededMin));
            opt.addEventListener('mouseenter', () => this._showPreview(opt.dataset.opt, neededMin));
            opt.addEventListener('mouseleave', () => this._clearPreview());
        });

        // 키보드 단축키 A/B/C/D, Enter = 권장(A)
        overlay.addEventListener('keydown', (e) => {
            const map = { a: 'A', b: 'B', c: 'C', d: 'D', Enter: 'A' };
            const opt = map[e.key];
            if (opt) this._applyOption(opt, neededMin);
        });
        overlay.setAttribute('tabindex', '0');
        setTimeout(() => overlay.focus(), 50);
    }

    _showPreview(opt, neededMin) {
        const panel = this._overlay?.querySelector('#wiz-preview');
        if (!panel || !this._flights) return;

        const cf = this._conflict;
        let targetId = null;
        let deltaMin = neededMin;

        if (opt === 'A') targetId = cf.f2.id;
        else if (opt === 'B') targetId = cf.f1.id;
        else {
            panel.innerHTML = `<div class="wiz-preview-hint">${opt === 'C' ? '항로/고도 변경 — 시스템 외부 조정' : '수동 수용 — 현재 상태 유지'}</div>`;
            return;
        }

        const target = this._flights.find(f => f.id === targetId);
        if (!target) return;

        const newTimeSec = timeToSec(target.ctot || target.eobt) + deltaMin * 60;
        const newTime = secToTime(newTimeSec);
        const { flights: preview, conflicts: newCf } = previewCtot(this._flights, targetId, newTime);

        const affected = preview.filter(f => {
            const orig = this._flights.find(o => o.id === f.id);
            return orig && orig.ctot !== f.ctot;
        });

        const rows = affected.length
            ? affected.map(f => {
                const orig = this._flights.find(o => o.id === f.id);
                const d = Math.round((timeToSec(f.ctot) - timeToSec(orig.ctot)) / 60);
                return `<div class="prev-row"><span>${f.callsign}</span><span class="${d > 0 ? 'prev-delay' : 'prev-early'}">${d > 0 ? '+' : ''}${d}m</span></div>`;
            }).join('')
            : '<div class="wiz-preview-hint">연쇄 영향 없음</div>';

        panel.innerHTML = `
            <div class="prev-title">영향 미리보기 — 옵션 ${opt}</div>
            ${rows}
            <div class="prev-conflicts">잔여 충돌: ${newCf.length}건</div>`;
    }

    _clearPreview() {
        const panel = this._overlay?.querySelector('#wiz-preview');
        if (panel) panel.innerHTML = `<div class="wiz-preview-hint">옵션에 마우스를 올리면 영향 미리보기가 표시됩니다</div>`;
    }

    async _applyOption(opt, neededMin) {
        const cf = this._conflict;
        if (opt === 'A') {
            await resolveConflictDelay(cf);
        } else if (opt === 'B') {
            await resolveConflictDelay({ ...cf, f2: cf.f1 }, 'f1_delay');
        } else if (opt === 'C') {
            this._showMemoDialog(`항로/고도 변경 메모\n${cf.f1.callsign} vs ${cf.f2.callsign} at ${cf.zone}`);
            return;
        } else if (opt === 'D') {
            this._showMemoDialog(`수용 사유 입력\n${cf.f1.callsign} vs ${cf.f2.callsign} at ${cf.zone}`);
            return;
        }
        this.close();
    }

    _showMemoDialog(title) {
        const modal = document.createElement('div');
        modal.className = 'wizard-overlay';
        modal.innerHTML = `
        <div class="wizard-modal" style="max-width:400px">
            <div class="wizard-header">
                <span class="wizard-title">${title}</span>
                <button class="memo-close">×</button>
            </div>
            <div style="padding:16px">
                <textarea id="memo-input" rows="4" style="width:100%;background:#0d1117;border:1px solid #1e2a3a;color:#c8d4e0;padding:8px;border-radius:4px;font-size:13px;resize:vertical" placeholder="메모를 입력하세요..."></textarea>
            </div>
            <div class="wizard-footer">
                <button class="btn-wiz-cancel">취소</button>
                <button class="btn-memo-ok" style="background:#4fc3f7;color:#000;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:bold">확인</button>
            </div>
        </div>`;
        document.body.appendChild(modal);
        modal.querySelector('.memo-close').addEventListener('click', () => modal.remove());
        modal.querySelector('.btn-wiz-cancel').addEventListener('click', () => modal.remove());
        modal.querySelector('.btn-memo-ok').addEventListener('click', () => {
            const val = modal.querySelector('#memo-input').value.trim();
            document.dispatchEvent(new CustomEvent('conflict:memo', {
                detail: {
                    conflict: this._conflict,
                    option: title.startsWith('항로') ? 'C' : 'D',
                    memo: val || '(메모 없음)',
                    user: localStorage.getItem('username') || 'unknown'
                }
            }));
            modal.remove();
            this.close();
        });
    }
}
