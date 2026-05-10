/**
 * 왼쪽 패널 - 항공편 목록 및 CTOT 제어
 */

import { showToast } from '../utils/notifications.js';
import { getDatabase, queryFlights, updateFlightRecord, deleteFlightRecord } from '../utils/database.js';
import { getCtotStatus, validateTime, timeStringToSeconds } from '../utils/helpers.js';

export class LeftPanel {
    constructor() {
        this.allFlights = [];
        this.selectedFlightId = null;
        this.referenceFlightId = null;
        this.separationInterval = 180; // 기본값: 3분 (초 단위)
        this.selectedDate = new Date().toISOString().split('T')[0];
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
                    <span style="width: 24px; text-align: center;">⭐</span>
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
        // 날짜 입력 필드 초기화 (오늘 날짜)
        const dateInput = document.getElementById('schedule-date');
        if (dateInput) {
            dateInput.value = this.selectedDate;
        }

        // merge-point-select 초기값 설정
        const mergeSelect = document.getElementById('merge-point-select');
        if (mergeSelect) {
            mergeSelect.value = '3';
        }

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
     * 항공편 목록 렌더링 (선택된 날짜로 필터링)
     */
    renderFlightList() {
        const flightQueueDiv = document.getElementById('flight-queue');
        if (!flightQueueDiv) return;

        if (this.allFlights.length === 0) {
            flightQueueDiv.innerHTML = '<div class="queue-item placeholder">데이터가 없습니다. Excel을 업로드하세요.</div>';
            return;
        }

        // 선택된 날짜에 맞는 항공편만 필터링
        const filteredFlights = this.allFlights.filter(flight => {
            if (!flight.schedule_start_date || !flight.schedule_end_date) {
                return true;
            }
            return this.selectedDate >= flight.schedule_start_date &&
                   this.selectedDate <= flight.schedule_end_date;
        });

        if (filteredFlights.length === 0) {
            flightQueueDiv.innerHTML = '<div class="queue-item placeholder">선택한 날짜에 항공편이 없습니다.</div>';
            return;
        }

        // 항공편 렌더링
        flightQueueDiv.innerHTML = filteredFlights.map((flight, index) => {
            const isSelected = this.selectedFlightId === flight.id;
            const isReference = this.referenceFlightId === flight.id;

            // CTOT 상태 결정
            const prevFlight = index > 0 ? filteredFlights[index - 1] : null;
            const nextFlight = index < filteredFlights.length - 1 ? filteredFlights[index + 1] : null;
            const ctotStatus = getCtotStatus(flight, prevFlight, nextFlight, this.separationInterval);

            // CTOT 입력 필드에 적용할 클래스들
            const ctotClasses = ['col-ctot', 'ctot-input'];
            if (ctotStatus !== 'normal') {
                ctotClasses.push(ctotStatus);
            }

            return `
                <div class="queue-item ${isSelected ? 'selected' : ''}" data-flight-id="${flight.id}">
                    <button class="ref-btn" style="width: 24px; background: none; border: none; color: var(--accent-cyan); cursor: pointer; font-size: 1rem; padding: 0; text-align: center;" title="기준 항공기로 설정">
                        ${isReference ? '⭐' : '☆'}
                    </button>
                    <span class="col-cs">${flight.callsign}</span>
                    <span class="col-dept">${flight.dept}</span>
                    <span class="col-dest">${flight.dest}</span>
                    <span class="col-cfl">${flight.cfl}</span>
                    <input type="text" class="col-eobt eobt-input" value="${flight.eobt_utc || flight.eobt || ''}" placeholder="HHMM" style="background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: white; padding: 4px; border-radius: 3px;">
                    <input type="text" class="col-atd atd-input" value="${flight.atd || ''}" placeholder="-" style="background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: white; padding: 4px; border-radius: 3px;" ${flight.atd ? 'disabled' : ''}>
                    <input type="text" class="${ctotClasses.join(' ')}" value="${flight.ctot || flight.eobt_utc || flight.eobt || ''}" placeholder="HHMM" style="background: rgba(255, 204, 0, 0.2); border: 1px solid var(--border-color); color: white; padding: 4px; border-radius: 3px;" ${flight.atd ? 'disabled' : ''}>
                </div>
            `;
        }).join('');

        // 이벤트 바인딩
        flightQueueDiv.querySelectorAll('.queue-item').forEach((item) => {
            const flightId = item.getAttribute('data-flight-id');
            const flight = this.allFlights.find(f => f.id === flightId);
            if (!flight) return;

            // 참조 항공기 버튼 클릭
            item.querySelector('.ref-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleReferenceLight(flightId);
            });

            // EOBT 입력 변경
            const eobtInput = item.querySelector('.eobt-input');
            eobtInput?.addEventListener('change', (e) => {
                if (validateTime(e.target.value) || e.target.value === '') {
                    flight.eobt_utc = e.target.value || flight.eobt;
                    flight.eobt = e.target.value || flight.eobt;
                    // CTOT도 함께 업데이트
                    flight.ctot = e.target.value || flight.eobt;
                    // 이벤트 발생
                    window.dispatchEvent(new CustomEvent('ctot-update'));
                    this.renderFlightList();
                } else {
                    e.target.value = flight.eobt_utc || flight.eobt || '';
                    showToast('올바른 시간 형식을 입력하세요 (HHMM)', 'error');
                }
            });

            // CTOT 입력 변경
            const ctotInput = item.querySelector('.ctot-input');
            ctotInput?.addEventListener('change', (e) => {
                if (validateTime(e.target.value) || e.target.value === '') {
                    flight.ctot = e.target.value || flight.eobt;
                    flight.isManualCtot = !!e.target.value;
                    window.dispatchEvent(new CustomEvent('ctot-update'));
                    this.renderFlightList();
                } else {
                    e.target.value = flight.ctot || '';
                    showToast('올바른 시간 형식을 입력하세요 (HHMM)', 'error');
                }
            });

            // ATD 입력 변경
            const atdInput = item.querySelector('.atd-input');
            atdInput?.addEventListener('change', (e) => {
                if (validateTime(e.target.value) || e.target.value === '') {
                    flight.atd = e.target.value || null;
                    flight.status = flight.atd ? 'DEP' : 'SCH';
                    window.dispatchEvent(new CustomEvent('atd-update'));
                    this.renderFlightList();
                } else {
                    e.target.value = flight.atd || '';
                    showToast('올바른 시간 형식을 입력하세요 (HHMM)', 'error');
                }
            });

            // 항공편 행 클릭 (INPUT 제외)
            item.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
                    this.selectFlight(flightId);
                }
            });
        });
    }

    /**
     * 항공편 선택
     */
    selectFlight(flightId) {
        this.selectedFlightId = flightId;
        this.renderFlightList();

        // 다른 패널과 동기화하기 위해 이벤트 발생
        window.dispatchEvent(new CustomEvent('flight-selected', {
            detail: { flightId }
        }));

        console.log('선택된 항공편:', flightId);
    }

    /**
     * 참조 항공기 토글
     */
    toggleReferenceLight(flightId) {
        if (this.referenceFlightId === flightId) {
            this.referenceFlightId = null;
        } else {
            this.referenceFlightId = flightId;
            // 참조 항공기의 CTOT를 EOBT로 설정
            const refFlight = this.allFlights.find(f => f.id === flightId);
            if (refFlight) {
                refFlight.ctot = refFlight.eobt_utc || refFlight.eobt;
                refFlight.isManualCtot = false;
            }
        }

        // CTOT 재계산 트리거
        window.dispatchEvent(new CustomEvent('reference-flight-changed', {
            detail: { referenceFlightId: this.referenceFlightId }
        }));

        this.renderFlightList();
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
        this.selectedDate = e.target.value;
        console.log('선택된 날짜:', this.selectedDate);
        this.renderFlightList();
    }

    /**
     * 겹침분리 설정 변경
     */
    mergePointChanged(e) {
        this.separationInterval = parseInt(e.target.value) * 60; // Convert to seconds
        console.log('겹침분리 설정:', this.separationInterval, '초');
        this.renderFlightList(); // 상태 색상을 다시 계산하기 위해 다시 렌더링
    }

    /**
     * CTOT 초기화
     */
    resetCTOT() {
        this.allFlights.forEach(flight => {
            flight.ctot = flight.eobt_utc || flight.eobt;
            flight.isManualCtot = false;
        });
        showToast('CTOT이 초기화되었습니다', 'info');
        this.renderFlightList();
    }

    /**
     * CTOT 계산
     */
    calculateCTOT() {
        console.log('CTOT 계산 중...');
        // 이벤트 발생 - main-modular.js에서 처리
        window.dispatchEvent(new CustomEvent('calculate-ctot', {
            detail: { separationInterval: this.separationInterval }
        }));
        showToast('CTOT 계산 요청을 보냈습니다', 'info');
    }

    /**
     * 데이터 업데이트
     */
    updateFlightData(flightId, data) {
        const flight = this.allFlights.find(f => f.id === flightId);
        if (flight) {
            Object.assign(flight, data);
            this.renderFlightList();
            showToast('항공편이 수정되었습니다', 'success');
            return true;
        }
        return false;
    }

    /**
     * 항공편 삭제
     */
    deleteFlight(flightId) {
        if (!confirm('이 항공편을 삭제하시겠습니까?')) return false;

        const index = this.allFlights.findIndex(f => f.id === flightId);
        if (index > -1) {
            this.allFlights.splice(index, 1);
            this.renderFlightList();
            showToast('항공편이 삭제되었습니다', 'success');
            return true;
        }
        return false;
    }
}
