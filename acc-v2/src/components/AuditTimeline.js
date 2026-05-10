/**
 * AuditTimeline — 변경 이력 표시
 */
export class AuditTimeline {
    constructor(container, { onFlightSelect } = {}) {
        this.container = container;
        this.entries = [];
        this.onFlightSelect = onFlightSelect || null;
        this._render();
    }

    addEntry(entry) {
        this.entries = [entry, ...this.entries].slice(0, 50);
        this._render();
    }

    setEntries(entries) {
        this.entries = entries || [];
        this._render();
    }

    _render() {
        if (!this.entries.length) {
            this.container.innerHTML = `<div class="audit-empty">변경 이력 없음</div>`;
            return;
        }

        const csvBtn = `<button class="btn-audit-csv" title="CSV로 내보내기">↓ CSV</button>`;
        const rows = this.entries.map(e => {
            const diffsStr = (e.diffs || [])
                .map(d => `${d.callsign} ${d.prevCtot}→${d.newCtot}(${d.deltaMins > 0 ? '+' : ''}${d.deltaMins}m)`)
                .join(', ');
            const clickable = this.onFlightSelect ? 'audit-entry-click' : '';
            return `<div class="audit-entry ${clickable}" data-flight-id="${e.flightId || ''}">
                <span class="audit-time">${e.time || ''}</span>
                <span class="audit-cs">${e.callsign || ''}</span>
                <span class="audit-action">ATD ${e.newAtd || ''}Z</span>
                ${e.user ? `<span class="audit-user">@${e.user}</span>` : ''}
                ${diffsStr ? `<span class="audit-cascade">→ ${diffsStr}</span>` : ''}
            </div>`;
        }).join('');

        this.container.innerHTML = `
            <div class="audit-toolbar">${csvBtn}</div>
            <div class="audit-list">${rows}</div>`;

        this.container.querySelector('.btn-audit-csv')?.addEventListener('click', () => this._exportCsv());

        if (this.onFlightSelect) {
            this.container.querySelectorAll('.audit-entry-click').forEach(el => {
                el.addEventListener('click', () => {
                    const flightId = el.dataset.flightId;
                    if (flightId) this.onFlightSelect(flightId);
                });
            });
        }
    }

    _exportCsv() {
        const header = ['시각(UTC)', '콜사인', '신규ATD', '이전ATD', '사유', '변경자', '연쇄변경'];
        const rows = this.entries.map(e => {
            const diffs = (e.diffs || [])
                .map(d => `${d.callsign}:${d.prevCtot}->${d.newCtot}(${d.deltaMins > 0 ? '+' : ''}${d.deltaMins}m)`)
                .join(' | ');
            return [e.time || '', e.callsign || '', e.newAtd || '', e.prevAtd || '', e.reason || '', e.user || '', diffs];
        });
        const csv = [header, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
}
