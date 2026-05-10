/**
 * 상단 헤더 컴포넌트
 * 로고, 네비게이션, Excel 업로드, 사용자 메뉴
 */

import { showToast } from '../utils/notifications.js';

export class Header {
    constructor() {
        this.currentUser = null;
        this.isExcelUploading = false;
    }

    /**
     * 헤더 HTML 렌더링
     */
    render() {
        return `
            <header class="app-header">
                <!-- Logo & Brand -->
                <div class="header-branding">
                    <h1>제주공항 <span>흐름 관리 시스템</span></h1>
                </div>

                <!-- Main Navigation -->
                <nav class="top-nav">
                    <button class="nav-btn active" id="view-dashboard">Dashboard</button>
                    <button class="nav-btn" id="view-settings">Settings</button>
                </nav>

                <!-- Action Buttons (Excel Upload) -->
                <div class="header-actions">
                    <div class="excel-upload-section">
                        <input type="file" id="excel-upload" accept=".xlsx,.xls" style="display: none;">
                        <button onclick="document.getElementById('excel-upload').click()" class="btn btn-primary excel-btn" title="Excel 파일 업로드">
                            📂 Excel
                        </button>
                        <button id="download-sample-btn" class="btn btn-secondary excel-btn" title="샘플 파일 다운로드">
                            📥 Sample
                        </button>
                        <div id="upload-status" class="upload-status"></div>
                    </div>
                </div>

                <!-- User Menu -->
                <div class="header-right">
                    <button id="help-btn" class="btn btn-secondary btn-icon" title="도움말">?</button>
                    <div class="user-profile">
                        <span class="status-indicator online"></span>
                        <span id="current-user" class="username">acc</span>
                    </div>
                    <button id="logout-btn" class="btn btn-secondary" title="로그아웃">로그아웃</button>
                </div>
            </header>
        `;
    }

    /**
     * 헤더 초기화 및 이벤트 바인딩
     */
    init() {
        this.currentUser = this.getCurrentUser();
        this.updateUserDisplay();
        this.bindEvents();

        // Modals 컴포넌트가 Excel 업로드를 완료할 수 있도록 노출
        window.headerUploadExcelData = (startDate, endDate) => {
            return this.uploadExcelData(startDate, endDate);
        };
    }

    /**
     * 이벤트 바인딩
     */
    bindEvents() {
        // 도움말 버튼
        document.getElementById('help-btn')?.addEventListener('click', () => {
            this.openHelpModal();
        });

        // Excel 업로드
        document.getElementById('excel-upload')?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleExcelUpload(e.target.files[0]);
                e.target.value = '';
            }
        });

        // 샘플 다운로드
        document.getElementById('download-sample-btn')?.addEventListener('click', () => {
            this.downloadSampleExcel();
        });

        // 로그아웃
        document.getElementById('logout-btn')?.addEventListener('click', () => {
            this.handleLogout();
        });

        // Dashboard/Settings 탭
        document.getElementById('view-dashboard')?.addEventListener('click', () => {
            this.switchTab('dashboard');
        });

        document.getElementById('view-settings')?.addEventListener('click', () => {
            this.switchTab('settings');
        });
    }

    /**
     * 현재 사용자 정보 조회
     */
    getCurrentUser() {
        if (typeof getCurrentUser === 'function') {
            return getCurrentUser();
        }
        return localStorage.getItem('y711_user') || 'acc';
    }

    /**
     * 사용자 정보 업데이트
     */
    updateUserDisplay() {
        const userEl = document.getElementById('current-user');
        if (userEl) {
            userEl.textContent = this.currentUser;
        }
    }

    /**
     * Excel 파일 업로드 처리
     */
    async handleExcelUpload(file) {
        if (this.isExcelUploading) return;
        this.isExcelUploading = true;

        try {
            const statusEl = document.getElementById('upload-status');
            if (statusEl) {
                statusEl.textContent = '파일 분석 중...';
                statusEl.style.display = 'block';
            }

            // Excel 파일 읽기 (XLSX 라이브러리 사용)
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    // xlsx 라이브러리가 전역 스코프에 있음
                    if (typeof XLSX === 'undefined') {
                        throw new Error('XLSX 라이브러리를 로드할 수 없습니다');
                    }

                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                    const flights = XLSX.utils.sheet_to_json(worksheet);

                    if (flights.length === 0) {
                        showToast('Excel 파일에 데이터가 없습니다', 'warning');
                        this.isExcelUploading = false;
                        return;
                    }

                    // 날짜 범위 선택 모달 열기
                    this.openSchedulePeriodModal(flights);

                } catch (error) {
                    console.error('Excel 파싱 오류:', error);
                    showToast('Excel 파일 분석 실패: ' + error.message, 'error');
                    this.isExcelUploading = false;
                }
            };

            reader.readAsArrayBuffer(file);

        } catch (error) {
            console.error('Excel 업로드 오류:', error);
            showToast('파일 업로드 실패', 'error');
            this.isExcelUploading = false;
        }
    }

    /**
     * 샘플 Excel 다운로드
     */
    downloadSampleExcel() {
        try {
            // 샘플 데이터 생성
            const sampleData = [
                { CALLSIGN: 'KAL001', DEPT: 'RKSS', DEST: 'RKPC', CFL: 'F280', EOBT_UTC: '0600', DAY_OF_WEEK: 1 },
                { CALLSIGN: 'AAR201', DEPT: 'RKTU', DEST: 'RKPC', CFL: 'F300', EOBT_UTC: '0620', DAY_OF_WEEK: 1 },
                { CALLSIGN: 'KAL003', DEPT: 'RKSS', DEST: 'RKPC', CFL: 'F270', EOBT_UTC: '0645', DAY_OF_WEEK: 1 },
                { CALLSIGN: 'AWE401', DEPT: 'RKTU', DEST: 'RKPC', CFL: 'F320', EOBT_UTC: '0700', DAY_OF_WEEK: 1 },
                { CALLSIGN: 'KAL005', DEPT: 'RKSS', DEST: 'RKPC', CFL: 'F290', EOBT_UTC: '0725', DAY_OF_WEEK: 1 },
            ];

            // XLSX를 이용한 Excel 생성
            if (typeof XLSX === 'undefined') {
                showToast('XLSX 라이브러리를 로드할 수 없습니다', 'error');
                return;
            }

            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.json_to_sheet(sampleData);
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Flights');

            // 파일 다운로드
            const filename = `Y711_Sample_${new Date().toISOString().split('T')[0]}.xlsx`;
            XLSX.writeFile(workbook, filename);

            showToast('샘플 파일이 다운로드되었습니다', 'success');

        } catch (error) {
            console.error('샘플 파일 다운로드 오류:', error);
            showToast('샘플 파일 다운로드 실패', 'error');
        }
    }

    /**
     * 도움말 모달 열기
     */
    openHelpModal() {
        const modal = document.getElementById('help-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }

        // 닫기 버튼
        document.getElementById('close-help')?.addEventListener('click', () => {
            this.closeHelpModal();
        });

        // 배경 클릭으로 닫기
        modal?.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeHelpModal();
            }
        });
    }

    /**
     * 도움말 모달 닫기
     */
    closeHelpModal() {
        const modal = document.getElementById('help-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    /**
     * 날짜 범위 선택 모달 열기
     */
    openSchedulePeriodModal(flights) {
        const modal = document.getElementById('schedule-period-modal');
        if (!modal) return;

        modal.classList.remove('hidden');
        this.excelFilesToUpload = flights;

        // 초기 날짜 설정 (6개월 기본값)
        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 6);

        const startInput = document.getElementById('schedule-start-date');
        const endInput = document.getElementById('schedule-end-date');

        if (startInput) startInput.value = startDate.toISOString().split('T')[0];
        if (endInput) endInput.value = endDate.toISOString().split('T')[0];

        // 기간 요약 업데이트
        const summary = document.getElementById('period-summary');
        if (summary) {
            const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
            summary.textContent = `${startInput.value} ~ ${endInput.value} (${days}일)`;
        }

        // NOTE: 모든 event listener는 Modals.js의 init()에서 한 번만 바인딩됨
        // 여기서는 modal 열기만 수행
    }


    /**
     * Excel 데이터 업로드 (Modals에서 호출됨)
     */
    async uploadExcelData(startDate, endDate) {
        if (!startDate || !endDate) {
            showToast('시작일과 종료일을 선택하세요', 'warning');
            return;
        }

        try {
            // 전역 processExcelFile 함수 호출 (main-modular.js에서 정의됨)
            if (typeof window.processExcelFile === 'function') {
                const success = await window.processExcelFile(this.excelFilesToUpload, startDate, endDate);

                if (success) {
                    this.closeSchedulePeriodModal();
                }
            } else {
                console.warn('processExcelFile 함수를 찾을 수 없습니다');
                showToast('시스템 오류: processExcelFile 함수를 찾을 수 없습니다', 'error');
            }
        } catch (error) {
            console.error('Excel 업로드 오류:', error);
            showToast('파일 업로드 실패: ' + error.message, 'error');
        }

        this.isExcelUploading = false;
    }

    /**
     * 날짜 범위 선택 모달 닫기
     */
    closeSchedulePeriodModal() {
        const modal = document.getElementById('schedule-period-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    /**
     * 탭 전환
     */
    switchTab(tab) {
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

        if (tab === 'dashboard') {
            document.getElementById('view-dashboard')?.classList.add('active');
            // TODO: Dashboard 표시
        } else if (tab === 'settings') {
            document.getElementById('view-settings')?.classList.add('active');
            // TODO: Settings 모달 표시
        }
    }

    /**
     * 로그아웃 처리
     */
    handleLogout() {
        if (confirm('로그아웃 하시겠습니까?')) {
            if (typeof logout === 'function') {
                logout();
            } else {
                localStorage.removeItem('y711_session');
                localStorage.removeItem('y711_user');
                window.location.href = '/login.html';
            }
        }
    }
}
