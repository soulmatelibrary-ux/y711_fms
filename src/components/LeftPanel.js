/**
 * 왼쪽 패널 - 항공편 목록 및 CTOT 제어
 */

import { showToast } from '../utils/notifications.js';
import { getDatabase, queryFlights, updateFlightRecord, deleteFlightRecord } from '../utils/database.js';

export class LeftPanel {
    constructor() {
        this.allFlights = [];
        this.selectedFlightId = null;
        this.separationInterval = 180;
    }

    /**
     * 왼쪽 패널 HTML 생성
     */
    render() {
        return `
            <aside class="left-panel">
                <!-- 상단 제어 영역 -->
                <div style="display: flex; align-items: center; gap: 30px; margin-bottom: 20px; padding: 10px 15px; background: rgba(255,255,255,0.02); border-radius: 8px;">
                    <!-- 날짜 선택 -->
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase;">Date</span>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button id="prev-day-btn" class="btn btn-secondary" style="padding: 4px 8px; min-width: auto; background: transparent;">◀</button>
                            <input type="date" id="schedule-date" style="background: rgba(0,0,0,0.2); color: white; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: 4px; font-size: 0.85rem;">
                            <button id="next-day-btn" class="btn btn-secondary" style="padding: 4px 8px; min-width: auto; background: transparent;">▶</button>
                            <button id="today-btn" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.8rem; margin-left: 5px;">Today</button>
                        </div>
                    </div>

                    <!-- 겹침분리 설정 -->
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase;">겹침분리</span>
                        <select id="merge-point-select" style="background: rgba(0,0,0,0.2); color: white; border: 1px solid var(--border-color); padding: 4px 8px; border-radius: 4px; font-size: 0.85rem; min-width: 85px;">
                            <option value="3">3 min</option>
                            <option value="4">4 min</option>
                            <option value="5">5 min</option>
                            <option value="6">6 min</option>
                            <option value="7">7 min</option>
                            <option value="8">8 min</option>
                            <option value="9">9 min</option>
                            <option value="10">10 min</option>
                        </select>
                        <button id="reset-ctot-btn" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;" title="CTOT 초기화">새로 고침</button>
                    </div>
                </div>

                <!-- CTOT 색상 범례 -->
                <div class="ctot-legend">
                    <span class="legend-label">CTOT:</span>
                    <span class="legend-item delayed">지연</span>
                    <span class="legend-item early">앞당김</span>
                    <span class="legend-item manual">수동</span>
                    <span class="legend-item conflict">위반</span>
                </div>

                <!-- 항공편 테이블 헤더 -->
                <div class="flight-queue-header">
                    <span class="col-cs">Callsign</span>
                    <span class="col-dept">Dept</span>
                    <span class="col-dest">Dest</span>
                    <span class="col-cfl">CFL</span>
                    <span class="col-eobt">EOBT</span>
                    <span class="col-atd">ATD</span>
                    <span class="col-ctot">CTOT</span>
                </div>

                <!-- 항공편 목록 -->
                <div class="flight-queue-list" id="flight-queue">
                    <div class="queue-item placeholder">데이터가 없습니다. Excel을 업로드하세요.</div>
                </div>

                <!-- 하단 버튼 -->
                <div class="panel-footer">
                    <button id="calc-ctot-btn" class="btn btn-primary full-width">Refresh CTOT</button>
                </div>
            </aside>
        `;
    }

    /**
     * 왼쪽 패널 초기화 및 이벤트 바인딩
     */
    init() {
        this.bindEvents();
        this.loadFlights();
    }

    /**
     * 이벤트 바인딩
     */
    bindEvents() {
        document.getElementById('prev-day-btn')?.addEventListener('click', () => this.previousDay());
        document.getElementById('next-day-btn')?.addEventListener('click', () => this.nextDay());
        document.getElementById('today-btn')?.addEventListener('click', () => this.goToday());
        document.getElementById('schedule-date')?.addEventListener('change', (e) => this.dateChanged(e));
        document.getElementById('merge-point-select')?.addEventListener('change', (e) => this.mergePointChanged(e));
        document.getElementById('reset-ctot-btn')?.addEventListener('click', () => this.resetCTOT());
        document.getElementById('calc-ctot-btn')?.addEventListener('click', () => this.calculateCTOT());
    }

    /**
     * 항공편 로드
     */
    loadFlights() {
        const db = getDatabase();
        if (!db) {
            showToast('데이터베이스 초기화 실패', 'error');
            return;
        }

        const flights = queryFlights();
        this.allFlights = flights;
        this.renderFlightList();
    }

    /**
     * 항공편 목록 렌더링
     */
    renderFlightList() {
        const flightQueueDiv = document.getElementById('flight-queue');
        if (!flightQueueDiv) return;

        if (this.allFlights.length === 0) {
            flightQueueDiv.innerHTML = '<div class="queue-item placeholder">데이터가 없습니다. Excel을 업로드하세요.</div>';
            return;
        }

        flightQueueDiv.innerHTML = this.allFlights.map((flight, index) => `
            <div class="queue-item ${this.selectedFlightId === flight.id ? 'selected' : ''}" data-flight-id="${flight.id}">
                <span class="col-cs">${flight.callsign}</span>
                <span class="col-dept">${flight.dept}</span>
                <span class="col-dest">${flight.dest}</span>
                <span class="col-cfl">${flight.cfl}</span>
                <span class="col-eobt">${flight.eobt_utc}</span>
                <span class="col-atd">-</span>
                <span class="col-ctot" style="background: rgba(255, 204, 0, 0.3);">-</span>
            </div>
        `).join('');

        // 항공편 선택 이벤트
        flightQueueDiv.querySelectorAll('.queue-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const flightId = e.currentTarget.getAttribute('data-flight-id');
                this.selectFlight(flightId);
            });
        });
    }

    /**
     * 날짜 변경 (이전 날)
     */
    previousDay() {
        const dateInput = document.getElementById('schedule-date');
        if (dateInput) {
            const date = new Date(dateInput.value);
            date.setDate(date.getDate() - 1);
            dateInput.value = date.toISOString().split('T')[0];
            dateInput.dispatchEvent(new Event('change'));
        }
    }

    /**
     * 날짜 변경 (다음 날)
     */
    nextDay() {
        const dateInput = document.getElementById('schedule-date');
        if (dateInput) {
            const date = new Date(dateInput.value);
            date.setDate(date.getDate() + 1);
            dateInput.value = date.toISOString().split('T')[0];
            dateInput.dispatchEvent(new Event('change'));
        }
    }

    /**
     * 오늘로 이동
     */
    goToday() {
        const dateInput = document.getElementById('schedule-date');
        if (dateInput) {
            dateInput.value = new Date().toISOString().split('T')[0];
            dateInput.dispatchEvent(new Event('change'));
        }
    }

    /**
     * 날짜 변경 처리
     */
    dateChanged(e) {
        console.log('선택된 날짜:', e.target.value);
        this.loadFlights();
    }

    /**
     * 겹침분리 설정 변경
     */
    mergePointChanged(e) {
        this.separationInterval = parseInt(e.target.value) * 60; // Convert to seconds
        console.log('겹침분리 설정:', this.separationInterval, '초');
    }

    /**
     * CTOT 초기화
     */
    resetCTOT() {
        showToast('CTOT 초기화되었습니다', 'info');
        this.renderFlightList();
    }

    /**
     * 항공편 선택
     */
    selectFlight(flightId) {
        this.selectedFlightId = flightId;
        this.renderFlightList();
        console.log('선택된 항공편:', flightId);
    }

    /**
     * CTOT 계산
     */
    calculateCTOT() {
        console.log('CTOT 계산 중...');
        showToast('CTOT가 계산되었습니다', 'success');
    }

    /**
     * 데이터 업데이트
     */
    updateFlightData(flightId, data) {
        const db = getDatabase();
        if (!db) return false;

        const result = updateFlightRecord(flightId, null, data);
        if (result) {
            this.loadFlights();
            showToast('항공편이 수정되었습니다', 'success');
        }
        return result;
    }

    /**
     * 항공편 삭제
     */
    deleteFlight(flightId) {
        const db = getDatabase();
        if (!db) return false;

        if (!confirm('이 항공편을 삭제하시겠습니까?')) return false;

        const result = deleteFlightRecord(flightId, null);
        if (result) {
            this.loadFlights();
            showToast('항공편이 삭제되었습니다', 'success');
        }
        return result;
    }
}
