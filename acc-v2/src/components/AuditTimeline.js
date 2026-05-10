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
            const type = e.eventType || (e.newAtd ? 'atd_set' : 'ctot_adjust');
            const typeLabel = type === 'conflict_resolve' ? '충돌해결'
                : type === 'ctot_adjust' ? '수동조정' : '';
            const actionText = type === 'atd_set'
                ? `ATD ${e.newAtd || ''}Z${e.prevAtd ? ` ← ${e.prevAtd}Z` : ''}`
                : `CTOT ${e.newCtot || ''}Z${e.prevCtot ? ` ← ${e.prevCtot}Z` : ''}`;
            return `<div class="audit-entry audit-type-${type} ${clickable}" data-flight-id="${e.flightId || ''}">
                <span class="audit-dot"></span>
                <span class="audit-time">${e.time || ''}</span>
                <span class="audit-cs">${e.callsign || ''}</span>
                <span class="audit-action">${actionText}</span>
                ${typeLabel ? `<span class="audit-type-label">(${typeLabel})</span>` : ''}
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
        const header = ['시각(UTC)', '이벤트유형', '콜사인', '이전값', '신규값', '사유', '연쇄변경'];
        const rows = this.entries.map(e => {
            const type = e.eventType || (e.newAtd ? 'atd_set' : 'ctot_adjust');
            const prevVal = type === 'atd_set' ? (e.prevAtd || '') : (e.prevCtot || '');
            const newVal  = type === 'atd_set' ? (e.newAtd || '')  : (e.newCtot || '');
            const diffs = (e.diffs || [])
                .map(d => `${d.callsign}:${d.prevCtot}->${d.newCtot}(${d.deltaMins > 0 ? '+' : ''}${d.deltaMins}m)`)
                .join(' | ');
            return [e.time || '', type, e.callsign || '', prevVal, newVal, e.reason || '', diffs];
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
