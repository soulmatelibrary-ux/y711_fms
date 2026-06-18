/**
 * SettingsModal — 비행시간 / 출발간격 / 분리간격 설정 모달
 */
import { apiGet, apiPut } from '../utils/api.js';
import { showToast } from '../utils/toast.js';

export class SettingsModal {
    constructor({ onExcelImport, onExcelExport } = {}) {
        this.onExcelImport = onExcelImport || (async () => {});
        this.onExcelExport = onExcelExport || (() => {});
        this._dragCleanup = null;
    }

    open() {
        if (document.getElementById('settings-modal')) return;
        this._load();
    }

    close() {
        if (this._dragCleanup) {
            this._dragCleanup();
            this._dragCleanup = null;
        }
        document.getElementById('settings-modal')?.remove();
    }

    async _load() {
        const overlay = document.createElement('div');
        overlay.id = 'settings-modal';
        overlay.className = 'modal-overlay stg-overlay';
        overlay.innerHTML = `
        <div class="modal-box stg-box">
            <div class="modal-header">
                <span>⚙ 시간 설정</span>
                <button class="modal-close" id="stg-close">×</button>
            </div>
            <div class="help-tabs">
                <button class="help-tab active" data-tab="interval">출발간격</button>
                <button class="help-tab" data-tab="separation">분리간격</button>
            </div>
            <div class="stg-loading">로드 중...</div>
        </div>`;
        document.body.appendChild(overlay);

        overlay.querySelector('#stg-close').addEventListener('click', () => this.close());
        const box = overlay.querySelector('.stg-box');
        const header = box?.querySelector('.modal-header');
        if (box && header) this._dragCleanup = this._enableDrag(box, header);
        overlay.querySelectorAll('.help-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                overlay.querySelectorAll('.help-tab').forEach(t => t.classList.remove('active'));
                overlay.querySelectorAll('.stg-pane').forEach(p => p.classList.add('hidden'));
                tab.classList.add('active');
                overlay.querySelector(`#stg-pane-${tab.dataset.tab}`)?.classList.remove('hidden');
            });
        });

        try {
            const [aptRes, zoneRes] = await Promise.all([
                apiGet('/api/v2/settings/airports'),
                apiGet('/api/v2/settings/conflict-zones'),
            ]);
            overlay.querySelector('.stg-loading').replaceWith(
                this._buildContent(aptRes.data, zoneRes.data)
            );
        } catch (e) {
            overlay.querySelector('.stg-loading').textContent = `로드 실패: ${e.message}`;
        }
    }

    _enableDrag(box, handle) {
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let baseLeft = 0;
        let baseTop = 0;

        const onMove = (e) => {
            if (!dragging) return;
            const nextLeft = baseLeft + (e.clientX - startX);
            const nextTop = baseTop + (e.clientY - startY);
            const maxLeft = Math.max(0, window.innerWidth - box.offsetWidth);
            const maxTop = Math.max(0, window.innerHeight - box.offsetHeight);
            box.style.left = `${Math.min(maxLeft, Math.max(0, nextLeft))}px`;
            box.style.top = `${Math.min(maxTop, Math.max(0, nextTop))}px`;
        };

        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            document.body.style.userSelect = '';
        };

        const onDown = (e) => {
            if (e.button !== 0) return;
            if (e.target.closest('#stg-close')) return;
            const rect = box.getBoundingClientRect();
            box.style.position = 'fixed';
            box.style.left = `${rect.left}px`;
            box.style.top = `${rect.top}px`;
            box.style.margin = '0';
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            baseLeft = rect.left;
            baseTop = rect.top;
            document.body.style.userSelect = 'none';
            e.preventDefault();
        };

        handle.addEventListener('mousedown', onDown);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);

        return () => {
            handle.removeEventListener('mousedown', onDown);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.userSelect = '';
        };
    }

    _buildContent(airports, zones) {
        const wrap = document.createElement('div');
        wrap.className = 'stg-content';

        // ── 탭1: 출발간격 ──────────────────────────────────────
        const pInterval = document.createElement('div');
        pInterval.id = 'stg-pane-interval';
        pInterval.className = 'stg-pane';
        pInterval.innerHTML = `
        <div class="stg-section-title">공항 출발 설정</div>
        <table class="stg-table">
            <thead><tr><th>공항</th><th>합류점</th><th>게이트→활주로(분)</th><th>활주로 간격(분)</th><th>활주로→이륙(분)</th><th></th></tr></thead>
            <tbody>
                ${airports.map(r => `
                <tr data-type="apt" data-icao="${r.icao}">
                    <td class="stg-label">${r.icao} <span class="stg-nameko">${r.name_ko || ''}</span></td>
                    <td class="stg-label stg-wp">${r.merge_point}</td>
                    <td><input class="stg-input stg-gate-to-runway" type="number" min="1" max="60" value="${r.gate_to_runway_min || 10}"></td>
                    <td><input class="stg-input stg-dep-interval" type="number" min="1" max="60" value="${r.dep_interval}"></td>
                    <td><input class="stg-input stg-runway-takeoff" type="number" min="1" max="30" value="${r.runway_takeoff_min || 2}"></td>
                    <td><button class="stg-save-btn">저장</button></td>
                </tr>`).join('')}
            </tbody>
        </table>`;

        // ── 탭2: 분리간격 ──────────────────────────────────────
        const pSep = document.createElement('div');
        pSep.id = 'stg-pane-separation';
        pSep.className = 'stg-pane hidden';
        pSep.innerHTML = `
        <div class="stg-section-title">합류점 최소 분리 간격</div>
        <table class="stg-table">
            <thead><tr><th>웨이포인트</th><th>이름</th><th>분리간격(분)</th><th></th></tr></thead>
            <tbody>
                ${zones.map(r => `
                <tr data-type="zone" data-wp="${r.waypoint}">
                    <td class="stg-label stg-wp">${r.waypoint}</td>
                    <td class="stg-label">${r.name || ''}</td>
                    <td><input class="stg-input" type="number" min="1" max="30" value="${r.separation_min}"></td>
                    <td><button class="stg-save-btn">저장</button></td>
                </tr>`).join('')}
            </tbody>
        </table>`;

        wrap.append(pInterval, pSep);
        this._bindSaveButtons(wrap);
        return wrap;
    }

    _bindSaveButtons(wrap) {
        wrap.querySelectorAll('tr[data-type]').forEach(row => {
            const btn = row.querySelector('.stg-save-btn');
            const type = row.dataset.type;

            const save = async () => {
                btn.disabled = true;
                try {
                    if (type === 'apt') {
                        // 공항: 3개 필드 모두 추출
                        const gateToRunway = parseInt(row.querySelector('.stg-gate-to-runway').value, 10);
                        const depInterval = parseInt(row.querySelector('.stg-dep-interval').value, 10);
                        const runwayTakeoff = parseInt(row.querySelector('.stg-runway-takeoff').value, 10);

                        if (!gateToRunway || !depInterval || !runwayTakeoff || gateToRunway < 1 || depInterval < 1 || runwayTakeoff < 1) {
                            row.querySelectorAll('.stg-input').forEach(inp => {
                                inp.classList.add('stg-input-error');
                                setTimeout(() => inp.classList.remove('stg-input-error'), 1500);
                            });
                            btn.disabled = false;
                            return;
                        }

                        await this._save(row.dataset, { gateToRunway, depInterval, runwayTakeoff });
                    } else if (type === 'zone') {
                        // 분리간격: 1개 필드
                        const input = row.querySelector('.stg-input');
                        const val = parseInt(input.value, 10);
                        if (!val || val < 1) {
                            input.classList.add('stg-input-error');
                            setTimeout(() => input.classList.remove('stg-input-error'), 1500);
                            btn.disabled = false;
                            return;
                        }
                        await this._save(row.dataset, val);
                    }

                    btn.textContent = '✓';
                    btn.classList.add('stg-saved');
                    setTimeout(() => { btn.textContent = '저장'; btn.classList.remove('stg-saved'); btn.disabled = false; }, 1500);
                    document.dispatchEvent(new CustomEvent('settings:updated'));
                } catch (e) {
                    btn.disabled = false;
                    showToast(`저장 실패: ${e.message}`, 'error');
                }
            };

            btn.addEventListener('click', save);
            row.querySelectorAll('.stg-input').forEach(input => {
                input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
            });
        });
    }

    async _save({ type, icao, wp }, value) {
        if (type === 'apt') {
            const row = document.querySelector(`tr[data-icao="${icao}"]`);
            const mergePoint = row?.querySelector('.stg-wp')?.textContent?.trim();
            await apiPut(`/api/v2/settings/airports/${icao}`, {
                dep_interval: value.depInterval,
                merge_point: mergePoint,
                name_ko: row?.querySelector('.stg-nameko')?.textContent?.trim() || '',
                gate_to_runway_min: value.gateToRunway,
                runway_takeoff_min: value.runwayTakeoff
            });
        } else if (type === 'zone') {
            await apiPut(`/api/v2/settings/conflict-zones/${wp}`, { separation_min: value });
        }
    }
}
