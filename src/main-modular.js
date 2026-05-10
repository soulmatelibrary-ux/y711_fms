/**
 * Y711 FMS - 메인 애플리케이션 진입점
 * 모든 컴포넌트를 조율하는 핵심 모듈
 */

import { initDatabase } from './utils/database.js';
import { initToastContainer, showToast } from './utils/notifications.js';
import { LeftPanel } from './components/LeftPanel.js';
import { RightPanel } from './components/RightPanel.js';
import { Header } from './components/Header.js';
import { Modals } from './components/Modals.js';
import { updateCTOTs, detectConflicts } from './services/ctot.js';
import * as SimService from './services/simulation.js';

// ============================================
// 전역 상태
// ============================================
let header = null;
let leftPanel = null;
let rightPanel = null;
let modals = null;
let db = null;
let allFlights = [];

// ============================================
// 글로벌 설정 데이터
// ============================================

// 공항 정보 데이터베이스
const airportDatabase = {
    'RKSS': { name: '김포', color: '#58a6ff', x: 150, taxiTime: 15, mergePoint: 'BULTI' },
    'RKTU': { name: '청주', color: '#bc8cff', x: 300, taxiTime: 15, mergePoint: 'MEKIL' },
    'RKJK': { name: '군산', color: '#39c5bb', x: 500, taxiTime: 15, mergePoint: 'GONAX' },
    'RKJJ': { name: '광주', color: '#d29922', x: 700, taxiTime: 15, mergePoint: 'BEDES' },
    'RKPC': { name: '제주', color: '#ff6b6b', x: 1400, taxiTime: 15 }
};

// 웨이포인트 X 좌표
const waypointsX = {
    'BULTI': 250, 'MEKIL': 350, 'GONAX': 450, 'BEDES': 550,
    'ELPOS': 650, 'MANGI': 750, 'DALSU': 850, 'NULDI': 950, 'DOTOL': 1050
};

// 웨이포인트 네트워크 (경로)
const waypoints = [
    { from: 'BULTI', to: 'MEKIL', duration: 15 },
    { from: 'MEKIL', to: 'GONAX', duration: 20 },
    { from: 'GONAX', to: 'BEDES', duration: 15 },
    { from: 'BEDES', to: 'ELPOS', duration: 18 },
    { from: 'ELPOS', to: 'MANGI', duration: 20 },
    { from: 'MANGI', to: 'DALSU', duration: 16 },
    { from: 'DALSU', to: 'NULDI', duration: 14 },
    { from: 'NULDI', to: 'DOTOL', duration: 15 }
];

// 구간별 시간 설정 (분 단위)
const segmentConfig = {
    'RKSS_BULTI': 10, 'RKTU_MEKIL': 10, 'RKJK_GONAX': 10, 'RKJJ_BEDES': 10,
    'BULTI_MEKIL': 15, 'MEKIL_GONAX': 20, 'GONAX_BEDES': 15,
    'BEDES_ELPOS': 18, 'ELPOS_MANGI': 20, 'MANGI_DALSU': 16,
    'DALSU_NULDI': 14, 'NULDI_DOTOL': 15
};

// 시뮬레이션 상태
let simTimeSeconds = 0;
let simRunning = false;
let simSpeed = 1;
let timelineStartHour = 5; // 타임라인 시작 시간 (시간)

// ============================================
// 애플리케이션 초기화
// ============================================
async function initApp() {
    try {
        console.log('🚀 Y711 FMS 초기화 중...');

        // 1. 인증 확인
        checkAuthentication();

        // 2. Toast 컨테이너 초기화
        initToastContainer();

        // 3. 데이터베이스 초기화
        await initDatabase();
        console.log('✅ 데이터베이스 초기화 완료');

        // 4. 컴포넌트 생성
        header = new Header();
        leftPanel = new LeftPanel();
        rightPanel = new RightPanel();
        modals = new Modals();

        // 5. UI 렌더링
        renderUI();

        // 6. 컴포넌트 초기화
        header.init();
        leftPanel.init();
        rightPanel.init();
        modals.init();

        // 7. 이벤트 바인딩
        bindGlobalEvents();

        // 8. 시뮬레이션 초기화
        SimService.initSimulation();

        console.log('✅ Y711 FMS 초기화 완료');

    } catch (error) {
        console.error('❌ 초기화 실패:', error);
        showToast('애플리케이션 초기화 실패', 'error');
    }
}

// ============================================
// 인증 확인
// ============================================
function checkAuthentication() {
    if (!isAuthenticated()) {
        console.log('인증 필요. 로그인 페이지로 이동...');
        window.location.href = '/login.html';
        throw new Error('User not authenticated');
    }

    const currentUser = getCurrentUser();
    console.log('✅ 인증됨:', currentUser);

    // 현재 사용자 표시
    const userEl = document.getElementById('current-user');
    if (userEl) {
        userEl.textContent = currentUser;
    }
}

// ============================================
// UI 렌더링
// ============================================
function renderUI() {
    const appDiv = document.getElementById('app');
    if (!appDiv) {
        console.error('❌ #app 요소를 찾을 수 없습니다');
        return;
    }

    // 메인 컨테이너 HTML (모든 컴포넌트 통합)
    const mainHTML = `
        ${header.render()}

        <div class="app-body">
            ${leftPanel.render()}
            ${rightPanel.render()}
        </div>

        <!-- 모달들 -->
        ${modals.render()}

        <!-- Toast Container -->
        <div id="toast-container" class="toast-container"></div>
    `;

    appDiv.innerHTML = mainHTML;
    appDiv.style.visibility = 'visible';
}

// ============================================
// 전역 이벤트 바인딩
// ============================================
function bindGlobalEvents() {
    // CTOT 계산 버튼
    document.getElementById('calc-ctot-btn')?.addEventListener('click', () => {
        calculateCTOT();
    });

    // CTOT 리셋 버튼
    document.getElementById('reset-ctot-btn')?.addEventListener('click', () => {
        resetCTOT();
    });

    // 시뮬레이션 재생 버튼
    document.getElementById('play-btn')?.addEventListener('click', () => {
        if (SimService.isSimulationRunning()) {
            SimService.pauseSimulation();
            updateSimulationUI();
        } else {
            SimService.startSimulation();
            updateSimulationUI();
        }
    });

    // 시뮬레이션 중지 버튼
    document.getElementById('stop-btn')?.addEventListener('click', () => {
        SimService.stopSimulation();
        updateSimulationUI();
    });

    // 시뮬레이션 속도 변경
    document.getElementById('speed-select')?.addEventListener('change', (e) => {
        SimService.setSimulationSpeed(parseInt(e.target.value));
    });

    // 분리 기준 변경
    document.getElementById('merge-point-select')?.addEventListener('change', (e) => {
        updateSeparationInterval(parseInt(e.target.value));
    });

    // 시뮬레이션 시간 업데이트
    window.addEventListener('simulation-update', (e) => {
        updateSimulationClock(SimService.getSimulationTimeString());
    });
}

// ============================================
// CTOT 계산 및 충돌 감지
// ============================================
function calculateCTOT() {
    console.log('🧮 CTOT 계산 시작...');
    const separationMinutes = parseInt(document.getElementById('merge-point-select')?.value || '3');

    try {
        // 모든 항공편 CTOT 계산
        const updated = updateCTOTs(allFlights, separationMinutes);
        allFlights = updated;

        // 충돌 감지
        const conflicts = detectConflicts(allFlights);
        if (conflicts.length > 0) {
            console.warn(`⚠️ ${conflicts.length}개의 충돌 감지됨`);
            showToast(`${conflicts.length}개의 충돌이 감지되었습니다`, 'warning');
        } else {
            showToast('CTOT 계산 완료 (충돌 없음)', 'success');
        }

        // UI 업데이트
        leftPanel?.renderFlightList?.();

    } catch (error) {
        console.error('CTOT 계산 오류:', error);
        showToast('CTOT 계산 실패', 'error');
    }
}

function resetCTOT() {
    console.log('🔄 CTOT 리셋...');
    // CTOT 값을 EOBT로 초기화
    allFlights.forEach(flight => {
        flight.ctot = flight.eobt;
        flight.routeWaypoints = [];
    });
    showToast('CTOT가 초기화되었습니다', 'info');
    leftPanel?.renderFlightList?.();
}

// ============================================
// 시뮬레이션 UI 업데이트
// ============================================
function updateSimulationUI() {
    const playBtn = document.getElementById('play-btn');
    const isRunning = SimService.isSimulationRunning();

    if (playBtn) {
        playBtn.textContent = isRunning ? '⏸' : '▶';
        playBtn.title = isRunning ? 'Pause Simulation' : 'Start Simulation';
    }
}

function updateSimulationClock(timeStr) {
    const clockEl = document.getElementById('sim-clock');
    if (clockEl) {
        clockEl.textContent = timeStr;
    }
}

// ============================================
// 분리 기준 업데이트
// ============================================
function updateSeparationInterval(minutes) {
    console.log(`📏 분리 기준 변경: ${minutes}분`);
    // 분리 기준이 변경되었으므로 CTOT 재계산 권장
    showToast(`분리 기준이 ${minutes}분으로 변경되었습니다. CTOT 재계산을 권장합니다.`, 'info');
}

// ============================================
// Excel 처리 (Header에서 호출)
// ============================================
export async function processExcelFile(flights, startDate, endDate) {
    try {
        console.log(`📊 Excel 파일 처리: ${flights.length}개 항공편`);

        // 메모리에 로드 (normalized data)
        allFlights = flights.map((f, idx) => ({
            id: `${Date.now()}_${idx}`,
            callsign: f.CALLSIGN || '',
            dept: f.DEPT || '',
            dest: f.DEST || '',
            cfl: f.CFL || 'F250',
            eobt_utc: f.EOBT_UTC || f.EOBT || '',
            eobt: f.EOBT_UTC || f.EOBT || '',
            ctot: f.EOBT_UTC || f.EOBT || '',
            atd: null,
            dayOfWeek: f.DAY_OF_WEEK || 1,
            schedule_start_date: startDate,
            schedule_end_date: endDate,
            routeWaypoints: [],
            status: 'normal'
        }));

        // LeftPanel의 allFlights도 업데이트
        if (leftPanel) {
            leftPanel.allFlights = allFlights;
            console.log(`✅ ${allFlights.length}개 항공편 로드 완료`);

            // UI 렌더링
            if (typeof leftPanel.renderFlightList === 'function') {
                leftPanel.renderFlightList();
            }
        }

        showToast(`${allFlights.length}개의 항공편이 로드되었습니다`, 'success');
        return true;

    } catch (error) {
        console.error('Excel 처리 오류:', error);
        showToast('Excel 데이터 처리 실패: ' + error.message, 'error');
        return false;
    }
}

// ============================================
// 전역 함수 노출 (Header 컴포넌트에서 사용)
// ============================================
window.processExcelFile = processExcelFile;

// ============================================
// 페이지 로드 시 초기화
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

// ============================================
// 에러 핸들러
// ============================================
window.addEventListener('error', (event) => {
    console.error('전역 에러:', event.error);
    showToast('오류가 발생했습니다', 'error');
});
