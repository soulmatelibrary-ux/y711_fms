/**
 * MiniMap — SVG 지리 뷰 (줌/패닝 지원)
 * 노드 좌표/경로 설정: src/config/miniMapGeo.js
 */
import { MAP_W as W, MAP_H as H, AIRPORT_COLOR, AIRPORT_BG, GEO, ROUTES, ROUTE_MAP } from '../config/miniMapGeo.js';
import { secToTime, formatDisplay, escapeHtml } from '../utils/timeUtils.js';

const ZOOM_LEVELS = [1, 1.5, 2, 3, 4];

export class MiniMap {
    constructor(container, { onFlightSelect } = {}) {
        this.container = container;
        this.selectedId = null;
        this._selectedAirport = null; // 항공편 없어도 경로 하이라이트용
        this.flights = [];
        this.conflicts = [];
        this.onFlightSelect = onFlightSelect || (() => {});
        this._simDots = [];

        // 줌/패닝 상태
        this._zoomIdx = 0;       // ZOOM_LEVELS 인덱스
        this._panX = W / 2;     // 뷰 중심 x
        this._panY = H / 2;     // 뷰 중심 y
        this._panning = false;
        this._panStart = null;

        this._render();
        this._attachZoomHandlers();
    }

    setFlights(flights) { this.flights = flights; this._render(); }
    setConflicts(conflicts) { this.conflicts = conflicts; this._render(); }
    setSelected(id) {
        this.selectedId = id;
        // 항공편 선택 시 공항 하이라이트 덮어씌우기
        const f = this.flights.find(fl => fl.id === id);
        if (f) this._selectedAirport = f.dept;
        this._render();
    }

    zoomIn() {
        if (this._zoomIdx < ZOOM_LEVELS.length - 1) {
            this._zoomIdx++;
            this._clampPan();
            this._render();
            this._updateZoomLabel();
        }
    }

    zoomOut() {
        if (this._zoomIdx > 0) {
            this._zoomIdx--;
            if (this._zoomIdx === 0) { this._panX = W / 2; this._panY = H / 2; }
            this._clampPan();
            this._render();
            this._updateZoomLabel();
        }
    }

    resetZoom() {
        this._zoomIdx = 0;
        this._panX = W / 2;
        this._panY = H / 2;
        this._render();
        this._updateZoomLabel();
    }

    _zoom() { return ZOOM_LEVELS[this._zoomIdx]; }

    _getViewBox() {
        const z = this._zoom();
        const vw = W / z;
        const vh = H / z;
        return `${this._panX - vw / 2} ${this._panY - vh / 2} ${vw} ${vh}`;
    }

    _clampPan() {
        const z = this._zoom();
        const hw = W / z / 2;
        const hh = H / z / 2;
        this._panX = Math.max(hw, Math.min(W - hw, this._panX));
        this._panY = Math.max(hh, Math.min(H - hh, this._panY));
    }

    _updateZoomLabel() {
        const lbl = document.getElementById('mm-zoom-label');
        if (lbl) lbl.textContent = `${this._zoom()}×`;
    }

    setSimPositions(dots) {
        this._simDots = dots || [];
        const svg = this.container.querySelector('svg');
        if (!svg) return;
        let layer = svg.querySelector('.mm-sim-layer');
        if (!layer) {
            layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            layer.classList.add('mm-sim-layer');
            svg.appendChild(layer);
        }
        layer.innerHTML = this._simDots.map(d => `
            <circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="5"
                fill="${d.color}" opacity="0.92" stroke="#fff" stroke-width="1.2">
                <title>${escapeHtml(d.callsign)}</title>
            </circle>
            <text x="${(d.x + 7).toFixed(1)}" y="${(d.y + 4).toFixed(1)}"
                fill="${d.color}" font-size="8" font-family="monospace">${escapeHtml(d.callsign)}</text>
        `).join('');
    }

    clearSimPositions() {
        this._simDots = [];
        const layer = this.container.querySelector('.mm-sim-layer');
        if (layer) layer.innerHTML = '';
    }

    _render() {
        const activeApt = this._getActiveAirport();
        const nodeSz = this._zoom() >= 2 ? 1.5 : 1; // 줌 시 노드 크기 비율

        const svgContent = `<svg viewBox="${this._getViewBox()}" xmlns="http://www.w3.org/2000/svg"
            style="width:100%;height:100%;cursor:default;display:block">
            <rect x="0" y="0" width="${W}" height="${H}" fill="#0d1117"/>

            ${ROUTES.map(([a, b]) => {
                const p1 = GEO[a], p2 = GEO[b];
                const isActive = this._isRouteActive(a, b);
                const hasConflict = this._routeHasConflict(b);
                const isBultiMekilSection =
                    (a === 'RKSS' && b === 'BULTI') ||
                    (a === 'BULTI' && b === 'MEKIL') ||
                    (a === 'RKTU' && b === 'MEKIL') ||
                    (a === 'MEKIL' && b === 'JNKR');
                const w = isActive ? 2.5 : (isBultiMekilSection ? 2 : 1.5);
                let color;
                if (hasConflict) color = '#ff3b30';
                else if (isActive) color = activeApt ? (AIRPORT_COLOR[activeApt] || '#4fc3f7') : '#4fc3f7';
                else color = isBultiMekilSection ? '#2f4a6b' : '#1e2a3a';
                return `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}"
                    stroke="${color}" stroke-width="${w}" stroke-dasharray="${isActive ? '' : '4,4'}"/>`;
            }).join('')}

            ${Object.entries(GEO).map(([id, p]) => {
                const isConflict = this._isConflict(id);
                if (p.type === 'airport') {
                    const ac = AIRPORT_COLOR[id] || '#4fc3f7';
                    const ab = AIRPORT_BG[id] || '#1e4a7a';
                    const r = 9 * nodeSz;
                    const tx = p.side === 'left' ? p.x - r - 2 : p.x + r + 2;
                    const anchor = p.side === 'left' ? 'end' : 'start';
                    const flightsHere = this.flights.filter(f => f.dept === id && f.status !== 'DEP');
                    const tip = flightsHere.length ? `${id}: ${flightsHere.map(f => escapeHtml(f.callsign)).join(', ')}` : id;
                    const badge = flightsHere.length > 0 ? `
                        <circle cx="${p.x + (p.side === 'left' ? r - 2 : -(r - 2))}" cy="${p.y - r + 2}" r="6"
                            fill="${ac}" opacity="0.9"/>
                        <text x="${p.x + (p.side === 'left' ? r - 2 : -(r - 2))}" y="${p.y - r + 6}"
                            text-anchor="middle" fill="#000" font-size="8" font-weight="bold">${flightsHere.length}</text>
                    ` : '';
                    return `<g class="mm-airport" data-icao="${id}" style="cursor:${flightsHere.length ? 'pointer' : 'default'}">
                        <circle cx="${p.x}" cy="${p.y}" r="${r + 3}" fill="transparent"/>
                        <circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${ab}" stroke="${ac}" stroke-width="2"/>
                        <text x="${tx}" y="${p.y + 4}" text-anchor="${anchor}" fill="${ac}" font-size="10" font-family="monospace" font-weight="bold">${id}</text>
                        <text x="${tx}" y="${p.y + 15}" text-anchor="${anchor}" fill="${ac}" font-size="9" font-family="sans-serif" opacity="0.8">${p.label}</text>
                        ${badge}
                        <title>${tip}</title>
                    </g>`;
                } else if (p.type === 'junction') {
                    // 합류점: 레이블 없는 소형 다이아몬드
                    const sz = 4 * nodeSz;
                    return `<g>
                        <polygon points="${p.x},${p.y - sz} ${p.x + sz},${p.y} ${p.x},${p.y + sz} ${p.x - sz},${p.y}"
                            fill="#3a4a5a" stroke="#4a5a6a" stroke-width="1"/>
                    </g>`;
                } else if (p.type === 'conv') {
                    const fill = isConflict ? '#ff3b30' : (id === 'BULTI' ? '#7a8a9a' : '#ce93d8');
                    const stroke = isConflict ? '#ff6b6b' : (id === 'BULTI' ? '#4a5568' : '#8b5cf6');
                    const sz = (id === 'BULTI' ? 5 : 7) * nodeSz;
                    const flightsHere = this.flights.filter(f =>
                        (f.routeWaypoints || []).some(w => w.name === id)
                    );
                    const tip = isConflict ? `⚠ 충돌: ${id}` : `${id} — ${flightsHere.map(f => escapeHtml(f.callsign)).join(', ') || '없음'}`;
                    return `<g class="mm-wp" data-wp="${id}" style="cursor:${flightsHere.length ? 'pointer' : 'default'}">
                        <polygon points="${p.x},${p.y - sz} ${p.x + sz},${p.y} ${p.x},${p.y + sz} ${p.x - sz},${p.y}"
                            fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
                        <text x="${p.x + sz + 4}" y="${p.y + 4}" fill="${fill}" font-size="10" font-family="monospace" font-weight="bold">${p.label}</text>
                        <title>${tip}</title>
                    </g>`;
                } else if (p.type === 'dest') {
                    const sz = 8 * nodeSz;
                    return `<g>
                        <rect x="${p.x - sz}" y="${p.y - sz}" width="${sz * 2}" height="${sz * 2}" fill="#1a3a1a" stroke="#34c759" stroke-width="2"/>
                        <text x="${p.x + sz + 4}" y="${p.y + 4}" fill="#34c759" font-size="10" font-family="monospace" font-weight="bold">${id}</text>
                        <text x="${p.x + sz + 4}" y="${p.y + 15}" fill="#34c759" font-size="9" font-family="sans-serif" opacity="0.8">${p.label}</text>
                    </g>`;
                }
                return '';
            }).join('')}

            ${this._drawSelectedRoute()}
            ${this._drawWaypointTimes()}
            ${this._zoom() === 1 ? this._drawLegend() : ''}
        </svg>`;

        this.container.innerHTML = svgContent;
        this._attachClickHandlers();
        this._attachWheelAndPan();
        // 시뮬레이션 레이어 복원: innerHTML 교체 후 sim 점이 사라지지 않도록
        if (this._simDots.length) this.setSimPositions(this._simDots);
    }

    _drawLegend() {
        const lx = W - 90, ly = 8;
        return `<g font-size="8" font-family="sans-serif">
            <rect x="${lx - 4}" y="${ly}" width="88" height="72" fill="rgba(7,13,24,0.85)" rx="4"/>
            <circle cx="${lx + 5}" cy="${ly + 10}" r="4" fill="#0d2040" stroke="#58a6ff" stroke-width="1.5"/>
            <text x="${lx + 14}" y="${ly + 14}" fill="#7a8a9a">공항 (색상별 구분)</text>
            <polygon points="${lx+5},${ly+21} ${lx+9},${ly+26} ${lx+5},${ly+31} ${lx+1},${ly+26}" fill="#ce93d8" stroke="#8b5cf6" stroke-width="1"/>
            <text x="${lx + 14}" y="${ly + 30}" fill="#7a8a9a">합류 웨이포인트</text>
            <polygon points="${lx+5},${ly+35} ${lx+9},${ly+40} ${lx+5},${ly+45} ${lx+1},${ly+40}" fill="#ff3b30" stroke="#ff6b6b" stroke-width="1"/>
            <text x="${lx + 14}" y="${ly + 44}" fill="#7a8a9a">충돌 웨이포인트</text>
            <line x1="${lx}" y1="${ly+54}" x2="${lx+10}" y2="${ly+54}" stroke="#4fc3f7" stroke-width="2"/>
            <text x="${lx + 14}" y="${ly + 58}" fill="#7a8a9a">선택 항공편 경로</text>
            <line x1="${lx}" y1="${ly+65}" x2="${lx+10}" y2="${ly+65}" stroke="#1e2a3a" stroke-width="1" stroke-dasharray="3,2"/>
            <text x="${lx + 14}" y="${ly + 69}" fill="#7a8a9a">비활성 경로</text>
        </g>`;
    }

    _attachClickHandlers() {
        this.container.querySelectorAll('.mm-airport').forEach(el => {
            el.addEventListener('click', () => {
                const icao = el.dataset.icao;
                // 항공편 유무와 무관하게 경로 하이라이트
                this._selectedAirport = icao;
                this.selectedId = null;
                this._render();
                // 해당 공항 미출발 첫 항공편이 있으면 선택 이벤트도 발생
                const f = this.flights.find(fl => fl.dept === icao && fl.status !== 'DEP');
                if (f) this.onFlightSelect(f);
            });
        });
        this.container.querySelectorAll('.mm-wp').forEach(el => {
            el.addEventListener('click', () => {
                const wp = el.dataset.wp;
                const f = this.flights.find(fl =>
                    (fl.routeWaypoints || []).some(w => w.name === wp) && fl.status !== 'DEP'
                );
                if (f) this.onFlightSelect(f);
            });
        });
    }

    _attachWheelAndPan() {
        const svg = this.container.querySelector('svg');
        if (!svg) return;

        // 마우스 휠 줌 (SVG 좌표 기준 중심 이동)
        svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = svg.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            // 클릭 위치를 SVG 좌표로 변환
            const z = this._zoom();
            const vw = W / z, vh = H / z;
            const svgX = this._panX - vw / 2 + (mx / rect.width) * vw;
            const svgY = this._panY - vh / 2 + (my / rect.height) * vh;

            if (e.deltaY < 0) {
                if (this._zoomIdx < ZOOM_LEVELS.length - 1) this._zoomIdx++;
            } else {
                if (this._zoomIdx > 0) this._zoomIdx--;
            }

            if (this._zoomIdx === 0) {
                this._panX = W / 2;
                this._panY = H / 2;
            } else {
                // 줌 후 커서 위치가 같은 지점을 가리키도록 패닝 조정
                const nz = this._zoom();
                const nvw = W / nz, nvh = H / nz;
                this._panX = svgX - (mx / rect.width - 0.5) * nvw;
                this._panY = svgY - (my / rect.height - 0.5) * nvh;
                this._clampPan();
            }

            this._render();
            this._updateZoomLabel();
        }, { passive: false });

        // 드래그 패닝
        svg.addEventListener('mousedown', (e) => {
            if (this._zoomIdx === 0) return;
            if (e.button !== 0) return;
            this._panning = true;
            this._panStart = {
                mx: e.clientX, my: e.clientY,
                px: this._panX, py: this._panY,
                rect: svg.getBoundingClientRect(),
            };
            svg.style.cursor = 'grabbing';
            e.preventDefault();
        });

        const onMove = (e) => {
            if (!this._panning || !this._panStart) return;
            const z = this._zoom();
            const vw = W / z, vh = H / z;
            const dx = (e.clientX - this._panStart.mx) / this._panStart.rect.width * vw;
            const dy = (e.clientY - this._panStart.my) / this._panStart.rect.height * vh;
            this._panX = this._panStart.px - dx;
            this._panY = this._panStart.py - dy;
            this._clampPan();
            this._render();
        };

        const onUp = () => {
            this._panning = false;
            this._panStart = null;
            const s = this.container.querySelector('svg');
            if (s) s.style.cursor = 'default';
        };

        svg.addEventListener('mousemove', onMove);
        svg.addEventListener('mouseup', onUp);
        svg.addEventListener('mouseleave', onUp);
    }

    _attachZoomHandlers() {
        // 외부 버튼 (main.js 렌더링)에 연결
        document.addEventListener('click', (e) => {
            if (e.target.id === 'mm-zoom-in') this.zoomIn();
            if (e.target.id === 'mm-zoom-out') this.zoomOut();
            if (e.target.id === 'mm-zoom-reset') this.resetZoom();
        });
    }

    _getActiveAirport() {
        if (this.selectedId) {
            const f = this.flights.find(fl => fl.id === this.selectedId);
            if (f) return f.dept;
        }
        return this._selectedAirport || null;
    }

    _isRouteActive(a, b) {
        const apt = this._getActiveAirport();
        if (!apt) return false;
        const route = ROUTE_MAP[apt] || [];
        const ai = route.indexOf(a), bi = route.indexOf(b);
        return ai >= 0 && bi >= 0 && bi === ai + 1;
    }

    _routeHasConflict(waypoint) {
        return this.conflicts.some(c => c.zone === waypoint);
    }

    _isConflict(waypoint) {
        return this.conflicts.some(c => c.zone === waypoint);
    }

    _drawWaypointTimes() {
        if (!this.selectedId) return '';
        const f = this.flights.find(fl => fl.id === this.selectedId);
        if (!f) return '';

        const wps = f.routeWaypoints || [];
        if (!wps.length && !f.ctot && !f.atd) return '';

        const ac = AIRPORT_COLOR[f.dept] || '#4fc3f7';
        const labels = [];

        // 출발 공항에 CTOT/ATD 표시
        const deptGeo = GEO[f.dept];
        if (deptGeo) {
            const t = f.atd || f.ctot;
            const display0 = formatDisplay(t);
            if (display0 !== '--:--') {
                const display = display0;
                const r = 9;
                const tx = deptGeo.side === 'left' ? deptGeo.x - r - 2 : deptGeo.x + r + 2;
                const anchor = deptGeo.side === 'left' ? 'end' : 'start';
                const lbl = f.atd ? `ATD ${display}` : `CTOT ${display}`;
                labels.push(`<text x="${tx}" y="${deptGeo.y + 28}" text-anchor="${anchor}"
                    fill="${ac}" font-size="9" font-family="monospace" font-weight="bold" opacity="0.95">${lbl}</text>`);
            }
        }

        // 각 웨이포인트 통과 시각 표시
        for (const wp of wps) {
            const geo = GEO[wp.name];
            if (!geo) continue;
            const display = formatDisplay(secToTime(wp.timeSec));

            if (geo.type === 'conv') {
                const sz = wp.name === 'BULTI' ? 5 : 7;
                labels.push(`<text x="${geo.x + sz + 4}" y="${geo.y + 16}"
                    fill="${ac}" font-size="9" font-family="monospace" opacity="0.95">${display}</text>`);
            } else if (geo.type === 'junction') {
                labels.push(`<text x="${geo.x + 8}" y="${geo.y + 4}"
                    fill="${ac}" font-size="9" font-family="monospace" opacity="0.95">${display}</text>`);
            } else if (geo.type === 'dest') {
                const sz = 8;
                labels.push(`<text x="${geo.x + sz + 4}" y="${geo.y + 26}"
                    fill="${ac}" font-size="9" font-family="monospace" opacity="0.95">ETA ${display}</text>`);
            }
        }

        return labels.join('');
    }

    _drawSelectedRoute() {
        const apt = this._getActiveAirport();
        if (!apt) return '';
        const ac = AIRPORT_COLOR[apt] || '#4fc3f7';
        // 항공편이 있으면 콜사인도 표시
        const f = this.selectedId ? this.flights.find(fl => fl.id === this.selectedId) : null;
        const label = f ? `${escapeHtml(f.callsign)} ${escapeHtml(apt)}→RKPC` : `${escapeHtml(apt)}→RKPC`;
        return `<text x="10" y="${H - 10}" fill="${ac}" font-size="10" font-family="monospace" font-weight="bold">${label}</text>`;
    }
}
