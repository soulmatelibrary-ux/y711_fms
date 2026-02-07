/**
 * 오른쪽 패널 - Timeline + Live Route Map
 */

import { showToast } from '../utils/notifications.js';
import { getDatabase, queryFlights } from '../utils/database.js';

export class RightPanel {
    constructor() {
        this.simRunning = false;
        this.simSpeed = 1;
        this.simTimeSeconds = 0;
        this.flights = [];
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
                            <span class="legend-item"><i class="dot gmp"></i> RKSS</span>
                            <span class="legend-item"><i class="dot cjj"></i> RKTU</span>
                            <span class="legend-item"><i class="dot kuv"></i> RKJK</span>
                            <span class="legend-item"><i class="dot kwj"></i> RKJJ</span>
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
                            <g id="altitude-lanes"></g>
                            <g id="route-lines"></g>
                            <g id="merge-points"></g>
                            <g id="airport-labels"></g>
                            <g id="airport-callouts"></g>
                            <g id="aircraft-layer"></g>
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
    }

    /**
     * 이벤트 바인딩
     */
    bindEvents() {
        // Simulation controls
        document.getElementById('play-btn')?.addEventListener('click', () => this.playSim());
        document.getElementById('stop-btn')?.addEventListener('click', () => this.stopSim());
        document.getElementById('prev-btn')?.addEventListener('click', () => this.prevSim());
        document.getElementById('next-btn')?.addEventListener('click', () => this.nextSim());
        document.getElementById('speed-select')?.addEventListener('change', (e) => {
            this.simSpeed = parseInt(e.target.value);
        });

        // Full screen
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
        console.log(`✅ Loaded ${this.flights.length} flights`);
    }

    /**
     * Timeline 렌더링
     */
    renderTimeline() {
        const wrapper = document.getElementById('timelines-wrapper');
        if (!wrapper) return;

        // Clear existing flights from timeline
        wrapper.querySelectorAll('.flight-bar').forEach(el => el.remove());

        // Add flight bars to timeline
        this.flights.forEach(flight => {
            const track = wrapper.querySelector(`[data-airport="${flight.dept}"]`);
            if (!track) return;

            const bar = document.createElement('div');
            bar.className = 'flight-bar';
            bar.textContent = flight.callsign;
            bar.style.left = '10%'; // Placeholder position
            bar.style.width = '5%';

            track.appendChild(bar);
        });
    }

    /**
     * Map 렌더링
     */
    renderMap() {
        const svg = document.getElementById('flight-map-svg');
        if (!svg) return;

        // Clear previous drawings
        document.getElementById('aircraft-layer')?.innerHTML = '';

        // Draw flight paths and aircraft
        this.flights.forEach((flight, index) => {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', 100 + index * 50);
            circle.setAttribute('cy', 400);
            circle.setAttribute('r', '8');
            circle.setAttribute('fill', this.getAirportColor(flight.dept));

            document.getElementById('aircraft-layer')?.appendChild(circle);
        });

        // Draw airports
        this.drawAirports();
        this.drawWaypoints();
    }

    /**
     * 공항 그리기
     */
    drawAirports() {
        const airports = [
            { code: 'RKSS', name: '김포', x: 150, y: 400 },
            { code: 'RKTU', name: '청주', x: 300, y: 350 },
            { code: 'RKJK', name: '군산', x: 500, y: 450 },
            { code: 'RKJJ', name: '광주', x: 700, y: 500 },
            { code: 'RKPC', name: '제주', x: 1400, y: 450 }
        ];

        // 실제 구현에서는 SVG에 그림
        console.log('Airports drawn:', airports.length);
    }

    /**
     * 웨이포인트 그리기
     */
    drawWaypoints() {
        const waypoints = ['BULTI', 'MEKIL', 'GONAX', 'BEDES', 'ELPOS', 'MANGI', 'DALSU', 'NULDI', 'DOTOL'];

        // 실제 구현에서는 SVG에 그림
        console.log('Waypoints drawn:', waypoints.length);
    }

    /**
     * 공항별 색상
     */
    getAirportColor(airportCode) {
        const colors = {
            'RKSS': '#58a6ff',  // 김포 - 파란색
            'RKTU': '#bc8cff',  // 청주 - 보라색
            'RKJK': '#39c5bb',  // 군산 - 청록색
            'RKJJ': '#d29922'   // 광주 - 주황색
        };
        return colors[airportCode] || '#ffffff';
    }

    /**
     * 시뮬레이션 재생
     */
    playSim() {
        this.simRunning = true;
        console.log('🎬 Simulation started');
        this.updateSimulation();
    }

    /**
     * 시뮬레이션 중지
     */
    stopSim() {
        this.simRunning = false;
        this.simTimeSeconds = 0;
        this.updateSimClock();
        console.log('⏹ Simulation stopped');
    }

    /**
     * 시뮬레이션 이전
     */
    prevSim() {
        this.simTimeSeconds = Math.max(0, this.simTimeSeconds - 300);
        this.updateSimClock();
    }

    /**
     * 시뮬레이션 다음
     */
    nextSim() {
        this.simTimeSeconds += 300;
        this.updateSimClock();
    }

    /**
     * 시뮬레이션 업데이트
     */
    updateSimulation() {
        if (!this.simRunning) return;

        this.simTimeSeconds += this.simSpeed;
        this.updateSimClock();
        this.renderMap();

        requestAnimationFrame(() => this.updateSimulation());
    }

    /**
     * 시뮬레이션 시계 업데이트
     */
    updateSimClock() {
        const hours = Math.floor(this.simTimeSeconds / 3600);
        const minutes = Math.floor((this.simTimeSeconds % 3600) / 60);
        const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

        const clockEl = document.getElementById('sim-clock');
        if (clockEl) {
            clockEl.textContent = timeStr;
        }
    }

    /**
     * 전체 화면 전환
     */
    toggleFullscreen() {
        const rightPanel = document.querySelector('.right-panel');
        if (!rightPanel) return;

        rightPanel.classList.toggle('fullscreen');
        console.log('Fullscreen toggled');
    }
}
