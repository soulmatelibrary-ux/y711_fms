/**
 * MiniMap — SVG 지리 뷰 (줌/패닝 지원)
 * 노드 좌표/경로 설정: src/config/miniMapGeo.js
 */
import {
    MAP_W as W, AIRPORT_COLOR, AIRPORT_BG, GEO, ROUTES, ROUTE_MAP,
    buildGeo, PX_PER_MIN, TOP_Y, ROUTE_TOTAL_MIN,
} from '../config/miniMapGeo.js';
import { secToTime, formatDisplay, escapeHtml } from '../utils/timeUtils.js';

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

export class MiniMap {
    constructor(container, {
        onFlightSelect,
        zoomInId    = 'mm-zoom-in',
        zoomOutId   = 'mm-zoom-out',
        zoomResetId = 'mm-zoom-reset',
        zoomLabelId = 'mm-zoom-label',
        altitudeToggleId = '',
        getAirportFlights = null
    } = {}) {
        this.container = container;
        this.selectedId = null;
        this._selectedAirport = null;
        this._highlightPair = null; // [id1, id2] 두 항공편 하이라이트
        this.flights = [];
        this.conflicts = [];
        this.onFlightSelect = onFlightSelect || (() => {});
        this._simDots    = [];
        this._rawSimDots = []; // simulationBridge 원본(ppm=20 고정) — 이중 스케일링 방지
        this._zoomInId    = zoomInId;
        this._zoomOutId   = zoomOutId;
        this._zoomResetId = zoomResetId;
        this._zoomLabelId = zoomLabelId;
        this._altitudeToggleId = altitudeToggleId;
        this._getAirportFlightsFn = getAirportFlights;

        // 현재 px/분 스케일 (fitHeight 로 동적 조정)
        this._pxPerMin = PX_PER_MIN;
        this._geo = GEO; // buildGeo(this._pxPerMin)

        // 줌/패닝 상태
        this._zoomFactor = 1;
        this._panX = W / 2;
        this._panY = this._mapH() / 2;
        this._panning = false;
        this._panStart = null;
        this._altitudeView = false;

        this._render();
        this._attachZoomHandlers();

        // 컨테이너 크기 변화 감지 → 자동 높이 맞춤
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => this.fitHeight());
            this._resizeObserver.observe(this.container);
        }
    }

    /** 현재 스케일 기준 맵 총 높이 */
    _mapH() {
        return TOP_Y + ROUTE_TOTAL_MIN * this._pxPerMin + 60; // 하단 여백 60
    }

    /**
     * 컨테이너 높이에 맞게 px/분 스케일을 조정하고 재렌더링.
     * minPxPerMin / maxPxPerMin 범위 내에서만 조정.
     */
    fitHeight(minPxPerMin = 16, maxPxPerMin = 34) {
        const ch = this.container.clientHeight;
        if (ch < 100) return;
        const ppm = Math.max(minPxPerMin, Math.min(maxPxPerMin,
            Math.round((ch - TOP_Y - 60) / ROUTE_TOTAL_MIN)
        ));
        if (ppm === this._pxPerMin) return;
        const oldH = this._mapH();
        const ratioY = this._panY / oldH;
        this._pxPerMin = ppm;
        this._geo = buildGeo(ppm);
        this._panY = ratioY * this._mapH();
        this._clampPan();
        this._render();
    }

    setFlights(flights) { this.flights = flights; this._render(); }
    setConflicts(conflicts) { this.conflicts = conflicts; this._render(); }
    setSelected(id) {
        this.selectedId = id;
        this._highlightPair = null; // 단일 선택 시 쌍 하이라이트 해제
        // 항공편 선택 시 공항 하이라이트 덮어씌우기
        const f = this.flights.find(fl => fl.id === id);
        if (f) this._selectedAirport = f.dept;
        this._render();
    }

    /**
     * 두 항공편을 쌍으로 하이라이트 (분리간격 요약에서 사용)
     * @param {string} id1 - 첫 번째 항공편 ID
     * @param {string} id2 - 두 번째 항공편 ID
     */
    highlightPair(id1, id2) {
        this._highlightPair = id1 && id2 ? [id1, id2] : null;
        this.selectedId = null; // 쌍 하이라이트 시 단일 선택 해제
        this._render();
    }

    clearHighlight() {
        this._highlightPair = null;
        this._render();
    }

    zoomIn() {
        this._zoomFactor = Math.min(ZOOM_MAX, this._zoomFactor * 1.5);
        this._clampPan();
        this._render();
        this._updateZoomLabel();
    }

    zoomOut() {
        this._zoomFactor = Math.max(ZOOM_MIN, this._zoomFactor / 1.5);
        if (this._zoomFactor === ZOOM_MIN) { this._panX = W / 2; this._panY = this._mapH() / 2; }
        this._clampPan();
        this._render();
        this._updateZoomLabel();
    }

    resetZoom() {
        this._zoomFactor = ZOOM_MIN;
        this._panX = W / 2;
        this._panY = this._mapH() / 2;
        this._render();
        this._updateZoomLabel();
    }

    _zoom() { return this._zoomFactor; }

    _getViewBox() {
        const H = this._mapH();
        const z = this._zoom();
        const vw = W / z;
        const vh = H / z;
        return `${this._panX - vw / 2} ${this._panY - vh / 2} ${vw} ${vh}`;
    }

    _clampPan() {
        const H = this._mapH();
        const z = this._zoom();
        const hw = W / z / 2;
        const hh = H / z / 2;
        this._panX = Math.max(hw, Math.min(W - hw, this._panX));
        this._panY = Math.max(hh, Math.min(H - hh, this._panY));
    }

    _updateZoomLabel() {
        const lbl = document.getElementById(this._zoomLabelId);
        if (!lbl) return;
        const z = this._zoomFactor;
        lbl.textContent = z === 1 ? '1×' : `${z.toFixed(1)}×`;
    }

    _updateAltitudeButton() {
        const btn = document.getElementById(this._altitudeToggleId);
        if (!btn) return;
        btn.classList.toggle('active', this._altitudeView);
        btn.title = this._altitudeView ? '지리 뷰로 전환' : '고도기반 뷰 토글';
    }

    setAltitudeView(active) {
        this._altitudeView = !!active;
        this._render();
        this._updateAltitudeButton();
    }

    toggleAltitudeView() {
        this.setAltitudeView(!this._altitudeView);
    }

    _altitudeToX(altitudeFt = 0) {
        const minX = 74;
        const maxX = W - 30;
        const clamped = Math.max(0, Math.min(35000, altitudeFt || 0));
        return minX + (clamped / 35000) * (maxX - minX);
    }

    setSimPositions(dots) {
        // simulationBridge 원본(ppm=20 고정)을 보관 — _render() 재호출 시 이중 스케일링 방지
        this._rawSimDots = dots || [];
        // 현재 _pxPerMin 스케일로 y 변환
        const scale = this._pxPerMin / PX_PER_MIN;
        this._simDots = this._rawSimDots.map(d =>
            scale === 1 ? d : { ...d, y: TOP_Y + (d.y - TOP_Y) * scale }
        );
        const svg = this.container.querySelector('svg');
        if (!svg) return;
        let layer = svg.querySelector('.mm-sim-layer');
        if (!layer) {
            layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            layer.classList.add('mm-sim-layer');
            svg.appendChild(layer);
        }

        // 수직 분리선 (항공기 아래 레이어에 먼저 그림)
        const sepSvg = !this._altitudeView ? this._buildSimSepSvg() : '';

        // 항공기 dot + 콜사인
        const dotSvg = this._simDots.map(d => {
            const x = this._altitudeView ? this._altitudeToX(d.altitudeFt) : d.x;
            const fl = Math.round((d.altitudeFt || 0) / 100);
            const flLabel = this._altitudeView ? ` · FL${String(fl).padStart(3, '0')}` : '';
            const cx = x.toFixed(1), cy = d.y.toFixed(1);

            if (d.isTarget) {
                // SIM 대상 출발 항공기: 상향 삼각형 + 링
                const sz = 7;
                return `
                <circle cx="${cx}" cy="${cy}" r="11"
                    fill="none" stroke="${d.color}" stroke-width="1.5" opacity="0.4"/>
                <polygon points="${cx},${(d.y - sz).toFixed(1)} ${(x + sz).toFixed(1)},${(d.y + sz).toFixed(1)} ${(x - sz).toFixed(1)},${(d.y + sz).toFixed(1)}"
                    fill="${d.color}" stroke="#fff" stroke-width="1.5" opacity="0.97">
                    <title>▲ DEP ${escapeHtml(d.callsign)}${flLabel}</title>
                </polygon>
                <text x="${(x + 10).toFixed(1)}" y="${(d.y + 4).toFixed(1)}"
                    fill="${d.color}" font-size="10" font-family="monospace" font-weight="bold">▲ ${escapeHtml(d.callsign)}</text>
                `;
            } else if (d.isAtd) {
                // ATD 확정 항공기: 초록 원 (이미 출발, 비행 중)
                return `
                <circle cx="${cx}" cy="${cy}" r="5"
                    fill="#34c759" opacity="0.88" stroke="#fff" stroke-width="1">
                    <title>${escapeHtml(d.callsign)} (ATD 출발)${flLabel}</title>
                </circle>
                <text x="${(x + 7).toFixed(1)}" y="${(d.y + 4).toFixed(1)}"
                    fill="#34c759" font-size="10" font-family="monospace" font-weight="bold">${escapeHtml(d.callsign)}</text>
                `;
            } else {
                return `
                <circle cx="${cx}" cy="${cy}" r="5"
                    fill="${d.color}" opacity="0.92" stroke="#fff" stroke-width="1.2">
                    <title>${escapeHtml(d.callsign)}${flLabel}</title>
                </circle>
                <text x="${(x + 7).toFixed(1)}" y="${(d.y + 4).toFixed(1)}"
                    fill="${d.color}" font-size="10" font-family="monospace" font-weight="bold">${escapeHtml(d.callsign)}</text>
                `;
            }
        }).join('');

        layer.innerHTML = sepSvg + dotSvg;
    }

    clearSimPositions() {
        this._simDots    = [];
        this._rawSimDots = [];
        const layer = this.container.querySelector('.mm-sim-layer');
        if (layer) layer.innerHTML = '';
    }

    _render() {
        const activeApt = this._getActiveAirport();
        const nodeSz = this._zoomFactor >= 2 ? 1.5 : 1; // 줌 시 노드 크기 비율

        const H = this._mapH();
        const geo = this._geo;
        const svgContent = `<svg viewBox="${this._getViewBox()}" xmlns="http://www.w3.org/2000/svg"
            style="width:100%;height:100%;cursor:${this._zoomFactor > 1 ? 'grab' : 'default'};display:block">
            <rect x="0" y="0" width="${W}" height="${H}" fill="#0d1117"/>
            ${this._altitudeView ? this._drawAltitudeOverlay() : ''}

            ${ROUTES.map(([a, b]) => {
                const p1 = geo[a], p2 = geo[b];
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

            ${Object.entries(geo).map(([id, p]) => {
                const isConflict = this._isConflict(id);
                if (p.type === 'airport') {
                    const ac = AIRPORT_COLOR[id] || '#4fc3f7';
                    const ab = AIRPORT_BG[id] || '#1e4a7a';
                    const r = 9 * nodeSz;
                    const tx = p.side === 'left' ? p.x - r - 2 : p.x + r + 2;
                    const anchor = p.side === 'left' ? 'end' : 'start';
                    const flightsHere = this._getAirportFlights(id);
                    const tip = flightsHere.length ? `${id}: ${flightsHere.map(f => escapeHtml(f.callsign)).join(', ')}` : id;
                    const badge = flightsHere.length > 0 ? `
                        <circle cx="${p.x + (p.side === 'left' ? r - 2 : -(r - 2))}" cy="${p.y - r + 2}" r="6"
                            fill="${ac}" opacity="0.9"/>
                        <text x="${p.x + (p.side === 'left' ? r - 2 : -(r - 2))}" y="${p.y - r + 6}"
                            text-anchor="middle" fill="#000" font-size="12" font-weight="bold">${flightsHere.length}</text>
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
                    const labelDx = Number.isFinite(p.labelDx) ? p.labelDx : (sz + 4);
                    const labelDy = Number.isFinite(p.labelDy) ? p.labelDy : 4;
                    const flightsHere = this.flights.filter(f =>
                        (f.routeWaypoints || []).some(w => w.name === id)
                    );
                    const tip = isConflict ? `⚠ 충돌: ${id}` : `${id} — ${flightsHere.map(f => escapeHtml(f.callsign)).join(', ') || '없음'}`;
                    return `<g class="mm-wp" data-wp="${id}" style="cursor:${flightsHere.length ? 'pointer' : 'default'}">
                        <polygon points="${p.x},${p.y - sz} ${p.x + sz},${p.y} ${p.x},${p.y + sz} ${p.x - sz},${p.y}"
                            fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
                        <text x="${p.x + labelDx}" y="${p.y + labelDy}" fill="${fill}" font-size="10" font-family="monospace" font-weight="bold">${p.label}</text>
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
            ${this._drawHighlightPair()}
            ${this._drawWaypointTimes()}
            ${this._zoomFactor <= 1 ? this._drawLegend() : ''}
        </svg>`;

        this.container.innerHTML = svgContent;
        this._attachClickHandlers();
        this._attachWheelAndPan();
        this._updateAltitudeButton();
        // 시뮬레이션 레이어 복원: innerHTML 교체 후 sim 점이 사라지지 않도록 (원본으로 재스케일)
        if (this._rawSimDots.length) this.setSimPositions(this._rawSimDots);
    }

    _drawAltitudeOverlay() {
        const H = this._mapH();
        const lanes = [0, 100, 200, 300, 350];
        const laneLines = lanes.map(fl => {
            const x = this._altitudeToX(fl * 100);
            return `
                <line x1="${x}" y1="22" x2="${x}" y2="${H - 18}" stroke="rgba(255,215,0,0.16)" stroke-width="0.8" stroke-dasharray="3,3"/>
                <text x="${x}" y="15" text-anchor="middle" fill="rgba(255,215,0,0.8)" font-size="8" font-family="monospace">FL${String(fl).padStart(3, '0')}</text>
            `;
        }).join('');

        return `
            <g class="mm-alt-overlay">
                <rect x="8" y="8" width="94" height="14" rx="4" fill="rgba(255,215,0,0.08)" stroke="rgba(255,215,0,0.28)"/>
                <text x="55" y="18" text-anchor="middle" fill="#ffe08a" font-size="8" font-family="monospace" font-weight="bold">ALTITUDE VIEW</text>
                ${laneLines}
            </g>`;
    }

    _drawLegend() {
        const lx = W - 90, ly = 8;
        return `<g font-size="8" font-family="sans-serif">
            <rect x="${lx - 4}" y="${ly}" width="88" height="100" fill="rgba(7,13,24,0.85)" rx="4"/>
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
            <polygon points="${lx+5},${ly+76} ${lx+9},${ly+83} ${lx+1},${ly+83}" fill="#4fc3f7" stroke="#fff" stroke-width="1"/>
            <text x="${lx + 14}" y="${ly + 83}" fill="#7a8a9a">SIM 출발 항공기</text>
            <circle cx="${lx + 5}" cy="${ly + 93}" r="4" fill="#34c759" stroke="#fff" stroke-width="1"/>
            <text x="${lx + 14}" y="${ly + 97}" fill="#7a8a9a">ATD 출발 항공기</text>
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
                const f = this._getAirportFlights(icao)[0];
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
            const H = this._mapH();
            const rect = svg.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            // 클릭 위치를 SVG 좌표로 변환
            const z = this._zoom();
            const vw = W / z, vh = H / z;
            const svgX = this._panX - vw / 2 + (mx / rect.width) * vw;
            const svgY = this._panY - vh / 2 + (my / rect.height) * vh;

            const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
            this._zoomFactor = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * factor));

            if (this._zoomFactor <= ZOOM_MIN) {
                this._zoomFactor = ZOOM_MIN;
                this._panX = W / 2;
                this._panY = H / 2;
            } else {
                // 줌 후 커서 위치가 같은 지점을 가리키도록 패닝 조정
                const nz = this._zoomFactor;
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
            if (e.button !== 0) return;
            if (this._zoomFactor <= ZOOM_MIN) return;
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
            const vw = W / z, vh = this._mapH() / z;
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
            if (s) s.style.cursor = this._zoomFactor > 1 ? 'grab' : 'default';
        };

        svg.addEventListener('mousemove', onMove);
        svg.addEventListener('mouseup', onUp);
        svg.addEventListener('mouseleave', onUp);
    }

    _attachZoomHandlers() {
        // 외부 버튼 (main.js 렌더링)에 연결 — 인스턴스별 ID 사용
        document.addEventListener('click', (e) => {
            if (e.target.id === this._zoomInId)    this.zoomIn();
            if (e.target.id === this._zoomOutId)   this.zoomOut();
            if (e.target.id === this._zoomResetId) this.resetZoom();
            if (this._altitudeToggleId && e.target.id === this._altitudeToggleId) this.toggleAltitudeView();
        });
        this._updateAltitudeButton();
    }

    _getActiveAirport() {
        if (this.selectedId) {
            const f = this.flights.find(fl => fl.id === this.selectedId);
            if (f) return f.dept;
        }
        return this._selectedAirport || null;
    }

    _getAirportFlights(icao) {
        if (typeof this._getAirportFlightsFn === 'function') {
            const arr = this._getAirportFlightsFn(icao);
            return Array.isArray(arr) ? arr : [];
        }
        return this.flights.filter(f => f.dept === icao && f.status !== 'DEP');
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
        const deptGeo = this._geo[f.dept];
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
            const geo = this._geo[wp.name];
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

    /** 시뮬레이션 항공기 간 수직 분리선 — 청주 오른쪽 고정 컬럼(x=300)
     *  선 길이 = diffMin * pxPerMin (레이블과 항상 일치)
     *  선 중심 = 두 항공기 y 중점 (동적 이동) */
    _buildSimSepSvg() {
        if (this._simDots.length < 2) return '';
        const SEP_X = 300;
        const sorted = [...this._simDots].sort((a, b) => a.y - b.y);
        const out = [];

        const SPINE_X = 152;
        // MANGI 이후에는 모든 출발지 경로가 동일 속도(20px/min) → 교차 출발지 비교 허용
        const mangiY = this._geo.MANGI.y;

        for (let i = 1; i < sorted.length; i++) {
            const above = sorted[i - 1];
            const below = sorted[i];
            if (Math.abs(above.x - SPINE_X) > 22 || Math.abs(below.x - SPINE_X) > 22) continue;
            if (below.y - above.y > 20 * this._pxPerMin) continue;

            // 다른 출발지 쌍은 MANGI 이후만 비교 (JNKR~MANGI 구간은 출발지별 속도 상이)
            const fA = this.flights.find(f => f.callsign === above.callsign);
            const fB = this.flights.find(f => f.callsign === below.callsign);
            if (!fA || !fB) continue;
            if (fA.dept !== fB.dept && above.y < mangiY) continue;

            // 교차 출발지 쌍은 MANGI 이후 구간에서만 비교하므로, MANGI부터 탐색
            const crossOrigin = fA.dept !== fB.dept;
            const timeSep = this._getTimeSepBetween(
                above.callsign, below.callsign, crossOrigin ? 'MANGI' : null
            );
            if (timeSep === null || timeSep > 3600) continue;

            const diffMin = Math.round(timeSep / 60);
            const isConflict = timeSep < 5 * 60;
            const isWarn     = timeSep < 8 * 60;
            const color = isConflict ? '#ff3b30' : (isWarn ? '#ff9500' : '#4caf50');

            // 선 끝점 = 실제 항공기 y 위치 (GEO가 시간 비례이므로 선 길이 ≈ diffMin * ppm)
            const topY = above.y + 5;
            const botY = below.y - 5;
            if (botY - topY < 4) continue;
            const midY = (above.y + below.y) / 2;

            out.push(`<g opacity="0.88">
                <line x1="${SEP_X}" y1="${topY.toFixed(1)}" x2="${SEP_X}" y2="${botY.toFixed(1)}"
                    stroke="${color}" stroke-width="1" stroke-dasharray="3,3"/>
                <line x1="${SEP_X - 5}" y1="${topY.toFixed(1)}" x2="${SEP_X + 5}" y2="${topY.toFixed(1)}"
                    stroke="${color}" stroke-width="1.5"/>
                <line x1="${SEP_X - 5}" y1="${botY.toFixed(1)}" x2="${SEP_X + 5}" y2="${botY.toFixed(1)}"
                    stroke="${color}" stroke-width="1.5"/>
                <rect x="${SEP_X + 7}" y="${(midY - 8).toFixed(1)}" width="22" height="13"
                    rx="2" fill="rgba(13,17,23,0.88)"/>
                <text x="${SEP_X + 18}" y="${(midY + 3).toFixed(1)}" text-anchor="middle"
                    fill="${color}" font-size="9" font-family="monospace" font-weight="bold">${diffMin}분</text>
            </g>`);
        }
        return out.join('');
    }

    // startFrom: 이 웨이포인트 이후부터 비교 (교차 출발지 쌍이 MANGI 이후에 있을 때 사용)
    _getTimeSepBetween(callsignA, callsignB, startFrom = null) {
        const fA = this.flights.find(f => f.callsign === callsignA);
        const fB = this.flights.find(f => f.callsign === callsignB);
        if (!fA || !fB) return null;
        const wpsA = fA.routeWaypoints || [];
        const wpsB = fB.routeWaypoints || [];
        const CONV = ['MEKIL', 'JNKR', 'MANGI', 'DALSU', 'RKPC'];
        const startIdx = startFrom ? CONV.indexOf(startFrom) : 0;
        for (let i = Math.max(0, startIdx); i < CONV.length; i++) {
            const conv = CONV[i];
            const wA = wpsA.find(w => w.name === conv);
            const wB = wpsB.find(w => w.name === conv);
            if (wA && wB) {
                let d = Math.abs(wA.timeSec - wB.timeSec);
                if (d > 43200) d = 86400 - d;
                return d;
            }
        }
        return null;
    }

    _drawSelectedRoute() {
        const apt = this._getActiveAirport();
        if (!apt) return '';
        const ac = AIRPORT_COLOR[apt] || '#4fc3f7';
        const f = this.selectedId ? this.flights.find(fl => fl.id === this.selectedId) : null;
        const label = f ? `${escapeHtml(f.callsign)} ${escapeHtml(apt)}→RKPC` : `${escapeHtml(apt)}→RKPC`;
        return `<text x="10" y="${this._mapH() - 10}" fill="${ac}" font-size="10" font-family="monospace" font-weight="bold">${label}</text>`;
    }

    /**
     * 분리간격 요약에서 선택된 두 항공편 쌍 하이라이트
     */
    _drawHighlightPair() {
        if (!this._highlightPair || this._highlightPair.length !== 2) return '';
        const [id1, id2] = this._highlightPair;
        const f1 = this.flights.find(f => f.id === id1);
        const f2 = this.flights.find(f => f.id === id2);
        if (!f1 || !f2) return '';

        const geo = this._geo;
        const out = [];
        const colors = ['#ff9500', '#4fc3f7']; // 주황, 파랑

        [f1, f2].forEach((flight, idx) => {
            const wps = flight.routeWaypoints || [];
            const color = colors[idx];
            const apt = flight.dept;
            const aptColor = AIRPORT_COLOR[apt] || color;

            // 출발 공항 하이라이트 링
            if (geo[apt]) {
                const p = geo[apt];
                out.push(`<circle cx="${p.x}" cy="${p.y}" r="14" fill="none" stroke="${aptColor}" stroke-width="2" opacity="0.6">
                    <animate attributeName="r" values="14;18;14" dur="1.5s" repeatCount="indefinite"/>
                </circle>`);
            }

            // 각 합류점에 마커 표시
            wps.forEach(wp => {
                const p = geo[wp.name];
                if (p && (p.type === 'conv' || p.type === 'dest')) {
                    const sz = 10;
                    out.push(`<circle cx="${p.x}" cy="${p.y}" r="${sz}" fill="none" stroke="${color}" stroke-width="2.5" opacity="0.8">
                        <animate attributeName="opacity" values="0.8;0.4;0.8" dur="1s" repeatCount="indefinite"/>
                    </circle>`);
                }
            });
        });

        // 레이블 표시
        const label = `${escapeHtml(f1.callsign)} vs ${escapeHtml(f2.callsign)}`;
        out.push(`<rect x="8" y="${this._mapH() - 36}" width="${label.length * 6.5 + 16}" height="18" rx="4" fill="rgba(255,149,0,0.2)" stroke="#ff9500"/>`);
        out.push(`<text x="16" y="${this._mapH() - 22}" fill="#ff9500" font-size="11" font-family="monospace" font-weight="bold">${label}</text>`);

        return out.join('');
    }
}
