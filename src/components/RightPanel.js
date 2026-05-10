/**
 * 오른쪽 패널 - Timeline + Live Route Map
 */

import { showToast } from '../utils/notifications.js';
import { getDatabase, queryFlights } from '../utils/database.js';
import * as SimService from '../services/simulation.js';

export class RightPanel {
    constructor() {
        this.flights = [];
        this.simTimeSeconds = 0;
        this.timelineStartHour = 5;
        this.timelineEndHour = 24;
        this.selectedFlightId = null;
        this.separationInterval = 180; // 기본값: 3분
    }

    /**
     * 오른쪽 패널 HTML 생성
     */
    render() {
        return `
            <main class="right-panel">
                <!-- Timeline Section -->
                <section class="timeline-section glass-card">
                    <div class="card-header compact">
                        <h2>Time Flow</h2>
                        <div class="timeline-legend">
                            <span class="legend-item"><i class="dot" style="background: #58a6ff;"></i> RKSS</span>
                            <span class="legend-item"><i class="dot" style="background: #bc8cff;"></i> RKTU</span>
                            <span class="legend-item"><i class="dot" style="background: #39c5bb;"></i> RKJK</span>
                            <span class="legend-item"><i class="dot" style="background: #d29922;"></i> RKJJ</span>
                        </div>
                    </div>
                    <div class="timeline-scroll-area">
                        <div class="time-axis"></div>
                        <div id="timelines-wrapper">
                            <div class="airport-track" data-airport="RKSS">
                                <div class="airport-track-label">RKSS (김포)</div>
                            </div>
                            <div class="airport-track" data-airport="RKTU">
                                <div class="airport-track-label">RKTU (청주)</div>
                            </div>
                            <div class="airport-track" data-airport="RKJK">
                                <div class="airport-track-label">RKJK (군산)</div>
                            </div>
                            <div class="airport-track" data-airport="RKJJ">
                                <div class="airport-track-label">RKJJ (광주)</div>
                            </div>
                            <div class="current-time-marker" id="time-marker"></div>
                        </div>
                    </div>
                </section>

                <!-- Map Section -->
                <section class="map-section glass-card">
                    <div class="card-header compact">
                        <h2>Live Route Map</h2>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <button id="map-fullscreen-btn" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.8rem;">Full View</button>
                            <div id="sim-clock-container" style="display: flex; align-items: center; gap: 8px; background: rgba(0,0,0,0.4); padding: 4px 12px; border-radius: 20px; border: 1px solid var(--border-color);">
                                <span style="font-size: 0.7rem; color: var(--text-tertiary); text-transform: uppercase;">UTC</span>
                                <span id="sim-clock" style="font-family: 'Outfit'; color: var(--accent-cyan); font-weight: 600; font-size: 1.1rem;">00:00</span>
                            </div>
                            <div class="sim-controls-compact">
                                <button class="ctrl-btn" id="prev-btn">⏮</button>
                                <button class="ctrl-btn main" id="play-btn">▶</button>
                                <button class="ctrl-btn" id="stop-btn" title="Reset Simulation">⏹</button>
                                <button class="ctrl-btn" id="next-btn">⏭</button>
                                <select id="speed-select" class="speed-select">
                                    <option value="1">1x</option>
                                    <option value="2">2x</option>
                                    <option value="5">5x</option>
                                    <option value="10">10x</option>
                                    <option value="20">20x</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="map-container">
                        <svg id="flight-map-svg" viewBox="0 0 1600 850" preserveAspectRatio="none">
                            <defs>
                                <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                                    <polygon points="0 0, 10 3, 0 6" fill="#fff" />
                                </marker>
                            </defs>
                            <g id="altitude-lanes"></g>
                            <g id="route-lines"></g>
                            <g id="merge-points"></g>
                            <g id="airport-labels"></g>
                            <g id="aircraft-layer"></g>
                            <g id="separation-analysis"></g>
                        </svg>
                    </div>
                </section>
            </main>
        `;
    }

    /**
     * 오른쪽 패널 초기화 및 이벤트 바인딩
     */
    init() {
        this.bindEvents();
        this.loadFlights();
        this.renderTimeline();
        this.renderMap();

        // 시뮬레이션 업데이트 이벤트 수신
        window.addEventListener('simulation-update', (e) => this.onSimulationUpdate(e));

        // LeftPanel의 항공편 선택 이벤트 수신
        window.addEventListener('flight-selected', (e) => this.onFlightSelected(e));
    }

    /**
     * 이벤트 바인딩
     */
    bindEvents() {
        // 이전
        document.getElementById('prev-btn')?.addEventListener('click', () => {
            SimService.previousSimulation();
            this.updateMapAndTimeline();
        });

        // 재생/일시정지
        document.getElementById('play-btn')?.addEventListener('click', () => {
            if (SimService.isSimulationRunning()) {
                SimService.pauseSimulation();
            } else {
                SimService.startSimulation();
            }
            this.updatePlayButtonUI();
        });

        // 정지
        document.getElementById('stop-btn')?.addEventListener('click', () => {
            SimService.stopSimulation();
            this.updatePlayButtonUI();
            this.updateMapAndTimeline();
        });

        // 다음
        document.getElementById('next-btn')?.addEventListener('click', () => {
            SimService.nextSimulation();
            this.updateMapAndTimeline();
        });

        // 속도 변경
        document.getElementById('speed-select')?.addEventListener('change', (e) => {
            SimService.setSimulationSpeed(parseInt(e.target.value));
        });

        // 전체화면
        document.getElementById('map-fullscreen-btn')?.addEventListener('click', () => this.toggleFullscreen());
    }

    /**
     * 항공편 데이터 로드
     */
    loadFlights() {
        const db = getDatabase();
        if (!db) {
            this.flights = [];
            return;
        }

        this.flights = queryFlights();
        console.log(`✅ RightPanel loaded ${this.flights.length} flights`);
    }

    /**
     * Timeline 렌더링
     */
    renderTimeline() {
        const wrapper = document.getElementById('timelines-wrapper');
        if (!wrapper) return;

        // 기존 항공편 블록 제거
        wrapper.querySelectorAll('.flight-block').forEach(el => el.remove());

        if (this.flights.length === 0) return;

        const windowStartSec = this.timelineStartHour * 3600;
        const PX_PER_SEC = 1350 / 3600; // 픽셀 per 초

        this.flights.forEach(flight => {
            const track = wrapper.querySelector(`[data-airport="${flight.dept}"]`);
            if (!track) return;

            // CTOT 또는 EOBT 시간
            const timeVal = flight.ctot || flight.eobt_utc || flight.eobt || '0000';
            const startSec = this.timeToSec(timeVal);
            const left = (startSec - windowStartSec) * PX_PER_SEC;

            // 항공편 블록 생성
            const block = document.createElement('div');
            block.className = `flight-block ${this.selectedFlightId === flight.id ? 'selected' : ''}`;
            block.dataset.id = flight.id;
            block.style.left = `${left}px`;

            // 공항 색상
            const airportColors = {
                'RKSS': '#58a6ff',
                'RKTU': '#bc8cff',
                'RKJK': '#39c5bb',
                'RKJJ': '#d29922',
                'RKPC': '#ff6b6b'
            };
            const color = airportColors[flight.dept] || '#58a6ff';
            block.style.borderColor = color;
            block.style.background = `linear-gradient(to right, ${color}44, ${color}22)`;

            block.textContent = flight.callsign;

            // 클릭 이벤트
            block.addEventListener('click', () => {
                this.selectFlight(flight.id);
            });

            track.appendChild(block);
        });

        // 현재 시간 마커 업데이트
        this.updateTimeMarker();
    }

    /**
     * Map 렌더링 (공항, 웨이포인트, 경로)
     */
    renderMap() {
        const svg = document.getElementById('flight-map-svg');
        if (!svg) return;

        // 공항 그리기
        const airportLabelsGroup = document.getElementById('airport-labels');
        if (airportLabelsGroup) {
            airportLabelsGroup.innerHTML = '';

            const airports = [
                { code: 'RKSS', name: '김포', x: 150, y: 800, color: '#58a6ff' },
                { code: 'RKTU', name: '청주', x: 300, y: 750, color: '#bc8cff' },
                { code: 'RKJK', name: '군산', x: 500, y: 850, color: '#39c5bb' },
                { code: 'RKJJ', name: '광주', x: 700, y: 800, color: '#d29922' },
                { code: 'RKPC', name: '제주', x: 1400, y: 750, color: '#ff6b6b' }
            ];

            airports.forEach(apt => {
                // 공항 원
                const circle = SimService.createSvgEl('circle', {
                    cx: apt.x,
                    cy: apt.y,
                    r: '12',
                    fill: apt.color,
                    opacity: '0.7'
                });
                airportLabelsGroup.appendChild(circle);

                // 공항 코드
                const text = SimService.createSvgEl('text', {
                    x: apt.x,
                    y: apt.y + 25,
                    'text-anchor': 'middle',
                    fill: 'white',
                    'font-size': '10',
                    'font-weight': 'bold'
                });
                text.textContent = apt.code;
                airportLabelsGroup.appendChild(text);
            });
        }

        // 웨이포인트 그리기
        const mergePointsGroup = document.getElementById('merge-points');
        if (mergePointsGroup) {
            mergePointsGroup.innerHTML = '';

            const waypoints = [
                { name: 'BULTI', x: 250, y: 400 },
                { name: 'MEKIL', x: 350, y: 380 },
                { name: 'GONAX', x: 450, y: 420 },
                { name: 'BEDES', x: 550, y: 400 },
                { name: 'ELPOS', x: 650, y: 380 },
                { name: 'MANGI', x: 750, y: 400 },
                { name: 'DALSU', x: 850, y: 390 },
                { name: 'NULDI', x: 950, y: 410 },
                { name: 'DOTOL', x: 1050, y: 400 }
            ];

            waypoints.forEach(wp => {
                // 웨이포인트 마크
                const rect = SimService.createSvgEl('rect', {
                    x: wp.x - 4,
                    y: wp.y - 4,
                    width: '8',
                    height: '8',
                    fill: '#ffd700',
                    opacity: '0.6'
                });
                mergePointsGroup.appendChild(rect);

                // 웨이포인트 이름
                const text = SimService.createSvgEl('text', {
                    x: wp.x,
                    y: wp.y - 12,
                    'text-anchor': 'middle',
                    fill: '#ffd700',
                    'font-size': '9',
                    opacity: '0.8'
                });
                text.textContent = wp.name;
                mergePointsGroup.appendChild(text);
            });
        }

        // 경로 선 그리기
        const routeLinesGroup = document.getElementById('route-lines');
        if (routeLinesGroup) {
            routeLinesGroup.innerHTML = '';

            const legs = [
                { from: { x: 150, y: 800 }, to: { x: 250, y: 400 } }, // RKSS -> BULTI
                { from: { x: 250, y: 400 }, to: { x: 350, y: 380 } },  // BULTI -> MEKIL
                { from: { x: 350, y: 380 }, to: { x: 450, y: 420 } },  // MEKIL -> GONAX
                { from: { x: 450, y: 420 }, to: { x: 1400, y: 750 } }  // 직접 제주로
            ];

            legs.forEach(leg => {
                const line = SimService.createSvgEl('line', {
                    x1: leg.from.x,
                    y1: leg.from.y,
                    x2: leg.to.x,
                    y2: leg.to.y,
                    stroke: 'rgba(255, 255, 255, 0.2)',
                    'stroke-width': '1',
                    'stroke-dasharray': '5,5'
                });
                routeLinesGroup.appendChild(line);
            });
        }
    }

    /**
     * 항공편 위치 업데이트 및 맵 다시 그리기
     */
    updateFlightMap() {
        const aircraftLayer = document.getElementById('aircraft-layer');
        const separationLayer = document.getElementById('separation-analysis');

        if (!aircraftLayer || !separationLayer) return;

        aircraftLayer.innerHTML = '';
        separationLayer.innerHTML = '';

        const simTime = SimService.getSimulationTime();
        const isFullscreen = document.querySelector('.map-section')?.classList.contains('fullscreen');

        // 각 항공편의 위치 계산 및 그리기
        this.flights.forEach(flight => {
            if (!flight.ctot && !flight.eobt_utc && !flight.eobt) return;

            // 위치 계산
            const pos = SimService.calculateAircraftPosition(
                flight,
                flight.routeWaypoints || [],
                isFullscreen
            );

            // 위치 저장 (분리 분석용)
            flight.currentPos = pos;

            // 공항별 색상
            const airportColors = {
                'RKSS': '#58a6ff',
                'RKTU': '#bc8cff',
                'RKJK': '#39c5bb',
                'RKJJ': '#d29922',
                'RKPC': '#ff6b6b'
            };
            const color = airportColors[flight.dept] || '#58a6ff';

            // 항공기 그리기
            SimService.drawAircraft(aircraftLayer, flight, pos, color);
        });

        // 분리 분석 그리기
        SimService.drawSeparationAnalysis(separationLayer, this.flights, this.separationInterval);
    }

    /**
     * 타임라인 시간 마커 업데이트
     */
    updateTimeMarker() {
        const marker = document.getElementById('time-marker');
        if (!marker) return;

        const simTime = SimService.getSimulationTime();
        const windowStartSec = this.timelineStartHour * 3600;
        const PX_PER_SEC = 1350 / 3600;

        const left = (simTime - windowStartSec) * PX_PER_SEC;
        marker.style.left = `${Math.max(0, left)}px`;
    }

    /**
     * 시뮬레이션 시계 업데이트
     */
    updateSimulationClock() {
        const clockEl = document.getElementById('sim-clock');
        if (clockEl) {
            clockEl.textContent = SimService.getSimulationTimeString();
        }
    }

    /**
     * 맵과 타임라인 업데이트 (시뮬레이션 변경 시)
     */
    updateMapAndTimeline() {
        this.updateSimulationClock();
        this.updateTimeMarker();
        this.updateFlightMap();
    }

    /**
     * 시뮬레이션 업데이트 이벤트 핸들러
     */
    onSimulationUpdate(event) {
        this.updateMapAndTimeline();
    }

    /**
     * 항공편 선택 이벤트 핸들러
     */
    onFlightSelected(event) {
        const flightId = event.detail?.flightId;
        if (flightId) {
            this.selectFlight(flightId);
        }
    }

    /**
     * 항공편 선택
     */
    selectFlight(flightId) {
        this.selectedFlightId = flightId;

        // 타임라인 업데이트
        document.querySelectorAll('.flight-block').forEach(block => {
            block.classList.toggle('selected', block.dataset.id === flightId);
        });

        // 해당 블록을 뷰에 보이도록 스크롤
        const block = document.querySelector(`.flight-block[data-id="${flightId}"]`);
        if (block) {
            block.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
    }

    /**
     * 재생 버튼 UI 업데이트
     */
    updatePlayButtonUI() {
        const playBtn = document.getElementById('play-btn');
        if (playBtn) {
            playBtn.textContent = SimService.isSimulationRunning() ? '⏸' : '▶';
            playBtn.title = SimService.isSimulationRunning() ? 'Pause' : 'Play';
        }
    }

    /**
     * 전체 화면 토글
     */
    toggleFullscreen() {
        const mapSection = document.querySelector('.map-section');
        if (mapSection) {
            mapSection.classList.toggle('fullscreen');
            // 맵 재렌더링 (화면 크기 변경으로 인한)
            setTimeout(() => this.updateFlightMap(), 100);
        }
    }

    /**
     * 시간 문자열을 초로 변환 (헬퍼)
     */
    timeToSec(timeStr) {
        if (!timeStr) return 0;

        // "HHMM" 형식
        if (/^\d{4}$/.test(timeStr)) {
            const h = parseInt(timeStr.substring(0, 2));
            const m = parseInt(timeStr.substring(2, 4));
            return h * 3600 + m * 60;
        }

        // "HH:MM" 형식
        const parts = timeStr.split(':');
        if (parts.length === 2) {
            const h = parseInt(parts[0]);
            const m = parseInt(parts[1]);
            return h * 3600 + m * 60;
        }

        return 0;
    }

    /**
     * 분리 기준 업데이트 (LeftPanel에서 호출)
     */
    setSeparationInterval(minutes) {
        this.separationInterval = minutes * 60;
        this.updateFlightMap();
    }
}
