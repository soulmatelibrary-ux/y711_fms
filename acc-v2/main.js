/**
 * ACC ATD 관리 시스템 v2 — 진입점
 */
import './style.css';
import { loadSettings, refreshSettings, getSettings } from './src/utils/settingsLoader.js';
import { apiGet, apiPost } from './src/utils/api.js';
import { recalcAll, setAirportRefTimes } from './src/services/ctotEngine.js';
import { detectConflicts } from './src/services/conflictDetector.js';
import { initAtdManager, setAtd, undoAtd, canUndo, resolveConflictDelay, previewCtot } from './src/services/atdManager.js';
import { WhatifEngine } from './src/services/whatifEngine.js';
import { TimeRibbon } from './src/components/TimeRibbon.js';
import { MiniMap } from './src/components/MiniMap.js';
import { Inspector } from './src/components/Inspector.js';
import { DepartureQueue } from './src/components/DepartureQueue.js';
import { ConflictWatchlist } from './src/components/ConflictWatchlist.js';
import { SettingsModal } from './src/components/SettingsModal.js';
import { AuditTimeline } from './src/components/AuditTimeline.js';
import { ConflictWizard } from './src/components/ConflictWizard.js';
import { formatHHMMSS, nowUtcSec, nowUtcTime, secToTime, timeToSec, escapeHtml } from './src/utils/timeUtils.js';
import { showToast } from './src/utils/toast.js';
import { computeSimPositions } from './src/services/simulationBridge.js';
import { debounce } from './src/utils/debounce.js';
import * as XLSX from 'xlsx';

// ============================================================
// 로그인 체크 (빠른 경로: localStorage 없으면 즉시 리다이렉트)
// ============================================================
if (!localStorage.getItem('userId') || !localStorage.getItem('username')) {
    window.location.href = '/login.html';
}

// ============================================================
// 앱 상태
// ============================================================
const state = {
    flights: [],
    prevFlights: [],
    conflicts: [],
    conflictArmed: false,
    setNowTarget: null,
    auditLog: [],
    whatifEngine: null,
    airportRefTimes: { RKSS: null, RKTU: null, RKJK: null, RKJJ: null }
};

// ============================================================
// 컴포넌트 참조
// ============================================================
let ribbon, miniMap, popupMap, inspector, queue, watchlist, audit, conflictWizard, settingsModal;
let _conflictQuickCardEl = null;
let _conflictQuickCardOutsideHandler = null;
let _clockTimer = null;
let _liveMapMode = 'geo';
function _getMiniMapAirportFlights(icao) {
    const now = nowUtcSec();
    const window60 = 60 * 60;
    return (state.flights || [])
        .filter(f => f.dept === icao && f.status !== 'DEP')
        .filter(f => {
            const ctotSec = timeToSec(f.ctot || f.eobt);
            return ctotSec >= now - 5 * 60 && ctotSec <= now + window60;
        })
        .sort((a, b) => timeToSec(a.eobt || a.ctot) - timeToSec(b.eobt || b.ctot));
}

const ALT_AIRPORT_POS = {
    RKSS: { x: 140,  y: 680, color: '#58a6ff' },
    RKTU: { x: 300,  y: 680, color: '#bc8cff' },
    RKJK: { x: 520,  y: 680, color: '#39c5bb' },
    RKJJ: { x: 700,  y: 680, color: '#d29922' },
    RKPC: { x: 1460, y: 680, color: '#ff6b6b' },
};

const ALT_WAYPOINT_POS = {
    BULTI: 250,
    MEKIL: 350,
    GONAX: 450,
    BEDES: 550,
    ELPOS: 660,
    JNKR:  620,
    MANGI: 760,
    DALSU: 860,
    NULDI: 980,
    DOTOL: 1080,
    RKPC:  1460,
};

// ============================================================
// 초기화
// ============================================================
async function init() {
    // 서버 세션 유효성 검증
    try {
        const meRes = await fetch('/api/auth/me', {
            headers: {
                'x-user-id': localStorage.getItem('userId') || '',
                'x-username': localStorage.getItem('username') || ''
            }
        });
        if (meRes.status === 401) {
            localStorage.removeItem('userId');
            localStorage.removeItem('username');
            localStorage.removeItem('acc_v2_ui_prefs');
            window.location.href = '/login.html';
            return;
        }
    } catch (_) {
        // 네트워크 오류(오프라인)는 통과 — 이후 API 호출에서 처리됨
    }

    showLoading('설정 로드 중...');

    try {
        // 설정 로드
        await loadSettings();
        showLoading('항공편 로드 중...');

        // 오늘 항공편 로드
        const res = await apiGet('/api/v2/flights/today');
        const rawFlights = res.data || [];

        // CTOT 초기 계산
        state.flights = recalcAll(rawFlights);
        state.prevFlights = state.flights.map(f => ({ ...f }));
        _recomputeConflicts();
        state.whatifEngine = new WhatifEngine(state.flights);

        // atdManager 초기화
        initAtdManager(state);

        hideLoading();
        renderApp();
        applyUiPrefs();
        startClock();
        setupEventListeners();

    } catch (err) {
        console.error('초기화 실패:', err);
        if (err.message === 'Unauthorized') return;
        showLoading(`오류: ${err.message}`);
    }
}

// ============================================================
// UI 렌더링
// ============================================================
function renderApp() {
    // 이전 인스턴스 정리
    queue?.destroy();

    const app = document.getElementById('app');
    app.innerHTML = `
    <header id="header">
        <span class="h-title">✈ ACC ATD v2</span>
        <span class="h-clock" id="clock">--:--:--</span>
        <span class="h-badge badge-conflicts zero" id="badge-conflicts" title="클릭 시 Watchlist 첫 항목으로 포커스">충돌 0</span>
        <span class="h-badge badge-setnow" id="badge-setnow" title="가장 최근 SET NOW 기준편">SET NOW 미지정</span>
        <span class="h-badge badge-whatif" id="badge-whatif" title="What-if 모드 토글">WHAT-IF</span>
        <span class="h-spacer"></span>
        <span class="h-user" id="h-user-label"></span>
        <button class="btn-undo" id="btn-undo" title="되돌리기 (Ctrl+Z)" disabled>↶</button>
        <button class="btn-sim-toggle" id="btn-sim-toggle" title="시뮬레이션 모드">▶ 시뮬레이션</button>
        <button class="btn-bulk-delay" id="btn-bulk-delay" title="공항별 일괄 지연">일괄지연</button>
        <button class="btn-excel" id="btn-import-excel" title="Excel 파일에서 항공기 불러오기">엑셀 임포트</button>
        <button class="btn-excel" id="btn-export-excel" title="현재 항공기 목록 Excel 저장">항공기 익스포트</button>
        <input type="file" id="excel-import-input" accept=".xlsx,.xls" style="display:none" />
        <a class="btn-main-link" href="/" target="_blank" title="메인 시스템에서 Excel 업로드">↗ 스케줄</a>
        <button class="btn-audit-toggle" id="btn-audit-toggle" title="Audit Timeline">📋</button>
        <button class="btn-settings" id="btn-settings" title="시간 설정">⚙</button>
        <button class="btn-help" id="btn-help" title="도움말 (?)">?</button>
        <span class="h-logout" id="btn-logout">로그아웃</span>
    </header>

    <div id="sim-bar">
        <button class="sim-play-btn" id="sim-play" title="재생 / 일시정지">▶</button>
        <select id="sim-speed" class="sim-speed-select" title="재생 속도">
            <option value="20">1×</option>
            <option value="40">5×</option>
            <option value="60">10×</option>
            <option value="90">30×</option>
        </select>
        <span class="sim-label">NOW</span>
        <input type="range" id="sim-slider" class="sim-slider" step="60"/>
        <span class="sim-time-display" id="sim-time-display">--:--Z</span>
        <button class="sim-close-btn" id="sim-close" title="시뮬레이션 종료">✕</button>
    </div>

    <div id="alert-bar"></div>

    <div id="content-area">
        <div id="left-col">
            <div id="ribbon-wrap">
                <canvas id="ribbon-canvas"></canvas>
            </div>
            <div id="splitter"></div>
            <div id="bottom-panel">
                <div class="bp-section">
                    <div class="bp-header">DEPARTURE QUEUE — NOW+60분</div>
                    <div class="bp-body" id="queue-body"></div>
                </div>
                <div class="bp-section">
                    <div class="bp-header">CONFLICT WATCHLIST</div>
                    <div class="bp-body wl-body" id="watchlist-body"></div>
                </div>
            </div>
        </div>
        <div id="v-splitter"></div>
        <div id="right-panel">
            <div class="rp-section rp-section-map">
                <span>MINI MAP</span>
                <div class="mm-zoom-controls">
                    <button class="btn-mm-zoom" id="mm-zoom-out" title="축소 (휠↓)">−</button>
                    <span class="mm-zoom-label" id="mm-zoom-label">1×</span>
                    <button class="btn-mm-zoom" id="mm-zoom-in" title="확대 (휠↑)">+</button>
                    <button class="btn-mm-zoom btn-mm-reset" id="mm-zoom-reset" title="전체 보기">⟲</button>
                    <button class="btn-mm-alt" id="mm-alt-view" title="고도기반 뷰 토글">ALT</button>
                    <button class="btn-live-map" id="btn-live-map" title="Live Route Map 팝업">⛶</button>
                </div>
            </div>
            <div id="minimap-container"></div>
        </div>
    </div>`;

    // username textContent 주입 (XSS 방지)
    const userLabel = document.getElementById('h-user-label');
    if (userLabel) userLabel.textContent = localStorage.getItem('username') || 'ACC';

    // 컴포넌트 초기화
    const canvas = document.getElementById('ribbon-canvas');
    resizeCanvas();

    inspector = new Inspector();

    ribbon = new TimeRibbon(canvas, {
        onFlightSelect: onFlightSelect,
        onFlightDblClick: onFlightDblClick,
        onAtdDrop: onAtdDrop,
        onConflictClick: onConflictClick,
        onUndoRequested: () => handleUndo()
    });
    ribbon.setFlights(state.flights);
    ribbon.setConflicts(state.conflicts);
    // 렌더 직후 캔버스 높이를 리본 고유 높이로 고정해 하단 공백/깜빡임을 방지
    ribbon.resize();

    miniMap = new MiniMap(document.getElementById('minimap-container'), {
        onFlightSelect,
        getAirportFlights: _getMiniMapAirportFlights
    });
    miniMap.setFlights(state.flights);
    miniMap.setConflicts(state.conflicts);

    // Live Route Map 팝업 모달 생성
    const liveMapModal = document.createElement('div');
    liveMapModal.id = 'live-map-modal';
    liveMapModal.className = 'live-map-modal';
    liveMapModal.innerHTML = `
        <div class="live-map-popup">
            <div class="live-map-header">
                <span class="live-map-title" id="live-map-title">LIVE ROUTE MAP</span>
                <div class="mm-zoom-controls" id="live-map-geo-controls">
                    <button class="btn-mm-zoom" id="lm-zoom-out" title="축소 (휠↓)">−</button>
                    <span class="mm-zoom-label" id="lm-zoom-label">1×</span>
                    <button class="btn-mm-zoom" id="lm-zoom-in" title="확대 (휠↑)">+</button>
                    <button class="btn-mm-zoom btn-mm-reset" id="lm-zoom-reset" title="전체 보기">⟲</button>
                    <button class="btn-mm-alt" id="lm-alt-view" title="고도기반 뷰 토글">ALT</button>
                </div>
                <div class="live-map-alt-controls" id="live-map-alt-controls" style="display:none">
                    <button class="btn-live-mini" id="lm-alt-full">Full View</button>
                    <div class="live-map-clock"><span>UTC</span><strong id="lm-alt-clock">0000</strong></div>
                    <button class="btn-live-ctrl" id="lm-alt-prev">⏮</button>
                    <button class="btn-live-ctrl main" id="lm-alt-play">▶</button>
                    <button class="btn-live-ctrl" id="lm-alt-stop">⏹</button>
                    <button class="btn-live-ctrl" id="lm-alt-next">⏭</button>
                    <select class="live-map-speed" id="lm-alt-speed">
                        <option value="20">1x</option>
                        <option value="40">2x</option>
                        <option value="60">5x</option>
                        <option value="90">10x</option>
                    </select>
                </div>
                <button class="live-map-close" id="btn-live-map-close">✕</button>
            </div>
            <div id="live-map-container">
                <div id="live-map-mini-wrap"></div>
                <div id="live-map-alt-wrap" style="display:none"></div>
            </div>
        </div>`;
    document.body.appendChild(liveMapModal);

    popupMap = new MiniMap(document.getElementById('live-map-mini-wrap'), {
        onFlightSelect,
        zoomInId:    'lm-zoom-in',
        zoomOutId:   'lm-zoom-out',
        zoomResetId: 'lm-zoom-reset',
        zoomLabelId: 'lm-zoom-label',
        altitudeToggleId: 'lm-alt-view'
    });
    popupMap.setFlights(state.flights);
    popupMap.setConflicts(state.conflicts);

    const setLiveMapMode = (mode = 'geo') => {
        _liveMapMode = mode;
        const title = document.getElementById('live-map-title');
        const geoControls = document.getElementById('live-map-geo-controls');
        const altControls = document.getElementById('live-map-alt-controls');
        const miniWrap = document.getElementById('live-map-mini-wrap');
        const altWrap = document.getElementById('live-map-alt-wrap');

        if (title) title.textContent = mode === 'alt' ? 'LIVE ROUTE MAP · ALTITUDE' : 'LIVE ROUTE MAP';
        if (geoControls) geoControls.style.display = mode === 'alt' ? 'none' : 'flex';
        if (altControls) altControls.style.display = mode === 'alt' ? 'flex' : 'none';
        if (miniWrap) miniWrap.style.display = mode === 'alt' ? 'none' : 'block';
        if (altWrap) altWrap.style.display = mode === 'alt' ? 'block' : 'none';

        if (mode === 'alt') {
            popupMap.setAltitudeView(false);
            _renderLiveMapAlt(simState.simTimeSec || nowUtcSec());
        }
    };

    const openLiveMap = (mode = 'geo') => {
        liveMapModal.classList.add('visible');
        popupMap.resetZoom();
        if (!simState._realNowSec) {
            simState._realNowSec = nowUtcSec();
            simState.simTimeSec = simState._realNowSec;
        }
        setLiveMapMode(mode);
    };

    document.getElementById('btn-live-map').addEventListener('click', () => {
        openLiveMap('geo');
    });
    document.getElementById('mm-alt-view')?.addEventListener('click', () => {
        openLiveMap('alt');
    });
    document.getElementById('lm-alt-view')?.addEventListener('click', () => {
        setLiveMapMode('alt');
    });
    document.getElementById('lm-alt-prev')?.addEventListener('click', () => {
        simState.simTimeSec = Math.max(0, (simState.simTimeSec || nowUtcSec()) - 300);
        simState.lastTs = null;
        _applySimTime();
    });
    document.getElementById('lm-alt-next')?.addEventListener('click', () => {
        simState.simTimeSec = Math.min(86399, (simState.simTimeSec || nowUtcSec()) + 300);
        simState.lastTs = null;
        _applySimTime();
    });
    document.getElementById('lm-alt-play')?.addEventListener('click', () => {
        toggleSimPlay();
        _renderLiveMapAlt(simState.simTimeSec || nowUtcSec());
    });
    document.getElementById('lm-alt-stop')?.addEventListener('click', () => {
        _stopSimLoop();
        if (simState._realNowSec) simState.simTimeSec = simState._realNowSec;
        simState.lastTs = null;
        _applySimTime();
    });
    document.getElementById('lm-alt-speed')?.addEventListener('change', (e) => {
        simState.speed = parseInt(e.target.value, 10) || 20;
    });
    document.getElementById('lm-alt-full')?.addEventListener('click', () => {
        liveMapModal.classList.toggle('alt-full');
    });
    document.getElementById('btn-live-map-close').addEventListener('click', () => {
        liveMapModal.classList.remove('alt-full');
        liveMapModal.classList.remove('visible');
    });
    liveMapModal.addEventListener('click', (e) => {
        if (e.target === liveMapModal) {
            liveMapModal.classList.remove('alt-full');
            liveMapModal.classList.remove('visible');
        }
    });

    queue = new DepartureQueue(document.getElementById('queue-body'), {
        onFlightSelect,
        onFlightDblClick,
        onSetAirportRef: (icao) => applyAirportRef(icao),
        onClearAirportRef: clearAirportRef,
        getAirportRefTimes: () => state.airportRefTimes,
        onSetAirportRefByFlight: (icao, eobt) => applyAirportRef(icao, eobt)
    });
    queue.setFlights(state.flights);
    queue.setConflicts(state.conflicts);

    watchlist = new ConflictWatchlist(document.getElementById('watchlist-body'), {
        onResolve: (conflict) => conflictWizard.open(conflict),
        onSelect: (flightId) => {
            const f = state.flights.find(fl => fl.id === flightId);
            if (f) onFlightSelect(f);
        }
    });
    watchlist.update(state.conflicts);
        conflictWizard = new ConflictWizard();
    conflictWizard.setFlights(state.flights);

    settingsModal = new SettingsModal();

    // Audit Timeline 팝업 모달 생성
    const auditModal = document.createElement('div');
    auditModal.id = 'audit-modal';
    auditModal.className = 'audit-modal';
    auditModal.innerHTML = `
        <div class="audit-popup">
            <div class="audit-popup-header">
                <span class="audit-popup-title">AUDIT TIMELINE</span>
                <button class="audit-popup-close" id="btn-audit-close">✕</button>
            </div>
            <div class="bp-body" id="audit-body"></div>
        </div>`;
    document.body.appendChild(auditModal);

    // AuditTimeline은 모달이 DOM에 추가된 후 초기화
    audit = new AuditTimeline(document.getElementById('audit-body'), {
        onFlightSelect: (flightId) => {
            const f = state.flights.find(fl => fl.id === flightId);
            if (f) onFlightSelect(f);
        }
    });

    document.getElementById('btn-audit-toggle').addEventListener('click', () => {
        auditModal.classList.toggle('visible');
    });
    document.getElementById('btn-audit-close').addEventListener('click', () => {
        auditModal.classList.remove('visible');
    });
    auditModal.addEventListener('click', (e) => {
        if (e.target === auditModal) auditModal.classList.remove('visible');
    });

    updateBadges();
    setupAlertBarEvents(); // Alert Bar 이벤트 위임 1회 등록
    setupSplitter();
    setupVSplitter();
    setupSimEvents(); // 시뮬레이션 슬라이더/속도 리스너 1회만 등록
    window.addEventListener('resize', debounce(resizeCanvas, 150));

    // 첫 방문 코치마크 (렌더 직후)
    requestAnimationFrame(showCoachmarks);
}

function resizeCanvas() {
    const wrap = document.getElementById('ribbon-wrap');
    const canvas = document.getElementById('ribbon-canvas');
    if (!wrap || !canvas) return;
    canvas.width = wrap.clientWidth;
    if (ribbon) {
        ribbon.resize();
        return;
    }
    canvas.height = wrap.clientHeight || 500;
}

function _setConflicts(nextConflicts = []) {
    state.conflicts = state.conflictArmed ? (nextConflicts || []) : [];
}

function _recomputeConflicts() {
    _setConflicts(detectConflicts(state.flights));
}

// 비행레벨(FL) → SVG y 좌표 변환 (ground=680, top=60, max FL400)
function _flToY(fl) {
    return 680 - (fl / 400) * 620;
}

function _buildLiveMapAltBase() {
    const wrap = document.getElementById('live-map-alt-wrap');
    if (!wrap || wrap.dataset.ready === '1') return;
    wrap.innerHTML = `
        <svg id="live-map-alt-svg" viewBox="0 0 1600 980" preserveAspectRatio="none">
            <rect x="0" y="0" width="1600" height="980" fill="#0d1117"/>

            <!-- FL 그리드 (y축 고도 기준선) — y = 680 - (fl/400)*620 -->
            <g id="live-map-alt-grid">
                <line x1="60" y1="138" x2="1580" y2="138" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="4,8"/>
                <text x="50" y="142" text-anchor="end" fill="rgba(255,255,255,0.38)" font-size="9" font-family="monospace">FL350</text>
                <line x1="60" y1="215" x2="1580" y2="215" stroke="rgba(255,255,255,0.07)" stroke-width="1" stroke-dasharray="4,8"/>
                <text x="50" y="219" text-anchor="end" fill="rgba(255,255,255,0.32)" font-size="9" font-family="monospace">FL300</text>
                <line x1="60" y1="293" x2="1580" y2="293" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="4,8"/>
                <text x="50" y="297" text-anchor="end" fill="rgba(255,255,255,0.28)" font-size="9" font-family="monospace">FL250</text>
                <line x1="60" y1="370" x2="1580" y2="370" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="4,8"/>
                <text x="50" y="374" text-anchor="end" fill="rgba(255,255,255,0.26)" font-size="9" font-family="monospace">FL200</text>
                <line x1="60" y1="525" x2="1580" y2="525" stroke="rgba(255,255,255,0.05)" stroke-width="1" stroke-dasharray="4,8"/>
                <text x="50" y="529" text-anchor="end" fill="rgba(255,255,255,0.22)" font-size="9" font-family="monospace">FL100</text>
            </g>

            <!-- 지상선 -->
            <g id="live-map-alt-groundline">
                <line x1="0" y1="680" x2="1600" y2="680" stroke="rgba(255,255,255,0.28)" stroke-width="1.5"/>
                <rect x="0" y="680" width="1600" height="60" fill="rgba(255,255,255,0.025)"/>
            </g>

            <!-- 수직 점선 (웨이포인트/공항 위치 표시) -->
            <g id="live-map-alt-vlines">
                <line x1="140"  y1="60" x2="140"  y2="680" stroke="rgba(88,166,255,0.22)"  stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="250"  y1="60" x2="250"  y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="300"  y1="60" x2="300"  y2="680" stroke="rgba(188,140,255,0.22)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="350"  y1="60" x2="350"  y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="450"  y1="60" x2="450"  y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="520"  y1="60" x2="520"  y2="680" stroke="rgba(57,197,187,0.22)"  stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="550"  y1="60" x2="550"  y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="620"  y1="60" x2="620"  y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="660"  y1="60" x2="660"  y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="700"  y1="60" x2="700"  y2="680" stroke="rgba(210,153,34,0.22)"  stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="760"  y1="60" x2="760"  y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="860"  y1="60" x2="860"  y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="980"  y1="60" x2="980"  y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="1080" y1="60" x2="1080" y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="1460" y1="60" x2="1460" y2="680" stroke="rgba(255,107,107,0.22)" stroke-width="1" stroke-dasharray="3,7"/>
            </g>

            <!-- 웨이포인트 (FL350 라인, y=134) -->
            <g id="live-map-alt-waypoints">
                <rect x="246" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="250"  y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">BULTI</text>
                <rect x="346" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="350"  y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">MEKIL</text>
                <rect x="446" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="450"  y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">GONAX</text>
                <rect x="546" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="550"  y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">BEDES</text>
                <rect x="616" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="620"  y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">JNKR</text>
                <rect x="656" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="660"  y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">ELPOS</text>
                <rect x="756" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="760"  y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">MANGI</text>
                <rect x="856" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="860"  y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">DALSU</text>
                <rect x="976" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="980"  y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">NULDI</text>
                <rect x="1076" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="1080" y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">DOTOL</text>
            </g>

            <!-- 공항 (지상선 y=680, 레이블 y=703) -->
            <g id="live-map-alt-airports">
                <circle cx="140"  cy="680" r="12" fill="#58a6ff" opacity="0.85"/><text x="140"  y="703" text-anchor="middle" fill="#d8e9ff" font-size="11" font-family="monospace" font-weight="bold">RKSS</text>
                <circle cx="300"  cy="680" r="12" fill="#bc8cff" opacity="0.85"/><text x="300"  y="703" text-anchor="middle" fill="#f0dcff" font-size="11" font-family="monospace" font-weight="bold">RKTU</text>
                <circle cx="520"  cy="680" r="12" fill="#39c5bb" opacity="0.85"/><text x="520"  y="703" text-anchor="middle" fill="#c9f6f1" font-size="11" font-family="monospace" font-weight="bold">RKJK</text>
                <circle cx="700"  cy="680" r="12" fill="#d29922" opacity="0.85"/><text x="700"  y="703" text-anchor="middle" fill="#ffe2a4" font-size="11" font-family="monospace" font-weight="bold">RKJJ</text>
                <circle cx="1460" cy="680" r="12" fill="#ff6b6b" opacity="0.85"/><text x="1460" y="703" text-anchor="middle" fill="#ffd3d3" font-size="11" font-family="monospace" font-weight="bold">RKPC</text>
            </g>

            <!-- 위도 축 (x축) -->
            <g id="live-map-alt-lataxis">
                <line x1="0" y1="740" x2="1600" y2="740" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>
                <text x="50" y="768" text-anchor="end" fill="rgba(255,255,255,0.30)" font-size="9" font-family="monospace">LAT</text>
                <!-- 공항 위도 -->
                <text x="140"  y="768" text-anchor="middle" fill="rgba(88,166,255,0.78)"  font-size="9" font-family="monospace">37.6°N</text>
                <text x="300"  y="768" text-anchor="middle" fill="rgba(188,140,255,0.78)" font-size="9" font-family="monospace">36.7°N</text>
                <text x="520"  y="768" text-anchor="middle" fill="rgba(57,197,187,0.78)"  font-size="9" font-family="monospace">35.9°N</text>
                <text x="700"  y="768" text-anchor="middle" fill="rgba(210,153,34,0.78)"  font-size="9" font-family="monospace">35.1°N</text>
                <text x="1460" y="768" text-anchor="middle" fill="rgba(255,107,107,0.78)" font-size="9" font-family="monospace">33.5°N</text>
                <!-- 웨이포인트 위도 -->
                <text x="250"  y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">37.0°N</text>
                <text x="350"  y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">36.5°N</text>
                <text x="450"  y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">36.1°N</text>
                <text x="550"  y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">35.8°N</text>
                <text x="620"  y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">35.2°N</text>
                <text x="660"  y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">35.5°N</text>
                <text x="760"  y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">34.7°N</text>
                <text x="860"  y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">34.3°N</text>
                <text x="980"  y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">33.9°N</text>
                <text x="1080" y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">33.7°N</text>
            </g>

            <g id="live-map-alt-aircraft"></g>
        </svg>`;
    wrap.dataset.ready = '1';
}

function _computeAltMapAircraftPos(f, sec) {
    const depSec = timeToSec(f.atd || f.ctot || f.eobt);
    if (!depSec || sec < depSec) return null;

    const dep = ALT_AIRPORT_POS[f.dept];
    if (!dep) return null;

    const wp = (f.routeWaypoints || [])
        .filter(w => Number.isFinite(w.timeSec) && ALT_WAYPOINT_POS[w.name] !== undefined)
        .map(w => ({ name: w.name, t: w.timeSec, x: ALT_WAYPOINT_POS[w.name] }));

    if (!wp.length) return null;

    const points = [{ name: f.dept, t: depSec, x: dep.x }, ...wp];
    if (points[points.length - 1].name !== 'RKPC') {
        points.push({ name: 'RKPC', t: points[points.length - 1].t + 8 * 60, x: ALT_WAYPOINT_POS.RKPC });
    }

    if (sec > points[points.length - 1].t) return null;

    let x = points[0].x;
    for (let i = 1; i < points.length; i++) {
        if (sec <= points[i].t) {
            const dt = points[i].t - points[i - 1].t;
            const frac = dt > 0 ? (sec - points[i - 1].t) / dt : 0;
            x = points[i - 1].x + (points[i].x - points[i - 1].x) * Math.max(0, Math.min(1, frac));
            break;
        }
    }

    const fl = parseInt(String(f.cfl || '').replace(/[^0-9]/g, ''), 10) || 250;
    const climb = Math.max(0, Math.min(1, (sec - depSec) / (10 * 60)));
    const groundY = dep.y;
    const cruiseY = _flToY(fl);  // CFL에 맞는 y좌표
    const y = groundY - (groundY - cruiseY) * climb;

    return { x, y, fl };
}

// 두 항공기 간 분리 정보 반환 (충돌 데이터 우선, 다음 공통 웨이포인트 순)
function _getAltSepInfo(f1, f2, sec) {
    const conflict = (state.conflicts || []).find(c =>
        (c.f1.id === f1.id && c.f2.id === f2.id) ||
        (c.f1.id === f2.id && c.f2.id === f1.id)
    );
    if (conflict) return { diffSec: conflict.timeDiffSec, severity: conflict.severity };

    // 다음 공통 웨이포인트에서의 시간 차이
    const up1 = (f1.routeWaypoints || []).filter(w => w.timeSec > sec);
    const up2 = (f2.routeWaypoints || []).filter(w => w.timeSec > sec);
    for (const wp1 of up1) {
        const wp2 = up2.find(w => w.name === wp1.name);
        if (wp2) return { diffSec: Math.abs(wp1.timeSec - wp2.timeSec), severity: null };
    }

    // 폴백: 출발 시각 차이
    const t1 = timeToSec(f1.atd || f1.ctot || f1.eobt) || 0;
    const t2 = timeToSec(f2.atd || f2.ctot || f2.eobt) || 0;
    return { diffSec: Math.abs(t1 - t2), severity: null };
}

// 항공기 간 점선 + 시간 차 레이블 SVG 생성
function _buildAltSepLines(visible, sec) {
    if (visible.length < 2) return '';

    const sorted = [...visible].sort((a, b) => a.pos.x - b.pos.x);
    const lines = [];

    for (let i = 0; i < sorted.length - 1; i++) {
        const { f: fA, pos: pA } = sorted[i];
        const { f: fB, pos: pB } = sorted[i + 1];

        // 너무 멀리 떨어진 쌍은 표시 안 함 (같은 구간 아님)
        if (pB.x - pA.x > 650) continue;

        const { diffSec, severity } = _getAltSepInfo(fA, fB, sec);
        const diffMin = Math.floor(diffSec / 60);
        const diffSecRem = diffSec % 60;

        const isConflict = severity === 'critical';
        const isWarning  = severity === 'warning';
        const color = isConflict ? '#ff3b30' : (isWarning ? '#ff9500' : 'rgba(130,200,255,0.85)');

        // 분리선 y: 두 항공기 중 위쪽(y 작은) 것보다 20px 위
        const lineY  = Math.min(pA.y, pB.y) - 20;
        const midX   = (pA.x + pB.x) / 2;
        const label  = diffMin > 0
            ? `${isConflict ? '⚠ ' : ''}${diffMin}분 ${String(diffSecRem).padStart(2, '0')}초`
            : `${isConflict ? '⚠ ' : ''}${diffSecRem}초`;
        const lblW   = label.length * 5.6 + 10;

        lines.push(`
            <line x1="${pA.x.toFixed(1)}" y1="${lineY.toFixed(1)}"
                  x2="${pB.x.toFixed(1)}" y2="${lineY.toFixed(1)}"
                  stroke="${color}" stroke-width="1.2" stroke-dasharray="5,4" opacity="0.88"/>
            <line x1="${pA.x.toFixed(1)}" y1="${(lineY-5).toFixed(1)}"
                  x2="${pA.x.toFixed(1)}" y2="${(lineY+5).toFixed(1)}"
                  stroke="${color}" stroke-width="1.2" opacity="0.88"/>
            <line x1="${pB.x.toFixed(1)}" y1="${(lineY-5).toFixed(1)}"
                  x2="${pB.x.toFixed(1)}" y2="${(lineY+5).toFixed(1)}"
                  stroke="${color}" stroke-width="1.2" opacity="0.88"/>
            <rect x="${(midX - lblW/2).toFixed(1)}" y="${(lineY-15).toFixed(1)}"
                  width="${lblW.toFixed(1)}" height="12" rx="3"
                  fill="rgba(13,17,23,0.72)"/>
            <text x="${midX.toFixed(1)}" y="${(lineY-6).toFixed(1)}"
                  text-anchor="middle" fill="${color}"
                  font-size="9" font-family="monospace" font-weight="bold">${escapeHtml(label)}</text>
        `);
    }

    return lines.join('');
}

function _renderLiveMapAlt(sec) {
    if (_liveMapMode !== 'alt') return;
    const modal = document.getElementById('live-map-modal');
    if (!modal?.classList.contains('visible')) return;

    _buildLiveMapAltBase();

    const utcEl = document.getElementById('lm-alt-clock');
    if (utcEl) utcEl.textContent = secToTime(sec);

    const layer = document.getElementById('live-map-alt-aircraft');
    if (!layer) return;

    // 현재 시각에 보이는 항공기 위치 계산
    const visible = state.flights
        .map(f => ({ f, pos: _computeAltMapAircraftPos(f, sec) }))
        .filter(({ pos }) => pos !== null);

    // 점선 분리 표시 (항공기 아래 레이어)
    const sepSvg = _buildAltSepLines(visible, sec);

    // 항공기 마커
    const acSvg = visible.map(({ f, pos }) => {
        const color = ALT_AIRPORT_POS[f.dept]?.color || '#58a6ff';
        return `
            <circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="8"
                fill="${color}" stroke="#fff" stroke-width="1.1" opacity="0.92"/>
            <text x="${(pos.x + 11).toFixed(1)}" y="${(pos.y + 4).toFixed(1)}"
                fill="#e7eef7" font-size="11" font-family="monospace" font-weight="700">${escapeHtml(f.callsign || '')}</text>
            <text x="${(pos.x + 11).toFixed(1)}" y="${(pos.y + 16).toFixed(1)}"
                fill="#8fb2d4" font-size="9" font-family="monospace">FL${String(pos.fl).padStart(3, '0')}</text>
        `;
    }).join('');

    layer.innerHTML = sepSvg + acSvg;

    const playBtn = document.getElementById('lm-alt-play');
    if (playBtn) playBtn.textContent = simState.playing ? '⏸' : '▶';
}

function _kstDayOfWeek() {
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 3600 * 1000);
    const dow = kstNow.getUTCDay();
    return dow === 0 ? 7 : dow;
}

function _normalizeHHMM(value) {
    if (value === null || value === undefined) return null;
    let s = String(value).trim();
    if (!s) return null;
    s = s.replace(':', '').replace(/\D/g, '');
    if (s.length === 3) s = `0${s}`;
    if (s.length !== 4) return null;
    const hh = parseInt(s.slice(0, 2), 10);
    const mm = parseInt(s.slice(2), 10);
    if (Number.isNaN(hh) || Number.isNaN(mm) || hh > 23 || mm > 59) return null;
    return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`;
}

function _parseImportedFlights(rows) {
    const validDepts = new Set(['RKSS', 'RKTU', 'RKJK', 'RKJJ']);
    const defaultDow = _kstDayOfWeek();
    const parsed = [];

    rows.forEach((row, idx) => {
        const kv = {};
        Object.entries(row || {}).forEach(([k, v]) => {
            kv[String(k).trim().toUpperCase()] = v;
        });

        const callsign = String(kv.CALLSIGN || '').trim().toUpperCase();
        const dept = String(kv.DEPT || '').trim().toUpperCase();
        const dest = String(kv.DEST || 'RKPC').trim().toUpperCase() || 'RKPC';
        const cfl = String(kv.CFL || '').trim().toUpperCase();
        const eobt = _normalizeHHMM(kv.EOBT_UTC ?? kv.EOBT);
        const dayVal = parseInt(kv.DAY_OF_WEEK, 10);
        const day_of_week = (dayVal >= 1 && dayVal <= 7) ? dayVal : defaultDow;

        if (!callsign || !validDepts.has(dept) || !eobt) return;

        parsed.push({
            id: `imp_${Date.now()}_${idx}`,
            callsign,
            dept,
            dest,
            cfl,
            eobt,
            ctot: eobt,
            atd: null,
            status: 'SCH',
            day_of_week,
            routeWaypoints: []
        });
    });

    return parsed;
}

function _applyImportedFlights(importedFlights) {
    state.flights = recalcAll(importedFlights);
    state.prevFlights = state.flights.map(f => ({ ...f }));
    state.conflictArmed = false;
    state.setNowTarget = null;
    _recomputeConflicts();
    state.whatifEngine = new WhatifEngine(state.flights);

    inspector.close();
    ribbon.setSelected(null);
    miniMap.setSelected(null);
    popupMap?.setSelected(null);
    ribbon.setFlights(state.flights);
    ribbon.setConflicts(state.conflicts);
    miniMap.setFlights(state.flights);
    miniMap.setConflicts(state.conflicts);
    popupMap?.setFlights(state.flights);
    popupMap?.setConflicts(state.conflicts);
    queue.setFlights(state.flights);
    queue.setConflicts(state.conflicts);
    watchlist.update(state.conflicts);
    conflictWizard.setFlights(state.flights);
    updateBadges();
    updateAlertBar();
}

function _syncAllComponents() {
    ribbon.setFlights(state.flights);
    ribbon.setConflicts(state.conflicts);
    miniMap.setFlights(state.flights);
    miniMap.setConflicts(state.conflicts);
    popupMap?.setFlights(state.flights);
    popupMap?.setConflicts(state.conflicts);
    queue.setFlights(state.flights);
    queue.setConflicts(state.conflicts);
    if (watchlist) watchlist.update(state.conflicts);
    conflictWizard.setFlights(state.flights);
    updateBadges();
    updateAlertBar();
}

function applyAirportRef(icao, refTime) {
    const timeStr = refTime || secToTime(nowUtcSec());
    state.airportRefTimes[icao] = timeStr;
    setAirportRefTimes(state.airportRefTimes);
    state.flights = recalcAll(state.flights);
    _recomputeConflicts();
    _syncAllComponents();
    queue.updateRefBar(state.airportRefTimes);
    showToast(`${icao} 기준시각 ${timeStr.slice(0, 2)}:${timeStr.slice(2)}Z 설정`, 'success');
}

function clearAirportRef(icao) {
    state.airportRefTimes[icao] = null;
    setAirportRefTimes(state.airportRefTimes);
    state.flights = recalcAll(state.flights);
    _recomputeConflicts();
    _syncAllComponents();
    queue.updateRefBar(state.airportRefTimes);
}

async function handleExcelImport(file) {
    if (!file) return;
    try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const sheetName = wb.SheetNames?.[0];
        if (!sheetName) throw new Error('시트를 찾을 수 없습니다');
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const parsed = _parseImportedFlights(rows);

        if (!parsed.length) {
            showToast('유효한 항공편이 없습니다 (CALLSIGN/DEPT/EOBT 확인)', 'warn');
            return;
        }

        _applyImportedFlights(parsed);
        showToast(`엑셀 임포트 완료: ${parsed.length}편 (새로고침 시 초기화됨 — 영구 저장은 메인 시스템 사용)`, 'success');
    } catch (err) {
        console.error('엑셀 임포트 실패:', err);
        showToast(`엑셀 임포트 실패: ${err.message || '파일 형식 오류'}`, 'error');
    }
}

function handleExcelExport() {
    try {
        if (!state.flights.length) {
            showToast('익스포트할 항공기가 없습니다', 'warn');
            return;
        }

        const rows = state.flights.map(f => ({
            CALLSIGN: f.callsign,
            DEPT: f.dept,
            DEST: f.dest || 'RKPC',
            EOBT: f.eobt || '',
            CTOT: f.ctot || '',
            ATD: f.atd || '',
            CFL: f.cfl || '',
            STATUS: f.status || 'SCH',
            DAY_OF_WEEK: f.day_of_week || _kstDayOfWeek(),
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Flights');
        const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
        XLSX.writeFile(wb, `acc-v2-flights-${stamp}.xlsx`);
        showToast(`엑셀 익스포트 완료: ${rows.length}편`, 'success');
    } catch (err) {
        console.error('엑셀 익스포트 실패:', err);
        showToast(`엑셀 익스포트 실패: ${err.message || '저장 오류'}`, 'error');
    }
}

// ============================================================
// 공통 확인 모달 (브라우저 confirm() 대체)
// ============================================================
function openConfirmModal({ title, message, onConfirm }) {
    if (document.getElementById('confirm-modal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'confirm-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
    <div class="modal-box" style="width:360px">
        <div class="modal-header"><span></span></div>
        <div style="padding:16px;color:#c8d4e0;font-size:13px;line-height:1.6;"></div>
        <div class="wizard-footer">
            <button class="btn-wiz-cancel" id="confirm-cancel">취소</button>
            <button id="confirm-ok" style="background:#ff3b30;color:#fff;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:bold">확인</button>
        </div>
    </div>`;
    overlay.querySelector('.modal-header span').textContent = title;
    overlay.querySelector('.modal-box > div:nth-child(2)').textContent = message;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#confirm-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#confirm-ok').addEventListener('click', () => { close(); onConfirm(); });
}

// ============================================================
// 공항별 일괄 지연 모달
// ============================================================
function openBulkDelayModal() {
    if (document.getElementById('bulk-delay-modal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'bulk-delay-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
    <div class="modal-box" style="width:360px">
        <div class="modal-header">
            <span>공항별 일괄 지연</span>
            <button class="modal-close" id="bulk-modal-close">×</button>
        </div>
        <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
            <div class="field-row">
                <label class="field-label">공항</label>
                <select id="bulk-apt" style="flex:1;background:#0d1117;border:1px solid #1e2a3a;color:#c8d4e0;padding:6px 8px;border-radius:4px">
                    ${Object.values(getSettings()?.airports || {})
                        .map(a => `<option value="${escapeHtml(a.icao)}">${escapeHtml(a.icao)} ${escapeHtml(a.nameKo || '')}</option>`)
                        .join('')}
                </select>
            </div>
            <div class="field-row">
                <label class="field-label">지연 (분)</label>
                <input id="bulk-mins" type="number" min="1" max="120" value="10"
                    style="flex:1;background:#0d1117;border:1px solid #1e2a3a;color:#c8d4e0;padding:6px 8px;border-radius:4px">
            </div>
            <div id="bulk-preview" style="font-size:12px;color:#7a8a9a;min-height:20px"></div>
        </div>
        <div class="wizard-footer">
            <button class="btn-wiz-cancel" id="bulk-cancel">취소</button>
            <button id="bulk-apply" style="background:#4fc3f7;color:#000;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:bold">적용</button>
        </div>
    </div>`;
    document.body.appendChild(overlay);

    const updatePreview = () => {
        const icao = overlay.querySelector('#bulk-apt').value;
        const mins = parseInt(overlay.querySelector('#bulk-mins').value, 10) || 0;
        const affected = state.flights.filter(f => f.dept === icao && f.status !== 'DEP');
        overlay.querySelector('#bulk-preview').textContent =
            `${icao} 미출발 ${affected.length}편에 +${mins}분 적용 예정`;
    };

    overlay.querySelector('#bulk-apt').addEventListener('change', updatePreview);
    overlay.querySelector('#bulk-mins').addEventListener('input', updatePreview);
    updatePreview();

    const close = () => overlay.remove();
    overlay.querySelector('#bulk-modal-close').addEventListener('click', close);
    overlay.querySelector('#bulk-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#bulk-apply').addEventListener('click', () => {
        const icao = overlay.querySelector('#bulk-apt').value;
        const mins = parseInt(overlay.querySelector('#bulk-mins').value, 10);
        if (!mins || mins < 1) return;
        const affected = state.flights.filter(f => f.dept === icao && f.status !== 'DEP');

        // whatifEngine으로 일괄 적용
        const wi = state.whatifEngine;
        if (!wi.active) wi.enable(state.flights);
        const updated = wi.delayAirport(icao, mins);
        state.flights = updated;
        _setConflicts(wi.getConflicts());

        ribbon.setFlights(state.flights);
        ribbon.setConflicts(state.conflicts);
        miniMap.setFlights(state.flights);
        miniMap.setConflicts(state.conflicts);
        popupMap?.setFlights(state.flights);
        popupMap?.setConflicts(state.conflicts);
        queue.setFlights(state.flights);
        queue.setConflicts(state.conflicts);
        updateBadges();
        updateAlertBar();

        // whatif 모드 활성화 표시
        document.getElementById('badge-whatif')?.classList.add('active');
        document.body.classList.add('whatif-mode');

        showToast(`${icao} ${affected.length}편 +${mins}분 적용 (What-if 모드)`, 'warn');
        close();
    });
}

// ============================================================
// 도움말 모달
// ============================================================
function openHelpModal() {
    if (document.getElementById('help-modal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'help-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
    <div class="modal-box help-box">
        <div class="modal-header">
            <span>✈ ACC ATD v2 — 사용 안내</span>
            <button class="modal-close" id="help-modal-close">×</button>
        </div>
        <div class="help-tabs">
            <button class="help-tab active" data-tab="flows">사용 흐름</button>
            <button class="help-tab" data-tab="terms">약어 범례</button>
            <button class="help-tab" data-tab="keys">단축키</button>
        </div>
        <div class="help-content">
            <div class="help-pane" id="help-pane-flows">
                <h3>3대 사용자 흐름</h3>
                <ol>
                    <li><strong>ATD 발부</strong> — Departure Queue 카드 클릭 → Inspector에서 NOW / ±1m / HH:MM 입력 → 5초 Undo 가능 → 서버 저장</li>
                    <li><strong>충돌 방지</strong> — Alert Bar 또는 헤더 "충돌 N" 클릭 → ConflictWizard 옵션 hover 미리보기 → 확정</li>
                    <li><strong>What-if 시나리오</strong> — 헤더 "WHAT-IF" 또는 "일괄지연" → 가상 변경 테스트 → 취소</li>
                </ol>
                <h3>입력 위치</h3>
                <ul>
                    <li><strong>Departure Queue</strong> — NOW±30분 항공편 목록 (검색/필터 지원)</li>
                    <li><strong>Inspector</strong> — 선택 항공편 상세 및 ATD 조정 (HH:MM 입력 가능)</li>
                    <li><strong>Time Ribbon</strong> — 항공편 바를 드래그하여 ATD 변경</li>
                    <li><strong>MiniMap</strong> — 공항·웨이포인트 클릭으로 항공편 선택</li>
                </ul>
            </div>
            <div class="help-pane hidden" id="help-pane-terms">
                <h3>약어</h3>
                <table class="shortcut-table">
                    <tr><td><strong>EOBT</strong></td><td>예상 이륙시각 (Estimated Off-Block Time)</td></tr>
                    <tr><td><strong>CTOT</strong></td><td>산출 이륙시각 (Calculated Take-Off Time)</td></tr>
                    <tr><td><strong>ATD</strong></td><td>실제 이륙시각 (Actual Take-off Departure)</td></tr>
                    <tr><td><strong>CFL</strong></td><td>순항고도 (Cleared Flight Level)</td></tr>
                    <tr><td><strong>SCH</strong></td><td>예정 (Scheduled)</td></tr>
                    <tr><td><strong>DEP</strong></td><td>출발 완료 (Departed)</td></tr>
                </table>
                <h3>공항 색상</h3>
                <table class="shortcut-table">
                    <tr><td><span style="color:#58a6ff">■</span> RKSS</td><td>김포 — 파랑</td></tr>
                    <tr><td><span style="color:#bc8cff">■</span> RKTU</td><td>청주 — 보라</td></tr>
                    <tr><td><span style="color:#39c5bb">■</span> RKJK</td><td>군산 — 청록</td></tr>
                    <tr><td><span style="color:#d29922">■</span> RKJJ</td><td>광주 — 황금</td></tr>
                </table>
            </div>
            <div class="help-pane hidden" id="help-pane-keys">
                <h3>단축키</h3>
                <table class="shortcut-table">
                    <tr><td><kbd>?</kbd></td><td>도움말 열기</td></tr>
                    <tr><td><kbd>ESC</kbd></td><td>모달 닫기</td></tr>
                    <tr><td><kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd></td><td>되돌리기 (Undo)</td></tr>
                    <tr><td><kbd>Ctrl</kbd>+<kbd>0</kbd></td><td>Time Ribbon 현재시각으로 복귀</td></tr>
                    <tr><td><kbd>↑</kbd> / <kbd>↓</kbd></td><td>Inspector — ATD ±1분</td></tr>
                    <tr><td><kbd>Shift</kbd>+<kbd>↑/↓</kbd></td><td>Inspector — ATD ±5분</td></tr>
                    <tr><td><kbd>Enter</kbd></td><td>Inspector — SET NOW</td></tr>
                    <tr><td><kbd>A</kbd> / <kbd>B</kbd> / <kbd>C</kbd> / <kbd>D</kbd></td><td>ConflictWizard 옵션 선택</td></tr>
                    <tr><td><kbd>J</kbd> / <kbd>K</kbd></td><td>Conflict Watchlist — 항목 이동</td></tr>
                    <tr><td><kbd>Enter</kbd></td><td>Conflict Watchlist — Resolve 진입</td></tr>
                    <tr><td><kbd>Space</kbd></td><td>Conflict Watchlist — Ack (인지)</td></tr>
                </table>
            </div>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.id === 'help-modal-close') closeHelpModal();
    });
    overlay.querySelectorAll('.help-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            overlay.querySelectorAll('.help-tab').forEach(t => t.classList.remove('active'));
            overlay.querySelectorAll('.help-pane').forEach(p => p.classList.add('hidden'));
            tab.classList.add('active');
            overlay.querySelector(`#help-pane-${tab.dataset.tab}`)?.classList.remove('hidden');
        });
    });
}

function closeHelpModal() {
    document.getElementById('help-modal')?.remove();
}

// ============================================================
// 코치마크 (첫 방문 1회)
// ============================================================
function showCoachmarks() {
    if (localStorage.getItem('acc_v2_seen_intro')) return;
    localStorage.setItem('acc_v2_seen_intro', '1');

    const overlay = document.createElement('div');
    overlay.id = 'coachmark-overlay';
    overlay.innerHTML = `
    <div class="coachmark" style="top:52px; left:16px;">
        <div class="cm-arrow cm-arrow-up"></div>
        <div class="cm-body">
            <strong>헤더 배지</strong><br>
            "충돌 N" = 현재 분리 위반 수<br>
            "WHAT-IF" = 가상 시나리오 모드
        </div>
    </div>
    <div class="coachmark" style="top:52px; right:420px;">
        <div class="cm-arrow cm-arrow-up"></div>
        <div class="cm-body">
            <strong>Time Ribbon</strong><br>
            항공편 바를 드래그하면<br>ATD를 직접 변경할 수 있습니다
        </div>
    </div>
    <div class="coachmark cm-bottom" style="bottom:calc(var(--bottom-h) + 16px); left:16px;">
        <div class="cm-body">
            <strong>Departure Queue</strong><br>
            카드를 클릭하면 Inspector에서<br>상세 정보와 ATD 조정이 가능합니다
        </div>
        <div class="cm-arrow cm-arrow-down"></div>
    </div>
    <button class="cm-dismiss" id="cm-dismiss">확인했습니다 ✓</button>`;
    document.body.appendChild(overlay);
    document.getElementById('cm-dismiss').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ============================================================
// 이벤트 핸들러
// ============================================================
function setupEventListeners() {
    // settings:updated 이벤트 (SettingsModal 저장 시 발행)
    document.addEventListener('settings:updated', async () => {
        await refreshSettings();
        state.flights = recalcAll(state.flights);
        _recomputeConflicts();
        ribbon.setFlights(state.flights);
        ribbon.setConflicts(state.conflicts);
        miniMap.setFlights(state.flights);
        miniMap.setConflicts(state.conflicts);
        popupMap?.setFlights(state.flights);
        popupMap?.setConflicts(state.conflicts);
        queue.setFlights(state.flights);
        queue.setConflicts(state.conflicts);
        if (watchlist) watchlist.update(state.conflicts);
        conflictWizard.setFlights(state.flights);
        updateBadges();
        updateAlertBar();
    });

    // atd:updated 이벤트 (atdManager가 발행)
    document.addEventListener('atd:updated', (e) => {
        const { flightId, diffs, conflicts, auditEntry } = e.detail;

        if (!state.conflictArmed && auditEntry?.reason === 'now_btn') {
            state.conflictArmed = true;
        }
        if (auditEntry?.reason === 'now_btn' && flightId) {
            const target = state.flights.find(f => f.id === flightId);
            if (target) {
                state.setNowTarget = {
                    callsign: target.callsign || '',
                    dept: target.dept || '',
                    atd: target.atd || auditEntry.newAtd || null
                };
            }
        }
        _setConflicts(conflicts ?? detectConflicts(state.flights));

        // 상태 갱신
        ribbon.setFlights(state.flights);
        ribbon.setConflicts(state.conflicts);
        miniMap.setFlights(state.flights);
        miniMap.setConflicts(state.conflicts);
        popupMap?.setFlights(state.flights);
        popupMap?.setConflicts(state.conflicts);
        queue.setFlights(state.flights);
        queue.setConflicts(state.conflicts);
        conflictWizard.setFlights(state.flights);

        // 펄스 + diff 라벨
        (diffs || []).forEach(d => {
            ribbon.pulseFlight(d.flightId);
            ribbon.setCtotDelta(d.flightId, d.deltaMins);
        });

        // Audit
        if (auditEntry) audit.addEntry(auditEntry);

        // Watchlist 동기화
        watchlist.update(state.conflicts);

        // Inspector 갱신
        if (inspector.flight) {
            const updated = state.flights.find(f => f.id === inspector.flight.id);
            if (updated) inspector.setFlight(updated);
        }

        updateBadges();
        updateAlertBar();
        updateUndoButton();
        if (queue) queue.updateRefBar(state.airportRefTimes);
    });

    // ConflictWizard C/D 메모 Audit 기록
    document.addEventListener('conflict:memo', (e) => {
        const { conflict, option, memo, user } = e.detail;
        const entry = {
            time: nowUtcTime(),
            flightId: conflict.f1.id,
            callsign: `${conflict.f1.callsign} vs ${conflict.f2.callsign}`,
            dept: conflict.zone,
            reason: option === 'C' ? 'route_alt_change' : 'manual_accept',
            newAtd: null,
            prevAtd: null,
            diffs: [],
            memo,
            user
        };
        state.auditLog = [entry, ...(state.auditLog || [])].slice(0, 100);
        audit.addEntry(entry);
    });

    // 헤더 버튼
    document.addEventListener('click', (e) => {
        if (e.target.id === 'btn-logout') logout();
        if (e.target.id === 'badge-whatif') toggleWhatif();
        if (e.target.id === 'badge-conflicts') {
            if (document.getElementById('alert-bar')?.classList.contains('visible')) {
                openFirstConflict();
            } else {
                watchlist.focusFirst();
            }
        }
        if (e.target.id === 'btn-settings') settingsModal.open();
        if (e.target.id === 'btn-help') openHelpModal();
        if (e.target.id === 'btn-undo') handleUndo();
        if (e.target.id === 'btn-bulk-delay') openBulkDelayModal();
        if (e.target.id === 'btn-import-excel') document.getElementById('excel-import-input')?.click();
        if (e.target.id === 'btn-export-excel') handleExcelExport();
        if (e.target.id === 'btn-sim-toggle') openSimulation();
        if (e.target.id === 'sim-play') toggleSimPlay();
        if (e.target.id === 'sim-close') closeSimulation();
    });

    document.getElementById('excel-import-input')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        await handleExcelImport(file);
        e.target.value = '';
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeHelpModal();
            closeConflictWizard();
            closeSimulation();
            inspector.close();
        }
        if (e.key === '?' && !e.target.matches('input, textarea')) openHelpModal();
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            handleUndo();
        }
        if (e.ctrlKey && (e.code === 'Digit0' || e.code === 'Numpad0')) {
            if (e.target.matches('input, textarea')) return;
            e.preventDefault();
            ribbon?.resetViewOffset();
        }
    });
}

function handleUndo() {
    if (!canUndo()) return;
    undoAtd();
    updateUndoButton();
}

function updateUndoButton() {
    const btn = document.getElementById('btn-undo');
    if (btn) btn.disabled = !canUndo();
}

function closeConflictWizard() {
    if (conflictWizard) conflictWizard.close();
    _closeConflictQuickCard();
}

function onFlightSelect(f) {
    miniMap.setSelected(f.id);
    popupMap?.setSelected(f.id);
    ribbon.setSelected(f.id);
}

function onFlightDblClick(f, event) {
    inspector.showPopup(f, event.clientX, event.clientY);
}

async function onAtdDrop(flightId, atdHHMM) {
    await setAtd(flightId, atdHHMM, 'drag');
}

function _closeConflictQuickCard() {
    if (_conflictQuickCardOutsideHandler) {
        document.removeEventListener('mousedown', _conflictQuickCardOutsideHandler);
        _conflictQuickCardOutsideHandler = null;
    }
    _conflictQuickCardEl?.remove();
    _conflictQuickCardEl = null;
}

function _findConflict(zone, flightIds = []) {
    const [id1, id2] = flightIds;
    if (!zone) return null;
    return state.conflicts.find(c => {
        if (c.zone !== zone) return false;
        if (!id1 || !id2) return true;
        return (
            (c.f1?.id === id1 && c.f2?.id === id2) ||
            (c.f1?.id === id2 && c.f2?.id === id1)
        );
    }) || null;
}

function _openConflictQuickCard(conflict, anchor = null) {
    if (!conflict) return;
    _closeConflictQuickCard();

    const neededDelaySec = Math.max(0, (conflict.requiredSec || 0) - (conflict.timeDiffSec || 0) + 30);
    const recMins = Math.max(1, Math.ceil(neededDelaySec / 60));
    const diffMin = Math.floor((conflict.timeDiffSec || 0) / 60);
    const diffSec = (conflict.timeDiffSec || 0) % 60;
    const beforeCount = state.conflicts.length;
    const beforeZoneCount = state.conflicts.filter(c => c.zone === conflict.zone).length;
    let afterCount = beforeCount;
    let afterZoneCount = beforeZoneCount;
    if (conflict.f2?.id && conflict.f2?.ctot) {
        const newCtotSec = timeToSec(conflict.f2.ctot) + neededDelaySec;
        const preview = previewCtot(state.flights, conflict.f2.id, secToTime(newCtotSec));
        afterCount = preview?.conflicts?.length ?? beforeCount;
        afterZoneCount = (preview?.conflicts || []).filter(c => c.zone === conflict.zone).length;
    }
    const delta = afterCount - beforeCount;
    const deltaLabel = delta < 0 ? `${delta}` : (delta > 0 ? `+${delta}` : '0');
    const deltaColor = delta < 0 ? '#34c759' : (delta > 0 ? '#ff6b6b' : '#ffd700');
    const zoneDelta = afterZoneCount - beforeZoneCount;
    const zoneDeltaLabel = zoneDelta < 0 ? `${zoneDelta}` : (zoneDelta > 0 ? `+${zoneDelta}` : '0');
    const zoneDeltaColor = zoneDelta < 0 ? '#34c759' : (zoneDelta > 0 ? '#ff6b6b' : '#ffd700');
    const x = anchor?.x ?? Math.round(window.innerWidth * 0.62);
    const y = anchor?.y ?? Math.round(window.innerHeight * 0.36);

    const card = document.createElement('div');
    card.id = 'conflict-quick-card';
    card.style.position = 'fixed';
    card.style.zIndex = '9500';
    card.style.width = '300px';
    card.style.maxWidth = 'calc(100vw - 16px)';
    card.style.background = '#0d1b2e';
    card.style.border = '1px solid #ff6b6b';
    card.style.borderRadius = '8px';
    card.style.boxShadow = '0 10px 28px rgba(0,0,0,0.65)';
    card.style.padding = '10px';
    card.style.left = `${Math.max(8, Math.min(x + 10, window.innerWidth - 308))}px`;
    card.style.top = `${Math.max(8, Math.min(y - 24, window.innerHeight - 168))}px`;
    card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <strong style="color:#ff6b6b;font-size:13px;">⚠ 충돌 ${conflict.zone}</strong>
            <button id="cqc-close" style="margin-left:auto;background:none;border:none;color:#7a8a9a;font-size:18px;cursor:pointer;line-height:1;">×</button>
        </div>
        <div style="color:#c8d4e0;font-size:12px;line-height:1.45;">
            <div><strong style="color:#4fc3f7">${conflict.f1?.callsign || '-'}</strong> vs <strong style="color:#4fc3f7">${conflict.f2?.callsign || '-'}</strong></div>
            <div style="color:#9fb0c2;">현재 분리 ${diffMin}분 ${String(diffSec).padStart(2, '0')}초 / 필요 ${Math.floor((conflict.requiredSec || 0) / 60)}분</div>
            <div style="margin-top:4px;color:#9fb0c2;">예상 충돌 ${beforeCount} → ${afterCount} <strong style="color:${deltaColor};">(${deltaLabel})</strong></div>
            <div style="color:#9fb0c2;">구간(${conflict.zone}) ${beforeZoneCount} → ${afterZoneCount} <strong style="color:${zoneDeltaColor};">(${zoneDeltaLabel})</strong></div>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px;">
            <button id="cqc-apply" style="flex:1;background:#ff3b30;border:1px solid #ff6b6b;color:#fff;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:700;">권장 +${recMins}m 적용</button>
            <button id="cqc-detail" style="flex:1;background:#10192a;border:1px solid #2a3f5a;color:#c8d4e0;padding:6px 8px;border-radius:4px;cursor:pointer;font-size:12px;">상세 해결</button>
        </div>`;

    document.body.appendChild(card);
    _conflictQuickCardEl = card;

    card.querySelector('#cqc-close')?.addEventListener('click', _closeConflictQuickCard);
    card.querySelector('#cqc-detail')?.addEventListener('click', () => {
        conflictWizard.open(conflict);
        _closeConflictQuickCard();
    });
    card.querySelector('#cqc-apply')?.addEventListener('click', async () => {
        await resolveConflictDelay(conflict, 'quick_card');
        showToast(`권장안 적용: ${conflict.f2?.callsign || ''} +${recMins}분`, 'warn');
        _closeConflictQuickCard();
    });

    _conflictQuickCardOutsideHandler = (e) => {
        if (_conflictQuickCardEl && !_conflictQuickCardEl.contains(e.target)) _closeConflictQuickCard();
    };
    setTimeout(() => {
        if (_conflictQuickCardOutsideHandler) {
            document.addEventListener('mousedown', _conflictQuickCardOutsideHandler);
        }
    }, 0);
}

function onConflictClick(zone, flightIds, anchor) {
    const cf = _findConflict(zone, flightIds);
    if (cf) _openConflictQuickCard(cf, anchor);
}

// ============================================================
// 충돌 / Alert Bar (페이지네이션)
// ============================================================
let _alertPage = 0;
let _prevConflictCount = 0;

// Alert Bar 이벤트는 renderApp 후 1회만 등록 (이벤트 위임)
function setupAlertBarEvents() {
    const bar = document.getElementById('alert-bar');
    if (!bar) return;
    bar.addEventListener('click', (e) => {
        const t = e.target;
        if (t.classList.contains('btn-alert-prev')) {
            _alertPage = Math.max(0, _alertPage - 1);
            updateAlertBar();
        } else if (t.classList.contains('btn-alert-next')) {
            _alertPage = Math.min(state.conflicts.length - 1, _alertPage + 1);
            updateAlertBar();
        } else if (t.classList.contains('btn-resolve')) {
            if (state.conflicts[_alertPage]) conflictWizard.open(state.conflicts[_alertPage]);
        } else if (t.id === 'btn-alert-close') {
            hideAlertBar();
        }
    });
}

function updateAlertBar() {
    const bar = document.getElementById('alert-bar');
    if (!bar) return;

    if (state.conflicts.length === 0) {
        bar.classList.remove('visible');
        _alertPage = 0;
        _prevConflictCount = 0;
        return;
    }

    // 새 충돌 발생 시 첫 페이지로 복귀 + 배지 깜빡임
    if (state.conflicts.length > _prevConflictCount) {
        _alertPage = 0;
        flashBadge('badge-conflicts');
    }
    _prevConflictCount = state.conflicts.length;

    _alertPage = Math.min(_alertPage, state.conflicts.length - 1);
    const cf = state.conflicts[_alertPage];
    const diffMin = Math.floor(cf.timeDiffSec / 60);
    const diffSec = cf.timeDiffSec % 60;
    const total = state.conflicts.length;

    bar.innerHTML = `
        <span class="alert-text">
            ⚠ <strong>${escapeHtml(cf.f1.callsign)}</strong> vs <strong>${escapeHtml(cf.f2.callsign)}</strong>
            @ ${escapeHtml(cf.zone)} — 분리 ${diffMin}분 ${diffSec}초 (필요 ${cf.requiredSec / 60}분)
        </span>
        ${total > 1 ? `
        <span class="alert-pager">
            <button class="btn-alert-prev" ${_alertPage === 0 ? 'disabled' : ''}>◀</button>
            <span>${_alertPage + 1} / ${total}</span>
            <button class="btn-alert-next" ${_alertPage >= total - 1 ? 'disabled' : ''}>▶</button>
        </span>` : ''}
        <button class="btn-resolve">Resolve</button>
        <button class="btn-alert-close" id="btn-alert-close">×</button>`;

    bar.classList.add('visible');
}

function flashBadge(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('blink');
    setTimeout(() => el.classList.remove('blink'), 2000);
}

function hideAlertBar() {
    document.getElementById('alert-bar')?.classList.remove('visible');
}

function openFirstConflict() {
    if (state.conflicts.length) conflictWizard.open(state.conflicts[0]);
}

function scrollToFirstConflict() {
    openFirstConflict();
}

// ============================================================
// 시뮬레이션 MVP (P0-5)
// ============================================================
const simState = {
    playing: false,
    simTimeSec: 0,
    speed: 20,
    rafId: null,
    lastTs: null,
    _realNowSec: 0,
};

// 슬라이더/속도 리스너는 DOM 생성 후 1회만 등록 (renderApp 이후 setupSimEvents 호출)
function setupSimEvents() {
    const slider = document.getElementById('sim-slider');
    slider?.addEventListener('input', () => {
        simState.simTimeSec = parseInt(slider.value, 10);
        simState.lastTs = null;
        _applySimTime();
    });
    document.getElementById('sim-speed')?.addEventListener('change', (e) => {
        simState.speed = parseInt(e.target.value, 10) || 20;
    });
}

function openSimulation() {
    const bar = document.getElementById('sim-bar');
    if (!bar) return;
    if (bar.classList.contains('visible')) return;

    simState._realNowSec = nowUtcSec();
    simState.simTimeSec = simState._realNowSec;
    simState.playing = false;
    simState.lastTs = null;

    // 슬라이더 범위: NOW ± 2h (자정 경계 처리: 86400 이내로 제한)
    const slider = document.getElementById('sim-slider');
    if (slider) {
        slider.min = Math.max(0, simState._realNowSec - 7200);
        slider.max = Math.min(simState._realNowSec + 7200, 86399);
        slider.value = simState._realNowSec;
    }

    bar.classList.add('visible');
    document.getElementById('btn-sim-toggle')?.classList.add('active');
    _applySimTime();
}

function closeSimulation() {
    const bar = document.getElementById('sim-bar');
    if (!bar?.classList.contains('visible')) return;

    _stopSimLoop();
    bar.classList.remove('visible');
    document.getElementById('btn-sim-toggle')?.classList.remove('active');
    document.getElementById('sim-play').textContent = '▶';

    ribbon.clearSimTime();
    miniMap.clearSimPositions();
    popupMap?.clearSimPositions();
}

function toggleSimPlay() {
    if (simState.playing) {
        _stopSimLoop();
        document.getElementById('sim-play').textContent = '▶';
    } else {
        simState.lastTs = null;
        simState.rafId = requestAnimationFrame(_simLoop);
        simState.playing = true;
        document.getElementById('sim-play').textContent = '⏸';
    }
}

function _stopSimLoop() {
    if (simState.rafId) cancelAnimationFrame(simState.rafId);
    simState.rafId = null;
    simState.playing = false;
    simState.lastTs = null;
}

function _simLoop(ts) {
    if (!simState.playing) return;
    if (simState.lastTs !== null) {
        const dt = (ts - simState.lastTs) / 1000;
        simState.simTimeSec = Math.min(
            simState._realNowSec + 7200,
            simState.simTimeSec + dt * simState.speed
        );
        // 끝에 도달하면 자동 정지
        if (simState.simTimeSec >= simState._realNowSec + 7200) {
            _stopSimLoop();
            document.getElementById('sim-play').textContent = '▶';
            return;
        }
    }
    simState.lastTs = ts;
    _applySimTime();
    simState.rafId = requestAnimationFrame(_simLoop);
}

function _applySimTime() {
    const sec = simState.simTimeSec;
    const slider = document.getElementById('sim-slider');
    if (slider) slider.value = sec;
    const display = document.getElementById('sim-time-display');
    if (display) display.textContent = secToTime(sec) + 'Z';
    ribbon.setSimTime(sec);
    miniMap.setSimPositions(computeSimPositions(state.flights, sec));
    popupMap?.setSimPositions(computeSimPositions(state.flights, sec));
    _renderLiveMapAlt(sec);
}

// ============================================================
// What-if 진입 띠
// ============================================================
function showWhatifBanner(active) {
    document.getElementById('whatif-banner')?.remove();
    if (!active) return;
    const banner = document.createElement('div');
    banner.id = 'whatif-banner';
    banner.innerHTML = `
        <span class="wi-banner-text">⚡ WHAT-IF 시나리오 모드 — 변경은 저장되지 않습니다</span>
        <button class="wi-btn-apply" id="wi-apply">적용</button>
        <button class="wi-btn-cancel" id="wi-cancel">취소</button>`;
    // #app 내부의 alert-bar 바로 뒤에 삽입
    const app = document.getElementById('app');
    const alertBar = document.getElementById('alert-bar');
    if (alertBar && app) {
        app.insertBefore(banner, alertBar.nextSibling);
    } else {
        app?.appendChild(banner);
    }
    document.getElementById('wi-apply').addEventListener('click', applyWhatif);
    document.getElementById('wi-cancel').addEventListener('click', cancelWhatif);
}

function applyWhatif() {
    const wi = state.whatifEngine;
    if (!wi.active) return;
    openConfirmModal({
        title: 'What-if 적용',
        message: 'What-if 변경 사항을 실제 스케줄에 적용합니다. 이 작업은 Undo가 불가능합니다. 계속하시겠습니까?',
        onConfirm: _doApplyWhatif
    });
}

function _doApplyWhatif() {
    const wi = state.whatifEngine;
    if (!wi.active) return;
    const applied = wi.apply();
    state.flights = applied;
    _setConflicts(wi.getConflicts());
    state.whatifEngine = new WhatifEngine(state.flights);
    ribbon.setFlights(state.flights);
    ribbon.setConflicts(state.conflicts);
    ribbon.setWhatif(false, []);
    miniMap.setFlights(state.flights);
    miniMap.setConflicts(state.conflicts);
    popupMap?.setFlights(state.flights);
    popupMap?.setConflicts(state.conflicts);
    queue.setFlights(state.flights);
    queue.setConflicts(state.conflicts);
    document.getElementById('badge-whatif')?.classList.remove('active');
    document.body.classList.remove('whatif-mode');
    showWhatifBanner(false);
    saveUiPref('whatifActive', false);
    updateBadges();
    updateAlertBar();
    showToast('What-if 변경 사항이 적용되었습니다', 'success');
}

function cancelWhatif() {
    const wi = state.whatifEngine;
    if (!wi.active) return;
    const base = wi.disable();
    if (base) state.flights = base;
    // What-if 취소: 베이스라인 기준으로 충돌 재계산
    _recomputeConflicts();
    ribbon.setFlights(state.flights);
    ribbon.setConflicts(state.conflicts);
    ribbon.setWhatif(false, []);
    miniMap.setFlights(state.flights);
    miniMap.setConflicts(state.conflicts);
    popupMap?.setFlights(state.flights);
    popupMap?.setConflicts(state.conflicts);
    queue.setFlights(state.flights);
    queue.setConflicts(state.conflicts);
    conflictWizard.setFlights(state.flights);
    document.getElementById('badge-whatif')?.classList.remove('active');
    document.body.classList.remove('whatif-mode');
    showWhatifBanner(false);
    saveUiPref('whatifActive', false);
    updateBadges();
    updateAlertBar();
}

// ============================================================
// What-if
// ============================================================
function toggleWhatif() {
    const btn = document.getElementById('badge-whatif');
    const wi = state.whatifEngine;
    if (!wi.active) {
        const whatifFlights = wi.enable(state.flights);
        ribbon.setWhatif(true, whatifFlights);
        btn.classList.add('active');
        document.body.classList.add('whatif-mode');
        showWhatifBanner(true);
        saveUiPref('whatifActive', true);
    } else {
        const base = wi.disable();
        if (base) state.flights = base;
        ribbon.setFlights(state.flights);
        ribbon.setWhatif(false, []);
        btn.classList.remove('active');
        document.body.classList.remove('whatif-mode');
        showWhatifBanner(false);
        saveUiPref('whatifActive', false);
    }
}

// ============================================================
// 배지 갱신
// ============================================================
function updateBadges() {
    const bc = document.getElementById('badge-conflicts');
    if (bc) {
        if (!state.conflictArmed) {
            bc.textContent = '충돌 대기';
            bc.classList.add('zero');
            return;
        }
        bc.textContent = `충돌 ${state.conflicts.length}`;
        bc.classList.toggle('zero', state.conflicts.length === 0);
    }

    const bs = document.getElementById('badge-setnow');
    if (bs) {
        const t = state.setNowTarget;
        if (!t?.callsign) {
            bs.textContent = 'SET NOW 미지정';
            return;
        }
        const timeTxt = t.atd ? `${String(t.atd).slice(0, 2)}:${String(t.atd).slice(2)}Z` : '--:--Z';
        bs.textContent = `SET NOW ${t.callsign} · ${t.dept} · ${timeTxt}`;
    }
}

// ============================================================
// 시계
// ============================================================
function startClock() {
    if (_clockTimer) clearInterval(_clockTimer);
    const el = document.getElementById('clock');
    _clockTimer = setInterval(() => {
        if (el) el.textContent = formatHHMMSS() + 'Z';
    }, 1000);
}

// ============================================================
// UI 환경설정 영속화
// ============================================================
const UI_PREFS_KEY = 'acc_v2_ui_prefs';

function loadUiPrefs() {
    try { return JSON.parse(localStorage.getItem(UI_PREFS_KEY) || '{}'); } catch (_) { return {}; }
}

function saveUiPref(key, value) {
    const prefs = loadUiPrefs();
    prefs[key] = value;
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
}

function applyUiPrefs() {
    const prefs = loadUiPrefs();
    if (prefs.bottomH) {
        document.documentElement.style.setProperty('--bottom-h', `${prefs.bottomH}px`);
    }
    if (prefs.rightW) {
        document.documentElement.style.setProperty('--right-w', `${prefs.rightW}px`);
    }
    if (prefs.whatifActive) {
        // What-if 상태 복원은 flights 로드 후 toggleWhatif로
        state._restoreWhatif = true;
    }
}

// ============================================================
// 스플리터
// ============================================================
function setupSplitter() {
    const splitter = document.getElementById('splitter');
    if (!splitter) return;
    let dragging = false, startY = 0, startH = 0;

    splitter.addEventListener('mousedown', (e) => {
        dragging = true;
        startY = e.clientY;
        startH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bottom-h'), 10) || 260;
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dy = startY - e.clientY;
        const newH = Math.max(80, Math.min(window.innerHeight - 200, startH + dy));
        document.documentElement.style.setProperty('--bottom-h', `${newH}px`);
        resizeCanvas();
    });

    document.addEventListener('mouseup', () => {
        if (dragging) {
            const h = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--bottom-h'), 10);
            saveUiPref('bottomH', h);
            resizeCanvas();
        }
        dragging = false;
        document.body.style.userSelect = '';
    });

    splitter.addEventListener('dblclick', () => {
        document.documentElement.style.setProperty('--bottom-h', '560px');
        saveUiPref('bottomH', 560);
        resizeCanvas();
    });
}

function setupVSplitter() {
    const vSplitter = document.getElementById('v-splitter');
    if (!vSplitter) return;
    let dragging = false, startX = 0, startW = 0;

    vSplitter.addEventListener('mousedown', (e) => {
        dragging = true;
        startX = e.clientX;
        startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--right-w'), 10) || 380;
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = startX - e.clientX; // 왼쪽으로 드래그 → 오른쪽 패널 넓어짐
        const newW = Math.max(240, Math.min(640, startW + dx));
        document.documentElement.style.setProperty('--right-w', `${newW}px`);
        resizeCanvas();
    });

    document.addEventListener('mouseup', () => {
        if (dragging) {
            const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--right-w'), 10);
            saveUiPref('rightW', w);
        }
        dragging = false;
        document.body.style.userSelect = '';
    });

    vSplitter.addEventListener('dblclick', () => {
        document.documentElement.style.setProperty('--right-w', '380px');
        saveUiPref('rightW', 380);
    });
}

// ============================================================
// 로딩 / 로그아웃
// ============================================================
function showLoading(msg = '로드 중...') {
    let el = document.getElementById('loading-overlay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'loading-overlay';
        document.body.appendChild(el);
    }
    // textContent 사용으로 err.message XSS 방지
    el.innerHTML = '<div class="loading-spinner"></div><span class="loading-text"></span>';
    el.querySelector('.loading-text').textContent = msg;
    el.style.display = 'flex';
}

function hideLoading() {
    const el = document.getElementById('loading-overlay');
    if (el) el.style.display = 'none';
}

async function logout() {
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json',
                'x-user-id': localStorage.getItem('userId') || '',
                'x-username': localStorage.getItem('username') || '' }
        });
    } catch (_) { /* 오프라인이어도 로컬 세션 제거 */ }
    localStorage.removeItem('userId');
    localStorage.removeItem('username');
    localStorage.removeItem('acc_v2_ui_prefs');
    window.location.href = '/login.html';
}

// ============================================================
// 앱 시작
// ============================================================
init();
