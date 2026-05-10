/**
 * 모달 관리 컴포넌트
 * 도움말, 설정, Excel 업로드, 겹침 경고, 비밀번호 변경 모달
 */

import { showToast } from '../utils/notifications.js';

export class Modals {
    constructor() {
        this.helpModal = null;
        this.settingsModal = null;
        this.schedulePeriodModal = null;
        this.overlapWarningModal = null;
        this.activeModals = [];
    }

    /**
     * 모든 모달 HTML 렌더링
     */
    render() {
        return `
            <!-- 도움말 모달 -->
            <div id="help-modal" class="modal hidden">
                <div class="modal-content glass-card" style="min-width: 700px; max-width: 900px; max-height: 85vh; overflow-y: auto;">
                    <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; position: sticky; top: 0; background: var(--card-bg); padding: 1rem; margin: -1.5rem -1.5rem 1rem -1.5rem; border-radius: 12px 12px 0 0;">
                        <h3>CJU Flow Simulator 사용 가이드</h3>
                        <button class="btn-icon" id="close-help" style="background:none; border:none; color:white; font-size:1.2rem; cursor:pointer;">✕</button>
                    </div>
                    <div class="help-content" id="help-content" style="line-height: 1.8; color: var(--text-primary);">
                        <!-- 동적으로 생성됨 -->
                    </div>
                </div>
            </div>

            <!-- 스케줄 기간 선택 모달 -->
            <div id="schedule-period-modal" class="modal hidden">
                <div class="modal-content glass-card" style="min-width: 450px;">
                    <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                        <h3>📅 스케줄 기간 선택</h3>
                        <button class="btn-icon" id="close-schedule-modal" style="background:none; border:none; color:white; font-size:1.2rem; cursor:pointer;">✕</button>
                    </div>

                    <div class="form-group">
                        <label>시작일</label>
                        <input type="date" id="schedule-start-date" class="form-input">
                    </div>

                    <div class="form-group">
                        <label>종료일</label>
                        <input type="date" id="schedule-end-date" class="form-input">
                    </div>

                    <div class="form-group">
                        <label>빠른 선택</label>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn btn-secondary" id="quick-3m">3개월</button>
                            <button class="btn btn-secondary" id="quick-6m">6개월</button>
                            <button class="btn btn-secondary" id="quick-12m">1년</button>
                        </div>
                    </div>

                    <div style="background: rgba(88,166,255,0.1); padding: 10px; border-radius: 4px; margin: 15px 0;">
                        <span style="color: var(--text-secondary); font-size: 0.9rem;" id="period-summary">
                            기간을 선택하세요
                        </span>
                    </div>

                    <div class="modal-footer" style="display: flex; gap: 8px; justify-content: flex-end;">
                        <button class="btn btn-secondary" id="cancel-schedule">취소</button>
                        <button class="btn btn-primary" id="confirm-schedule">확인</button>
                    </div>
                </div>
            </div>

            <!-- 겹침 경고 모달 -->
            <div id="overlap-warning-modal" class="modal hidden">
                <div class="modal-content glass-card" style="min-width: 500px;">
                    <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                        <h3>⚠️ 기존 데이터 덮어쓰기 경고</h3>
                        <button class="btn-icon" id="close-overlap-modal" style="background:none; border:none; color:white; font-size:1.2rem; cursor:pointer;">✕</button>
                    </div>

                    <p style="color: var(--text-secondary); margin-bottom: 1rem;">
                        다음 기간의 기존 데이터가 있습니다. 해당 구간은 새로운 데이터로 업데이트됩니다:
                    </p>

                    <div id="overlap-list" style="background: rgba(248,81,73,0.1); padding: 10px; border-radius: 4px; margin-bottom: 1rem; max-height: 200px; overflow-y: auto;">
                        <!-- 겹치는 기간 목록 -->
                    </div>

                    <div class="modal-footer" style="display: flex; gap: 8px; justify-content: flex-end;">
                        <button class="btn btn-secondary" id="cancel-overlap">취소</button>
                        <button class="btn btn-danger" id="confirm-overlap">📤 업로드</button>
                    </div>
                </div>
            </div>

            <!-- 설정 모달 -->
            <div id="settings-modal" class="modal hidden">
                <div class="modal-content glass-card" style="min-width: 600px;">
                    <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                        <h3>Configuration</h3>
                        <button class="btn-icon" id="close-settings" style="background:none; border:none; color:white; font-size:1.2rem; cursor:pointer;">✕</button>
                    </div>

                    <div class="config-section">
                        <h4>Entry Segments (Initial Leg)</h4>
                        <div class="config-group" id="entry-segments-config">
                            <!-- JS Generated -->
                        </div>
                    </div>

                    <div class="config-section" style="margin-top: 1rem;">
                        <h4>Airport Configuration</h4>
                        <div class="airport-config-header" style="display:grid; grid-template-columns: 1fr 1fr 1fr 0.5fr; gap:0.5rem; font-size:0.8rem; opacity:0.7; margin-bottom:0.5rem;">
                            <span>Airport</span>
                            <span>Taxi Time (Min)</span>
                            <span>Departure Interval (Min)</span>
                            <span>Color</span>
                        </div>
                        <div class="config-group" id="airport-config">
                            <!-- JS Generated -->
                        </div>
                    </div>

                    <div class="modal-footer" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 1.5rem;">
                        <button class="btn btn-secondary" id="cancel-settings">취소</button>
                        <button class="btn btn-primary" id="save-settings">저장</button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 모달 초기화 및 이벤트 바인딩
     */
    init() {
        this.bindHelpModalEvents();
        this.bindSettingsModalEvents();
        this.bindSchedulePeriodModalEvents();
        this.bindOverlapWarningModalEvents();
        this.renderHelpContent();
    }

    /**
     * 도움말 모달 이벤트 바인딩
     */
    bindHelpModalEvents() {
        document.getElementById('close-help')?.addEventListener('click', () => {
            this.closeModal('help-modal');
        });

        document.getElementById('help-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'help-modal') {
                this.closeModal('help-modal');
            }
        });
    }

    /**
     * 설정 모달 이벤트 바인딩
     */
    bindSettingsModalEvents() {
        document.getElementById('close-settings')?.addEventListener('click', () => {
            this.closeModal('settings-modal');
        });

        document.getElementById('cancel-settings')?.addEventListener('click', () => {
            this.closeModal('settings-modal');
        });

        document.getElementById('save-settings')?.addEventListener('click', () => {
            this.saveSettings();
        });

        document.getElementById('settings-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'settings-modal') {
                this.closeModal('settings-modal');
            }
        });
    }

    /**
     * 스케줄 기간 선택 모달 이벤트 바인딩
     */
    bindSchedulePeriodModalEvents() {
        document.getElementById('quick-3m')?.addEventListener('click', () => {
            this.setSchedulePeriod(3);
        });

        document.getElementById('quick-6m')?.addEventListener('click', () => {
            this.setSchedulePeriod(6);
        });

        document.getElementById('quick-12m')?.addEventListener('click', () => {
            this.setSchedulePeriod(12);
        });

        document.getElementById('schedule-start-date')?.addEventListener('change', () => {
            this.updatePeriodSummary();
        });

        document.getElementById('schedule-end-date')?.addEventListener('change', () => {
            this.updatePeriodSummary();
        });

        document.getElementById('confirm-schedule')?.addEventListener('click', () => {
            this.confirmSchedulePeriod();
        });

        document.getElementById('cancel-schedule')?.addEventListener('click', () => {
            this.closeModal('schedule-period-modal');
        });

        document.getElementById('close-schedule-modal')?.addEventListener('click', () => {
            this.closeModal('schedule-period-modal');
        });

        document.getElementById('schedule-period-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'schedule-period-modal') {
                this.closeModal('schedule-period-modal');
            }
        });
    }

    /**
     * 겹침 경고 모달 이벤트 바인딩
     */
    bindOverlapWarningModalEvents() {
        document.getElementById('close-overlap-modal')?.addEventListener('click', () => {
            this.closeModal('overlap-warning-modal');
        });

        document.getElementById('cancel-overlap')?.addEventListener('click', () => {
            this.closeModal('overlap-warning-modal');
        });

        document.getElementById('confirm-overlap')?.addEventListener('click', () => {
            this.confirmOverlap();
        });

        document.getElementById('overlap-warning-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'overlap-warning-modal') {
                this.closeModal('overlap-warning-modal');
            }
        });
    }

    /**
     * 모달 열기
     */
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('hidden');
            this.activeModals.push(modalId);
            document.body.style.overflow = 'hidden';
        }
    }

    /**
     * 모달 닫기
     */
    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('hidden');
            this.activeModals = this.activeModals.filter(m => m !== modalId);
            if (this.activeModals.length === 0) {
                document.body.style.overflow = 'auto';
            }
        }
    }

    /**
     * 도움말 내용 렌더링
     */
    renderHelpContent() {
        const helpContent = document.getElementById('help-content');
        if (!helpContent) return;

        helpContent.innerHTML = `
            <!-- 소개 -->
            <section style="margin-bottom: 2rem;">
                <h4 style="color: var(--accent-cyan); margin-bottom: 0.8rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">
                    시스템 소개
                </h4>
                <p style="margin-bottom: 1rem;">
                    <strong>CJU Flow Simulator</strong>는 서해안 항공로(Y711)를 이용하여 <strong>제주(RKPC)</strong>로 향하는 항공편의
                    <strong>CTOT(Calculated Take-Off Time, 계산된 이륙시간)</strong>를 관리하는 시스템입니다.
                </p>
                <p>
                    여러 공항에서 출발한 항공기들이 동일한 항공로에서 합류할 때 <strong>안전한 분리 간격</strong>을
                    유지하도록 출발 시간을 자동으로 조정합니다.
                </p>
            </section>

            <!-- 대상 공항 -->
            <section style="margin-bottom: 2rem;">
                <h4 style="color: var(--accent-cyan); margin-bottom: 0.8rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">
                    대상 공항 및 합류 지점
                </h4>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 1rem;">
                    <thead>
                        <tr style="background: rgba(255,255,255,0.05);">
                            <th style="padding: 10px; text-align: left; border-bottom: 1px solid var(--border-color);">공항</th>
                            <th style="padding: 10px; text-align: center; border-bottom: 1px solid var(--border-color);">코드</th>
                            <th style="padding: 10px; text-align: center; border-bottom: 1px solid var(--border-color);">합류지점</th>
                            <th style="padding: 10px; text-align: center; border-bottom: 1px solid var(--border-color);">진입시간</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="padding: 8px; color: #58a6ff;">김포</td>
                            <td style="text-align: center;">RKSS</td>
                            <td style="text-align: center;">BULTI</td>
                            <td style="text-align: center;">8분</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; color: #bc8cff;">청주</td>
                            <td style="text-align: center;">RKTU</td>
                            <td style="text-align: center;">MEKIL</td>
                            <td style="text-align: center;">7분</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; color: #39c5bb;">군산</td>
                            <td style="text-align: center;">RKJK</td>
                            <td style="text-align: center;">MANGI</td>
                            <td style="text-align: center;">3분</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; color: #d29922;">광주</td>
                            <td style="text-align: center;">RKJJ</td>
                            <td style="text-align: center;">DALSU</td>
                            <td style="text-align: center;">1분</td>
                        </tr>
                    </tbody>
                </table>
            </section>

            <!-- CTOT 계산 원리 -->
            <section>
                <h4 style="color: var(--accent-cyan); margin-bottom: 0.8rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">
                    CTOT 계산 원리
                </h4>
                <div style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px;">
                    <p><strong>1단계: EOBT 기준</strong></p>
                    <p style="margin-left: 1rem; color: var(--text-secondary); margin-bottom: 1rem;">CTOT는 EOBT(예상 이륙 시간)보다 빠를 수 없습니다.</p>

                    <p><strong>2단계: 이륙 간격 적용</strong></p>
                    <p style="margin-left: 1rem; color: var(--text-secondary); margin-bottom: 1rem;">같은 공항에서 연속 출발하는 항공기는 최소 이륙 간격을 유지합니다.</p>

                    <p><strong>3단계: 웨이포인트 분리</strong></p>
                    <p style="margin-left: 1rem; color: var(--text-secondary);">합류 지점에서 앞 항공기와 <strong>최소 3분 분리</strong>를 유지하도록 CTOT를 조정합니다.</p>
                </div>
            </section>
        `;
    }

    /**
     * 날짜 범위 빠른 선택
     */
    setSchedulePeriod(months) {
        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + months);

        const startInput = document.getElementById('schedule-start-date');
        const endInput = document.getElementById('schedule-end-date');

        if (startInput) startInput.value = startDate.toISOString().split('T')[0];
        if (endInput) endInput.value = endDate.toISOString().split('T')[0];

        this.updatePeriodSummary();
    }

    /**
     * 기간 선택 요약 업데이트
     */
    updatePeriodSummary() {
        const startDate = document.getElementById('schedule-start-date')?.value;
        const endDate = document.getElementById('schedule-end-date')?.value;
        const summary = document.getElementById('period-summary');

        if (startDate && endDate && summary) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
            summary.textContent = `${startDate} ~ ${endDate} (${days}일)`;
        }
    }

    /**
     * 스케줄 기간 선택 확인
     */
    confirmSchedulePeriod() {
        const startDate = document.getElementById('schedule-start-date')?.value;
        const endDate = document.getElementById('schedule-end-date')?.value;

        if (!startDate || !endDate) {
            showToast('시작일과 종료일을 선택하세요', 'warning');
            return;
        }

        // Header의 uploadExcelData 함수 호출 (main-modular.js에서 Header.init()이 이를 노출함)
        if (typeof window.headerUploadExcelData === 'function') {
            window.headerUploadExcelData(startDate, endDate);
        } else {
            console.warn('headerUploadExcelData를 찾을 수 없습니다');
            showToast('시스템 오류: Excel 업로드 함수를 찾을 수 없습니다', 'error');
        }
    }

    /**
     * 겹침 경고 모달 표시
     */
    showOverlapWarning(overlappingDates) {
        this.openModal('overlap-warning-modal');

        const list = document.getElementById('overlap-list');
        if (list) {
            list.innerHTML = overlappingDates
                .map(date => `<div style="padding: 5px 0;">• ${date}</div>`)
                .join('');
        }
    }

    /**
     * 겹침 경고 모달 확인
     */
    confirmOverlap() {
        this.closeModal('overlap-warning-modal');
        showToast('기존 데이터가 새로운 데이터로 교체되었습니다', 'success');
    }

    /**
     * 설정 저장
     */
    saveSettings() {
        showToast('설정이 저장되었습니다', 'success');
        this.closeModal('settings-modal');
    }
}
