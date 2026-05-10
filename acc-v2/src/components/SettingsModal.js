/**
 * SettingsModal — 비행시간 / 출발간격 / 분리간격 설정 모달
 */
import { apiGet, apiPut } from '../utils/api.js';
import { showToast } from '../utils/toast.js';

export class SettingsModal {
    open() {
        if (document.getElementById('settings-modal')) return;
        this._load();
    }

    close() {
        document.getElementById('settings-modal')?.remove();
    }

    async _load() {
        const overlay = document.createElement('div');
        overlay.id = 'settings-modal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
        <div class="modal-box stg-box">
            <div class="modal-header">
                <span>⚙ 시간 설정</span>
                <button class="modal-close" id="stg-close">×</button>
            </div>
            <div class="help-tabs">
                <button class="help-tab active" data-tab="timing">비행시간</button>
                <button class="help-tab" data-tab="interval">출발간격</button>
                <button class="help-tab" data-tab="separation">분리간격</button>
            </div>
            <div class="stg-loading">로드 중…</div>
        </div>`;
        document.body.appendChild(overlay);

        overlay.querySelector('#stg-close').addEventListener('click', () => this.close());
        overlay.addEventListener('click', e => { if (e.target === overlay) this.close(); });
        overlay.querySelectorAll('.help-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                overlay.querySelectorAll('.help-tab').forEach(t => t.classList.remove('active'));
                overlay.querySelectorAll('.stg-pane').forEach(p => p.classList.add('hidden'));
                tab.classList.add('active');
                overlay.querySelector(`#stg-pane-${tab.dataset.tab}`)?.classList.remove('hidden');
            });
        });

        try {
            const [segRes, wpRes, aptRes, zoneRes] = await Promise.all([
                apiGet('/api/v2/settings/segments'),
                apiGet('/api/v2/settings/waypoints'),
                apiGet('/api/v2/settings/airports'),
                apiGet('/api/v2/settings/conflict-zones'),
            ]);
            overlay.querySelector('.stg-loading').replaceWith(
                this._buildContent(segRes.data, wpRes.data, aptRes.data, zoneRes.data)
            );
        } catch (e) {
            overlay.querySelector('.stg-loading').textContent = `로드 실패: ${e.message}`;
        }
    }

    _buildContent(segments, waypoints, airports, zones) {
        const wrap = document.createElement('div');
        wrap.className = 'stg-content';

        // ── 탭1: 비행시간 ──────────────────────────────────────
        const pTiming = document.createElement('div');
        pTiming.id = 'stg-pane-timing';
        pTiming.className = 'stg-pane';
        pTiming.innerHTML = `
        <div class="stg-section-title">공항 → 합류점</div>
        <table class="stg-table">
            <thead><tr><th>공항</th><th>합류점</th><th>비행시간(분)</th><th></th></tr></thead>
            <tbody>
                ${segments.map(r => `
                <tr data-type="seg" data-from="${r.from_icao}" data-to="${r.to_waypoint}">
                    <td class="stg-label">${r.from_icao}</td>
                    <td class="stg-label stg-wp">${r.to_waypoint}</td>
                    <td><input class="stg-input" type="number" min="1" max="120" value="${r.duration_min}"></td>
                    <td><button class="stg-save-btn">저장</button></td>
                </tr>`).join('')}
            </tbody>
        </table>
        <div class="stg-section-title stg-section-sep">웨이포인트 체인</div>
        <table class="stg-table">
            <thead><tr><th>출발점</th><th>도착점</th><th>비행시간(분)</th><th></th></tr></thead>
            <tbody>
                ${waypoints.map(r => `
                <tr data-type="wp" data-from="${r.from_wp}" data-to="${r.to_wp}">
                    <td class="stg-label">${r.from_wp}</td>
                    <td class="stg-label stg-wp">${r.to_wp}</td>
                    <td><input class="stg-input" type="number" min="1" max="120" value="${r.duration_min}"></td>
                    <td><button class="stg-save-btn">저장</button></td>
                </tr>`).join('')}
            </tbody>
        </table>`;

        // ── 탭2: 출발간격 ──────────────────────────────────────
        const pInterval = document.createElement('div');
        pInterval.id = 'stg-pane-interval';
        pInterval.className = 'stg-pane hidden';
        pInterval.innerHTML = `
        <div class="stg-section-title">공항별 최소 출발 간격</div>
        <table class="stg-table">
            <thead><tr><th>공항</th><th>합류점</th><th>출발간격(분)</th><th></th></tr></thead>
            <tbody>
                ${airports.map(r => `
                <tr data-type="apt" data-icao="${r.icao}">
                    <td class="stg-label">${r.icao} <span class="stg-nameko">${r.name_ko || ''}</span></td>
                    <td class="stg-label stg-wp">${r.merge_point}</td>
                    <td><input class="stg-input" type="number" min="1" max="60" value="${r.dep_interval}"></td>
                    <td><button class="stg-save-btn">저장</button></td>
                </tr>`).join('')}
            </tbody>
        </table>`;

        // ── 탭3: 분리간격 ──────────────────────────────────────
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

        wrap.append(pTiming, pInterval, pSep);
        this._bindSaveButtons(wrap);
        return wrap;
    }

    _bindSaveButtons(wrap) {
        wrap.querySelectorAll('tr[data-type]').forEach(row => {
            const btn = row.querySelector('.stg-save-btn');
            const input = row.querySelector('.stg-input');

            const save = async () => {
                const val = parseInt(input.value, 10);
                if (!val || val < 1) {
                    input.classList.add('stg-input-error');
                    setTimeout(() => input.classList.remove('stg-input-error'), 1500);
                    return;
                }
                btn.disabled = true;
                try {
                    await this._save(row.dataset, val);
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
            input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
        });
    }

    async _save({ type, from, to, icao, wp }, value) {
        if (type === 'seg') {
            await apiPut('/api/v2/settings/segments', { from_icao: from, to_waypoint: to, duration_min: value });
        } else if (type === 'wp') {
            await apiPut('/api/v2/settings/waypoints', { from_wp: from, to_wp: to, duration_min: value });
        } else if (type === 'apt') {
            const row = document.querySelector(`tr[data-icao="${icao}"]`);
            const mergePoint = row?.querySelector('.stg-wp')?.textContent?.trim();
            await apiPut(`/api/v2/settings/airports/${icao}`, {
                dep_interval: value,
                merge_point: mergePoint,
                name_ko: row?.querySelector('.stg-nameko')?.textContent?.trim() || ''
            });
        } else if (type === 'zone') {
            await apiPut(`/api/v2/settings/conflict-zones/${wp}`, { separation_min: value });
        }
    }
}
