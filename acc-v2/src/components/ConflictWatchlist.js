/**
 * ConflictWatchlist — 충돌 처리 대기열 패널
 * Tower Advisory 를 대체. 모든 활성 충돌을 카드로 나열하며
 * Resolve / Ack / × 액션을 제공한다.
 */

import { escapeHtml } from '../utils/timeUtils.js';

function conflictKey(c) {
    const [a, b] = [c.f1.callsign, c.f2.callsign].sort();
    return `${c.zone}|${a}|${b}`;
}

export class ConflictWatchlist {
    constructor(container, { onResolve, onSelect } = {}) {
        this.container = container;
        this.onResolve = onResolve || (() => {});
        this.onSelect = onSelect || (() => {});

        // items: Map<key, WatchItem>
        this.items = new Map();
        this.ackedKeys = new Set();
        this.dismissedKeys = new Set();
        this._filter = 'all';
        this._fadeTimers = new Map();

        this._render();
    }

    /**
     * atd:updated 마다 호출. conflicts[] 로 items 동기화.
     */
    update(conflicts) {
        const newKeys = new Set(conflicts.map(conflictKey));

        // 사라진 충돌 → resolved 마킹 + 5초 후 제거
        for (const [key, item] of this.items) {
            if (!newKeys.has(key) && item.state !== 'resolved') {
                item.state = 'resolved';
                item.resolvedAt = Date.now();
                if (this._fadeTimers.has(key)) clearTimeout(this._fadeTimers.get(key));
                this._fadeTimers.set(key, setTimeout(() => {
                    this.items.delete(key);
                    this._fadeTimers.delete(key);
                    this._render();
                }, 5000));
            }
        }

        // 새 충돌 추가 / 기존 충돌 업데이트
        for (const c of conflicts) {
            const key = conflictKey(c);
            if (this.items.has(key)) {
                // 기존 항목 conflict 객체만 갱신 (state 유지)
                const item = this.items.get(key);
                item.conflict = c;
                if (item.state === 'resolved') {
                    // 재출현: resolved 취소
                    item.state = this.ackedKeys.has(key) ? 'acked' : 'new';
                    item.resolvedAt = null;
                    if (this._fadeTimers.has(key)) {
                        clearTimeout(this._fadeTimers.get(key));
                        this._fadeTimers.delete(key);
                    }
                }
            } else {
                // 신규 — dismissedKeys 에 있어도 NEW 로 재출현 (닫음 ≠ 해결)
                this.dismissedKeys.delete(key);
                this.items.set(key, {
                    key,
                    conflict: c,
                    state: this.ackedKeys.has(key) ? 'acked' : 'new',
                    detectedAt: Date.now(),
                    resolvedAt: null
                });
            }
        }

        this._render();
    }

    focusFirst() {
        const first = this.container.querySelector('.wl-card:not(.resolved)');
        if (first) {
            first.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            first.focus();
        }
    }

    setFilter(f) {
        this._filter = f;
        this._render();
    }

    _visibleItems() {
        const all = [...this.items.values()];
        const f = this._filter;
        if (f === 'all') return all;
        if (f === 'unacked') return all.filter(i => i.state === 'new');
        if (f === 'critical') return all.filter(i => i.conflict.severity === 'critical' || !i.conflict.severity);
        if (f === 'warning') return all.filter(i => i.conflict.severity === 'warning');
        return all;
    }

    _render() {
        const visible = this._visibleItems();
        const activeCount = [...this.items.values()].filter(i => i.state !== 'resolved').length;

        // 헤더 (카운터 + 필터)
        const filterBtns = ['all', 'critical', 'unacked'].map(f => {
            const labels = { all: '모두', critical: 'CRITICAL', unacked: '미확인' };
            return `<button class="wl-filter-btn ${this._filter === f ? 'wl-filter-active' : ''}" data-filter="${f}">${labels[f]}</button>`;
        }).join('');

        const headerHtml = `
        <div class="wl-header-bar">
            <div class="wl-filter-group">${filterBtns}</div>
            <span class="wl-count">${activeCount}건</span>
        </div>`;

        if (!visible.length) {
            this.container.innerHTML = headerHtml +
                `<div class="wl-empty">충돌 없음 — NOW±30분 분리 충족</div>`;
        } else {
            const cards = visible.map(item => this._renderCard(item)).join('');
            this.container.innerHTML = headerHtml + cards;
        }

        // 헤더 필터 이벤트
        this.container.querySelectorAll('.wl-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => this.setFilter(btn.dataset.filter));
        });

        // 카드 이벤트
        this.container.querySelectorAll('.wl-card').forEach(card => {
            const key = card.dataset.key;
            const item = this.items.get(key);
            if (!item) return;

            // 카드 클릭 → 항공편 선택 (resolved 제외)
            card.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                if (item.state !== 'resolved') {
                    this.onSelect(item.conflict.f1.id);
                }
            });

            // Resolve
            card.querySelector('.btn-wl-resolve')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.onResolve(item.conflict);
            });

            // Ack
            card.querySelector('.btn-wl-ack')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (item.state === 'new') {
                    item.state = 'acked';
                    this.ackedKeys.add(key);
                    this._render();
                }
            });

            // Dismiss ×
            card.querySelector('.btn-wl-dismiss')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.dismissedKeys.add(key);
                this.items.delete(key);
                if (this._fadeTimers.has(key)) {
                    clearTimeout(this._fadeTimers.get(key));
                    this._fadeTimers.delete(key);
                }
                this._render();
            });
        });

        // 키보드 탐색 지원
        this._setupKeyboard();
    }

    _renderCard(item) {
        const { key, conflict: c, state } = item;
        const isCritical = !c.severity || c.severity === 'critical';
        const diffMin = Math.floor(c.timeDiffSec / 60);
        const diffSec = c.timeDiffSec % 60;
        const gapSec = c.requiredSec - c.timeDiffSec;
        const gapMin = Math.floor(Math.abs(gapSec) / 60);
        const gapSecRem = Math.abs(gapSec) % 60;

        const stateBadge = {
            new: '<span class="wl-badge wl-badge-new">NEW</span>',
            acked: '<span class="wl-badge wl-badge-acked">ACK</span>',
            resolved: '<span class="wl-badge wl-badge-resolved">RESOLVED</span>',
        }[state] || '';

        const actions = state !== 'resolved' ? `
        <div class="wl-actions">
            <button class="btn-wl-resolve">Resolve</button>
            ${state === 'new' ? '<button class="btn-wl-ack">Ack</button>' : ''}
            <button class="btn-wl-dismiss">×</button>
        </div>` : '';

        return `
        <div class="wl-card ${state}" data-key="${key}" tabindex="0">
            <div class="wl-card-top">
                <span class="wl-sev ${isCritical ? 'wl-sev-critical' : 'wl-sev-warning'}">●</span>
                <span class="wl-zone">${escapeHtml(c.zone)}</span>
                <span class="wl-callsigns">${escapeHtml(c.f1.callsign)} vs ${escapeHtml(c.f2.callsign)}</span>
                ${stateBadge}
            </div>
            <div class="wl-card-body">
                분리 ${diffMin}m ${diffSec}s &nbsp;/&nbsp; 필요 ${c.requiredSec / 60}m
                &nbsp;(Δ −${gapMin}m ${gapSecRem}s)
            </div>
            ${actions}
        </div>`;
    }

    _setupKeyboard() {
        const cards = [...this.container.querySelectorAll('.wl-card:not(.resolved)')];
        cards.forEach((card, idx) => {
            card.addEventListener('keydown', (e) => {
                if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    cards[idx + 1]?.focus();
                } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    cards[idx - 1]?.focus();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    card.querySelector('.btn-wl-resolve')?.click();
                } else if (e.key === ' ') {
                    e.preventDefault();
                    card.querySelector('.btn-wl-ack')?.click();
                }
            });
        });
    }
}
