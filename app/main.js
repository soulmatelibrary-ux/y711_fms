/**
 * ACC ATD 관리 시스템 v2 — 진입점
 */
import './style.css';
import { loadSettings, refreshSettings, getSettings } from './src/utils/settingsLoader.js';
import { apiGet, apiPost, apiDelete, configureAuth } from './src/utils/api.js';
import { recalcAll } from './src/services/ctotEngine.js';
import { detectConflicts } from './src/services/conflictDetector.js';
import { initAtdManager, setAtd, undoAtd, canUndo, clearUndoStack, resolveConflictDelay, previewCtot } from './src/services/atdManager.js';
import { WhatifEngine } from './src/services/whatifEngine.js';
import { TimeRibbon } from './src/components/TimeRibbon.js';
import { MiniMap } from './src/components/MiniMap.js';
import { Inspector } from './src/components/Inspector.js';
import { DepartureQueue } from './src/components/DepartureQueue.js';
import { SettingsModal } from './src/components/SettingsModal.js';
import { AuditTimeline } from './src/components/AuditTimeline.js';
import { ConflictWizard } from './src/components/ConflictWizard.js';
import { WaypointTimeTable } from './src/components/WaypointTimeTable.js';
import { SeparationSummary } from './src/components/SeparationSummary.js';
import { formatHHMMSS, nowUtcSec, nowUtcTime, secToTime, timeToSec, toAbsSec, escapeHtml } from './src/utils/timeUtils.js';
import { showToast } from './src/utils/toast.js';
import { computeSimPositions } from './src/services/simulationBridge.js';
import { debounce } from './src/utils/debounce.js';
import * as XLSX from 'xlsx';

// ============================================================
// 인증 기능 플래그 — false: 로그인 화면 생략, 헤더 인증 UI 숨김
//                    true : 원래대로 로그인/로그아웃 활성화
// ============================================================
const AUTH_ENABLED = false;
const FLIGHT_REFRESH_MS = 60 * 1000; // 60초마다 Oracle DB 재조회

// WHAT-IF 기능 플래그 — false: 배지·기능 숨김 (미완성)
//                        true : 헤더에 WHAT-IF 배지 표시 및 기능 활성화
const WHATIF_ENABLED = false;

// 로그인 체크 (빠른 경로: localStorage 없으면 즉시 리다이렉트)
if (AUTH_ENABLED && (!localStorage.getItem('userId') || !localStorage.getItem('username'))) {
    window.location.href = '/login.html';
}

// AUTH_ENABLED = false일 때 기본 인증 정보 자동 설정 + idle 타임아웃 비활성화
if (!AUTH_ENABLED) {
    localStorage.setItem('userId', '1');
    localStorage.setItem('username', 'admin');
    configureAuth({ enabled: false });
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
};

// ============================================================
// 컴포넌트 참조
// ============================================================
let ribbon, miniMap, popupMap, inspector, queue, audit, conflictWizard, settingsModal, waypointTable, separationSummary;
let _conflictQuickCardEl = null;
let _conflictQuickCardOutsideHandler = null;
let _clockTimer = null;
let _liveMapMode = 'geo';

function _normalizeSecDelta(targetSec, baseSec) {
    let d = targetSec - baseSec;
    if (d < -43200) d += 86400;
    if (d > 43200) d -= 86400;
    return d;
}

function _getDefaultSetNowTarget() {
    const now = nowUtcSec();
    const candidates = (state.flights || [])
        .filter(f => f.status !== 'DEP')
        .map(f => {
            const eobtSec = timeToSec(f.eobt);
            return {
                flight: f,
                eobtSec,
                diffSec: Number.isFinite(eobtSec) ? _normalizeSecDelta(eobtSec, now) : Infinity
            };
        })
        .filter(x => Number.isFinite(x.eobtSec) && x.eobtSec >= 0);

    if (!candidates.length) return null;

    // 기본 기준: 현재시각 기준 EOBT 10분 전(= now-10m) 이후 편부터 선택
    const fromTenMinBefore = candidates.filter(x => x.diffSec >= -10 * 60);
    const pool = fromTenMinBefore.length ? fromTenMinBefore : candidates;
    pool.sort((a, b) => a.diffSec - b.diffSec);

    const picked = pool[0]?.flight;
    if (!picked) return null;
    return {
        callsign: picked.callsign || '',
        dept: picked.dept || '',
        eobt: picked.eobt || null,
        atd: null,
        source: 'default'
    };
}

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
    RKTU: { x: 430,  y: 680, color: '#bc8cff' },
    RKJK: { x: 689,  y: 680, color: '#39c5bb' },
    RKJJ: { x: 947,  y: 680, color: '#d29922' },
    RKPC: { x: 1460, y: 680, color: '#ff6b6b' },
};

const ALT_WAYPOINT_POS = {
    BULTI:  333,
    MEKIL:  495,
    GONAX:  624,
    BEDES:  721,
    ELPOS:  818,
    MANGI: 1076,
    DALSU: 1205,
    NULDI: 1334,
    DOTOL: 1399,
    RKPC:  1460,
};

function _serverRowToAuditEntry(row) {
    const isAtd = row.event_type === 'atd_set';
    const time = (row.occurred_at || '').slice(11, 16).replace(':', '');
    return {
        time,
        flightId: row.flight_id,
        callsign: row.callsign,
        dept: row.dept,
        prevAtd: isAtd ? row.prev_value : undefined,
        newAtd: isAtd ? row.new_value : undefined,
        prevCtot: !isAtd ? row.prev_value : undefined,
        newCtot: !isAtd ? row.new_value : undefined,
        reason: row.reason,
        diffs: (() => { try { return JSON.parse(row.cascade_diffs || '[]'); } catch (_) { return []; } })(),
        eventType: row.event_type
    };
}

// ============================================================
// 초기화
// ============================================================
async function init() {
    // 서버 세션 유효성 검증 (AUTH_ENABLED일 때만)
    if (AUTH_ENABLED) {
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
        resizeCanvas(); // applyUiPrefs()가 CSS 변수를 변경한 뒤 캔버스 크기를 재조정
        _initSimSlider();
        startClock();
        setupEventListeners();

        // 당일 변경 이력 서버에서 복원
        try {
            const logRes = await apiGet('/api/v2/change-log');
            if (logRes.data?.length) {
                state.auditLog = logRes.data.map(_serverRowToAuditEntry);
                audit.setEntries(state.auditLog);
            }
        } catch (_) {
            // 이력 로드 실패는 비치명적 — 당일 이벤트부터 새로 기록
        }

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
        <span class="h-clock" id="clock">--:--:--</span><span class="h-sync" id="refresh-ts" title="마지막 DB 동기화 시각"></span>
        ${WHATIF_ENABLED ? '<span class="h-badge badge-whatif" id="badge-whatif" title="What-if 모드 토글">WHAT-IF</span>' : ''}
        <span class="h-spacer"></span>
        ${AUTH_ENABLED ? '<span class="h-user" id="h-user-label"></span>' : ''}
        <button class="btn-undo" id="btn-undo" title="되돌리기 (Ctrl+Z)" disabled>↶</button>
        <button class="btn-reset-state" id="btn-reset-state" title="ATD/CTOT/시뮬레이션 전체 초기화">↺ 초기화</button>
        <button class="btn-audit-toggle" id="btn-audit-toggle" title="Audit Timeline">📋</button>
        <button class="btn-settings" id="btn-settings" title="시간 설정">⚙</button>
        <button class="btn-help" id="btn-help" title="도움말 (?)">?</button>
        ${AUTH_ENABLED ? '<span class="h-logout" id="btn-logout">로그아웃</span>' : ''}
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

    <div id="content-area">
        <div id="left-col">
            <div id="ribbon-wrap">
                <canvas id="ribbon-canvas"></canvas>
            </div>
            <div id="ribbon-nav">
                <input type="range" id="ribbon-scrollbar" min="-86400" max="86400" step="60" value="0" aria-label="타임리본 좌우 스크롤">
            </div>
            <div id="splitter"></div>
            <div id="bottom-panel">
                <div class="bp-section" id="queue-section">
                    <div class="bp-header">DEPARTURE QUEUE — NOW+3H</div>
                    <div class="bp-body" id="queue-body"></div>
                </div>
                <div id="bp-splitter"></div>
                <div class="bp-section" id="separation-section">
                    <div class="bp-header">합류점 통과 시간표</div>
                    <div class="bp-body" id="waypoint-table-body"></div>
                    <div id="sep-inner-splitter"></div>
                    <div class="bp-header bp-header-sub">분리간격 요약 (촉박한 순)</div>
                    <div class="bp-body" id="separation-body"></div>
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

    // username textContent 주입 (AUTH_ENABLED일 때만)
    if (AUTH_ENABLED) {
        const userLabel = document.getElementById('h-user-label');
        if (userLabel) userLabel.textContent = localStorage.getItem('username') || 'ACC';
    }

    // 컴포넌트 초기화
    const canvas = document.getElementById('ribbon-canvas');
    resizeCanvas();

    inspector = new Inspector();

    ribbon = new TimeRibbon(canvas, {
        onFlightSelect: onFlightSelect,
        onFlightDblClick: onFlightDblClick,
        onAtdDrop: onAtdDrop,
        onConflictClick: onConflictClick,
        onUndoRequested: () => handleUndo(),
        onViewChange: (offsetSec) => {
            const slider = document.getElementById('ribbon-scrollbar');
            if (slider) slider.value = String(offsetSec);
        }
    });
    ribbon.setFlights(state.flights);
    ribbon.setConflicts(state.conflicts);
    const ribbonScrollbar = document.getElementById('ribbon-scrollbar');
    if (ribbonScrollbar) {
        ribbonScrollbar.value = String(ribbon.getViewOffsetSec());
        ribbonScrollbar.addEventListener('input', (e) => {
            ribbon.setViewOffsetSec(parseInt(e.target.value, 10) || 0);
        });
    }
    // 렌더 직후 캔버스 높이를 리본 고유 높이로 고정해 하단 공백/깜빡임을 방지
    ribbon.resize();

    miniMap = new MiniMap(document.getElementById('minimap-container'), {
        onFlightSelect,
        getAirportFlights: _getMiniMapAirportFlights
    });
    miniMap.setFlights(state.flights);
    miniMap.setConflicts(state.conflicts);

    // Live Route Map 팝업 모달 생성 (재렌더 시 이전 인스턴스 제거 — 중복 방지)
    document.getElementById('live-map-modal')?.remove();
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
                        <option value="20">1×</option>
                        <option value="40">5×</option>
                        <option value="60">10×</option>
                        <option value="90">30×</option>
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
            simState._realNowSec = toAbsSec(nowUtcSec());
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
        simState.simTimeSec = Math.max(simState._startSec || 54000, (simState.simTimeSec || toAbsSec(nowUtcSec())) - 300);
        simState.lastTs = null;
        _applySimTime();
    });
    document.getElementById('lm-alt-next')?.addEventListener('click', () => {
        simState.simTimeSec = Math.min(simState._endSec || 140400, (simState.simTimeSec || toAbsSec(nowUtcSec())) + 300);
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
        _setSimSpeed(parseInt(e.target.value, 10) || 20);
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
        onSimulationRequest: (flight) => openSimPreviewModal(flight)
    });
    queue.setFlights(state.flights);
    queue.setConflicts(state.conflicts);

    // 합류점 통과 시간표 / 분리간격 요약
    waypointTable = new WaypointTimeTable(document.getElementById('waypoint-table-body'), {
        onFlightSelect: (flightId) => {
            const f = state.flights.find(fl => fl.id === flightId);
            if (f) onFlightSelect(f);
        }
    });
    waypointTable.setFlights(state.flights);

    separationSummary = new SeparationSummary(document.getElementById('separation-body'), {
        onFlightSelect: (flightId) => {
            const f = state.flights.find(fl => fl.id === flightId);
            if (f) onFlightSelect(f);
        },
        onPairSelect: (f1Id, f2Id) => {
            // 미니맵에 두 항공편 하이라이트
            miniMap.highlightPair(f1Id, f2Id);
            popupMap?.highlightPair(f1Id, f2Id);
        }
    });
    separationSummary.setFlights(state.flights);

    conflictWizard = new ConflictWizard();
    conflictWizard.setFlights(state.flights);

    settingsModal = new SettingsModal({
        onExcelImport: handleExcelImport,
        onExcelExport: handleExcelExport
    });

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
    setupSplitter();
    setupVSplitter();
    setupBpSplitter();
    setupSepInnerSplitter();
    setupSimEvents(); // 시뮬레이션 슬라이더/속도 리스너 1회만 등록
    window.addEventListener('resize', debounce(resizeCanvas, 150));

    // 첫 방문 코치마크 (렌더 직후)
    requestAnimationFrame(showCoachmarks);
}

function resizeCanvas() {
    const wrap = document.getElementById('ribbon-wrap');
    const canvas = document.getElementById('ribbon-canvas');
    if (!wrap || !canvas) return;
    if (ribbon) {
        ribbon.resize();
        return;
    }
    // ribbon 초기화 전: clientWidth가 0이면 설정 스킵 (ribbon.resize()에서 재시도)
    const w = wrap.clientWidth;
    if (w > 0) canvas.width = w;
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
                <line x1="333"  y1="60" x2="333"  y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="430"  y1="60" x2="430"  y2="680" stroke="rgba(188,140,255,0.22)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="495"  y1="60" x2="495"  y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="624"  y1="60" x2="624"  y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="689"  y1="60" x2="689"  y2="680" stroke="rgba(57,197,187,0.22)"  stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="721"  y1="60" x2="721"  y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="818"  y1="60" x2="818"  y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="947"  y1="60" x2="947"  y2="680" stroke="rgba(210,153,34,0.22)"  stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="1076" y1="60" x2="1076" y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="1205" y1="60" x2="1205" y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="1334" y1="60" x2="1334" y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="1399" y1="60" x2="1399" y2="680" stroke="rgba(255,255,255,0.13)" stroke-width="1" stroke-dasharray="3,7"/>
                <line x1="1460" y1="60" x2="1460" y2="680" stroke="rgba(255,107,107,0.22)" stroke-width="1" stroke-dasharray="3,7"/>
            </g>

            <!-- 웨이포인트 (FL350 라인, y=134) -->
            <g id="live-map-alt-waypoints">
                <rect x="329" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="333"  y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">BULTI</text>
                <rect x="491" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="495"  y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">MEKIL</text>
                <rect x="620" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="624"  y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">GONAX</text>
                <rect x="717" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="721"  y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">BEDES</text>
                <rect x="814" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="818"  y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">ELPOS</text>
                <rect x="1072" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="1076" y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">MANGI</text>
                <rect x="1201" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="1205" y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">DALSU</text>
                <rect x="1330" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="1334" y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">NULDI</text>
                <rect x="1395" y="134" width="8" height="8" fill="#ffd700" opacity="0.65"/><text x="1399" y="129" text-anchor="middle" fill="#ffd700" font-size="9" font-family="monospace" opacity="0.85">DOTOL</text>
            </g>

            <!-- 공항 (지상선 y=680, 레이블 y=703) -->
            <g id="live-map-alt-airports">
                <circle cx="140"  cy="680" r="12" fill="#58a6ff" opacity="0.85"/><text x="140"  y="703" text-anchor="middle" fill="#d8e9ff" font-size="11" font-family="monospace" font-weight="bold">RKSS</text>
                <circle cx="430"  cy="680" r="12" fill="#bc8cff" opacity="0.85"/><text x="430"  y="703" text-anchor="middle" fill="#f0dcff" font-size="11" font-family="monospace" font-weight="bold">RKTU</text>
                <circle cx="689"  cy="680" r="12" fill="#39c5bb" opacity="0.85"/><text x="689"  y="703" text-anchor="middle" fill="#c9f6f1" font-size="11" font-family="monospace" font-weight="bold">RKJK</text>
                <circle cx="947"  cy="680" r="12" fill="#d29922" opacity="0.85"/><text x="947"  y="703" text-anchor="middle" fill="#ffe2a4" font-size="11" font-family="monospace" font-weight="bold">RKJJ</text>
                <circle cx="1460" cy="680" r="12" fill="#ff6b6b" opacity="0.85"/><text x="1460" y="703" text-anchor="middle" fill="#ffd3d3" font-size="11" font-family="monospace" font-weight="bold">RKPC</text>
            </g>

            <!-- 위도 축 (x축) -->
            <g id="live-map-alt-lataxis">
                <line x1="0" y1="740" x2="1600" y2="740" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>
                <text x="50" y="768" text-anchor="end" fill="rgba(255,255,255,0.30)" font-size="9" font-family="monospace">LAT</text>
                <!-- 공항 위도 -->
                <text x="140"  y="768" text-anchor="middle" fill="rgba(88,166,255,0.78)"  font-size="9" font-family="monospace">37.6°N</text>
                <text x="430"  y="768" text-anchor="middle" fill="rgba(188,140,255,0.78)" font-size="9" font-family="monospace">36.7°N</text>
                <text x="689"  y="768" text-anchor="middle" fill="rgba(57,197,187,0.78)"  font-size="9" font-family="monospace">35.9°N</text>
                <text x="947"  y="768" text-anchor="middle" fill="rgba(210,153,34,0.78)"  font-size="9" font-family="monospace">35.1°N</text>
                <text x="1460" y="768" text-anchor="middle" fill="rgba(255,107,107,0.78)" font-size="9" font-family="monospace">33.5°N</text>
                <!-- 웨이포인트 위도 -->
                <text x="333"  y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">37.0°N</text>
                <text x="495"  y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">36.5°N</text>
                <text x="624"  y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">36.1°N</text>
                <text x="721"  y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">35.8°N</text>
                <text x="818"  y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">35.5°N</text>
                <text x="1076" y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">34.7°N</text>
                <text x="1205" y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">34.3°N</text>
                <text x="1334" y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">33.9°N</text>
                <text x="1399" y="768" text-anchor="middle" fill="rgba(255,215,0,0.55)" font-size="9" font-family="monospace">33.7°N</text>
            </g>

            <g id="live-map-alt-aircraft"></g>
        </svg>`;
    wrap.dataset.ready = '1';
}

function _computeAltMapAircraftPos(f, sec) {
    const isAtd = !!f.atd;
    // ATD = 실제 이륙시각, CTOT = gate departure → 실제 이륙 = CTOT + groundTimeSec
    const rawDepSec = toAbsSec(timeToSec(f.atd || f.ctot || f.eobt));
    const groundAdj = isAtd ? 0 : (f.groundTimeSec || 0);
    const depSec = rawDepSec + groundAdj;
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
    const cruiseY = _flToY(fl);
    const groundY = dep.y;
    // 출발 → 첫 번째 웨이포인트 구간에서 순항고도까지 상승, 이후 순항
    const firstWpSec = wp[0].t;
    const climbDuration = firstWpSec - depSec;
    const climb = climbDuration > 0
        ? Math.max(0, Math.min(1, (sec - depSec) / climbDuration))
        : 1;
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
        const isUrgent   = !isConflict && !isWarning && diffMin <= 3;
        const color      = isConflict ? '#ff4444' : (isWarning ? '#ffaa00' : isUrgent ? '#ff2d55' : '#ff8c00');
        const lineColor  = isConflict ? '#ff4444' : (isWarning ? '#ffaa00' : isUrgent ? '#ff2d55' : '#ff8c00');

        // 분리선 y: 두 항공기 중 위쪽(y 작은) 것보다 20px 위
        const lineY = Math.min(pA.y, pB.y) - 20;
        const midX  = (pA.x + pB.x) / 2;
        const label = `${isConflict ? '⚠ ' : ''}${diffMin}분`;
        const lblW  = label.length * 7 + 12;

        lines.push(`
            <line x1="${pA.x.toFixed(1)}" y1="${lineY.toFixed(1)}"
                  x2="${pB.x.toFixed(1)}" y2="${lineY.toFixed(1)}"
                  stroke="${lineColor}" stroke-width="1.8" stroke-dasharray="6,3" opacity="1"/>
            <line x1="${pA.x.toFixed(1)}" y1="${(lineY-6).toFixed(1)}"
                  x2="${pA.x.toFixed(1)}" y2="${(lineY+6).toFixed(1)}"
                  stroke="${lineColor}" stroke-width="2" opacity="1"/>
            <line x1="${pB.x.toFixed(1)}" y1="${(lineY-6).toFixed(1)}"
                  x2="${pB.x.toFixed(1)}" y2="${(lineY+6).toFixed(1)}"
                  stroke="${lineColor}" stroke-width="2" opacity="1"/>
            <rect x="${(midX - lblW/2).toFixed(1)}" y="${(lineY-16).toFixed(1)}"
                  width="${lblW.toFixed(1)}" height="14" rx="3"
                  fill="#0d1117" stroke="${lineColor}" stroke-width="1"/>
            <text x="${midX.toFixed(1)}" y="${(lineY-5).toFixed(1)}"
                  text-anchor="middle" fill="${color}"
                  font-size="11" font-family="monospace" font-weight="bold">${escapeHtml(label)}</text>
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
    waypointTable?.setFlights(state.flights);
    separationSummary?.setFlights(state.flights);
    conflictWizard.setFlights(state.flights);
    updateBadges();
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
    waypointTable?.setFlights(state.flights);
    separationSummary?.setFlights(state.flights);
    conflictWizard.setFlights(state.flights);
    updateBadges();
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
            <button class="help-tab active" data-tab="start">시작하기</button>
            <button class="help-tab" data-tab="features">주요 기능</button>
            <button class="help-tab" data-tab="terms">약어·색상</button>
            <button class="help-tab" data-tab="keys">단축키</button>
        </div>
        <div class="help-content">

            <!-- ① 시작하기 -->
            <div class="help-pane" id="help-pane-start">
                <h3>화면 구성</h3>
                <table class="shortcut-table">
                    <tr><td><strong>Time Ribbon</strong></td><td>상단 좌측 — 시간축 위의 항공편 막대. 드래그하면 ATD가 즉시 변경됩니다.</td></tr>
                    <tr><td><strong>Departure Queue</strong></td><td>하단 좌측 — 현재 시각 기준 NOW+3시간 이내 출발 예정편 목록. 카드를 클릭하면 Inspector가 열립니다.</td></tr>
                    <tr><td><strong>Conflict Watchlist</strong></td><td>하단 좌측 — 분리 위반이 감지된 항공편 쌍 목록. 실시간으로 갱신됩니다.</td></tr>
                    <tr><td><strong>MiniMap</strong></td><td>우측 — 공항·웨이포인트·항공기 위치를 지도에 표시합니다. 항공기를 클릭하면 Inspector가 열립니다.</td></tr>
                    <tr><td><strong>Inspector</strong></td><td>팝업 — 선택한 항공편의 상세 정보와 ATD 조정 입력창.</td></tr>
                </table>

                <h3 style="margin-top:14px">ATD 발부 — 3단계</h3>
                <ol style="line-height:2">
                    <li>Departure Queue에서 항공편 카드를 <strong>클릭</strong>하거나, Time Ribbon의 막대를 <strong>더블클릭</strong>합니다.</li>
                    <li>Inspector에서 <strong>NOW</strong>(현재시각), <strong>±1분</strong> 버튼, 또는 <strong>HH:MM 직접 입력</strong> 후 Enter로 ATD를 확정합니다.</li>
                    <li>확정 직후 <strong>실행 취소(Undo)</strong>가 가능합니다. 헤더의 ↶ 버튼 또는 Ctrl+Z를 누르세요.</li>
                </ol>

                <h3 style="margin-top:14px">충돌 해결 — 3단계</h3>
                <ol style="line-height:2">
                    <li>헤더 <strong>"충돌 N"</strong> 배지 또는 화면 상단 Alert Bar에 빨간 경고가 표시됩니다.</li>
                    <li>배지·경고를 클릭하면 <strong>ConflictWizard</strong>가 열립니다. 옵션(A~D)에 마우스를 올리면 Time Ribbon에서 변경 결과를 미리 볼 수 있습니다.</li>
                    <li>옵션을 클릭하거나 키보드 <kbd>A</kbd>~<kbd>D</kbd>를 눌러 확정합니다.</li>
                </ol>
            </div>

            <!-- ② 주요 기능 -->
            <div class="help-pane hidden" id="help-pane-features">
                <h3>헤더 배지</h3>
                <table class="shortcut-table">
                    <tr><td><strong>충돌 N</strong></td><td>현재 분리 위반 건수. 클릭하면 Conflict Watchlist 첫 항목으로 포커스됩니다.</td></tr>
                    <tr><td><strong>SET NOW</strong></td><td>가장 최근에 NOW로 ATD를 발부한 기준편 표시.</td></tr>
                    <tr><td><strong>WHAT-IF</strong></td><td>가상 시나리오 모드 토글. 활성화 시 변경 사항이 실제로 저장되지 않습니다.</td></tr>
                </table>

                <h3 style="margin-top:14px">헤더 버튼</h3>
                <table class="shortcut-table">
                    <tr><td><strong>↶ (Undo)</strong></td><td>직전 ATD 변경을 되돌립니다. 회색이면 되돌릴 내역이 없습니다.</td></tr>
                    <tr><td><strong>▶ 시뮬레이션</strong></td><td>시간을 앞뒤로 재생해 항공기 흐름을 확인합니다. 속도 1×~30× 선택 가능.</td></tr>
                    <tr><td><strong>엑셀 임포트</strong></td><td>.xlsx 파일을 불러와 항공편을 화면에 로드합니다. (새로고침 시 초기화 — 영구 저장은 메인 시스템 사용)</td></tr>
                    <tr><td><strong>항공기 익스포트</strong></td><td>현재 표시된 항공편 목록을 .xlsx 파일로 저장합니다.</td></tr>
                    <tr><td><strong>↗ 스케줄</strong></td><td>메인 스케줄 시스템을 새 탭으로 엽니다.</td></tr>
                    <tr><td><strong>📋 Audit</strong></td><td>ATD 변경 이력을 시간순으로 표시합니다. 변경 사유와 담당자를 확인할 수 있습니다.</td></tr>
                    <tr><td><strong>⚙ 설정</strong></td><td>공항별 분리 간격 등 CTOT 계산 파라미터를 조정합니다.</td></tr>
                </table>

                <h3 style="margin-top:14px">MiniMap 뷰 전환</h3>
                <table class="shortcut-table">
                    <tr><td><strong>지도 뷰 (기본)</strong></td><td>공항·웨이포인트를 지리좌표 기반으로 표시합니다.</td></tr>
                    <tr><td><strong>ALT 버튼</strong></td><td>고도 기반 뷰로 전환합니다. 항공기 간 수직 분리를 확인할 수 있습니다.</td></tr>
                    <tr><td><strong>⛶ (팝업)</strong></td><td>Live Route Map을 별도 창으로 엽니다.</td></tr>
                    <tr><td><strong>+/−/⟲</strong></td><td>지도 확대·축소·전체 보기. 마우스 휠로도 조작 가능합니다.</td></tr>
                </table>
            </div>

            <!-- ③ 약어·색상 -->
            <div class="help-pane hidden" id="help-pane-terms">
                <h3>약어</h3>
                <table class="shortcut-table">
                    <tr><td><strong>EOBT</strong></td><td>예상 출발 블록 시각 (Estimated Off-Block Time) — 항공사가 제출한 계획 시각</td></tr>
                    <tr><td><strong>CTOT</strong></td><td>산출 이륙 시각 (Calculated Take-Off Time) — 분리 간격을 고려해 시스템이 계산한 시각</td></tr>
                    <tr><td><strong>ATD</strong></td><td>실제 출발 시각 (Actual Take-off Departure) — 관제사가 발부한 실제 이륙 시각</td></tr>
                    <tr><td><strong>CFL</strong></td><td>허가 비행고도 (Cleared Flight Level)</td></tr>
                    <tr><td><strong>SCH</strong></td><td>예정 (Scheduled) — 아직 출발하지 않은 상태</td></tr>
                    <tr><td><strong>DEP</strong></td><td>출발 완료 (Departed) — ATD가 발부되어 이미 출발한 편</td></tr>
                </table>

                <h3 style="margin-top:14px">공항 색상</h3>
                <table class="shortcut-table">
                    <tr><td><span style="color:#58a6ff;font-size:18px">■</span> <strong>RKSS</strong></td><td>김포국제공항 — 파랑</td></tr>
                    <tr><td><span style="color:#bc8cff;font-size:18px">■</span> <strong>RKTU</strong></td><td>청주국제공항 — 보라</td></tr>
                    <tr><td><span style="color:#39c5bb;font-size:18px">■</span> <strong>RKJK</strong></td><td>군산공항 — 청록</td></tr>
                    <tr><td><span style="color:#d29922;font-size:18px">■</span> <strong>RKJJ</strong></td><td>광주공항 — 황금</td></tr>
                    <tr><td><span style="color:#ff6b6b;font-size:18px">■</span> <strong>RKPC</strong></td><td>제주국제공항 — 빨강</td></tr>
                </table>
            </div>

            <!-- ④ 단축키 -->
            <div class="help-pane hidden" id="help-pane-keys">
                <h3>전역</h3>
                <table class="shortcut-table">
                    <tr><td><kbd>?</kbd></td><td>도움말 열기</td></tr>
                    <tr><td><kbd>ESC</kbd></td><td>열린 모달 / Inspector / 시뮬레이션 닫기</td></tr>
                    <tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>⌘</kbd>+<kbd>Z</kbd></td><td>ATD 변경 되돌리기 (Undo)</td></tr>
                    <tr><td><kbd>Ctrl</kbd>+<kbd>0</kbd></td><td>Time Ribbon을 현재 시각으로 스크롤 복귀</td></tr>
                </table>

                <h3 style="margin-top:14px">Inspector (항공편 상세 팝업)</h3>
                <table class="shortcut-table">
                    <tr><td><kbd>Enter</kbd></td><td>SET NOW — 현재 시각으로 ATD 즉시 발부</td></tr>
                    <tr><td><kbd>↑</kbd> / <kbd>↓</kbd></td><td>ATD ±1분 조정</td></tr>
                    <tr><td><kbd>Shift</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd></td><td>ATD ±5분 조정</td></tr>
                    <tr><td><kbd>Enter</kbd> <span style="color:#7a8a9a">(HH:MM 입력 후)</span></td><td>직접 입력한 시각으로 ATD 확정</td></tr>
                    <tr><td><kbd>ESC</kbd></td><td>Inspector 닫기</td></tr>
                </table>

                <h3 style="margin-top:14px">ConflictWizard (충돌 해결)</h3>
                <table class="shortcut-table">
                    <tr><td><kbd>A</kbd> / <kbd>B</kbd></td><td>후행편 / 선행편 ATD 조정 옵션 선택</td></tr>
                    <tr><td><kbd>C</kbd></td><td>항로·고도 변경 (시스템 외부 조정)</td></tr>
                    <tr><td><kbd>D</kbd></td><td>수동 수용 (현재 상태 유지)</td></tr>
                    <tr><td><kbd>Enter</kbd></td><td>A 옵션 즉시 선택</td></tr>
                </table>

                <h3 style="margin-top:14px">Conflict Watchlist</h3>
                <table class="shortcut-table">
                    <tr><td><kbd>J</kbd> / <kbd>↓</kbd></td><td>다음 항목으로 이동</td></tr>
                    <tr><td><kbd>K</kbd> / <kbd>↑</kbd></td><td>이전 항목으로 이동</td></tr>
                    <tr><td><kbd>Enter</kbd></td><td>선택 항목 ConflictWizard 진입</td></tr>
                    <tr><td><kbd>Space</kbd></td><td>Ack — 인지 처리 (경고 억제)</td></tr>
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
        waypointTable?.setFlights(state.flights);
        separationSummary?.setFlights(state.flights);
        conflictWizard.setFlights(state.flights);
        updateBadges();
    });

    // sim:request 이벤트 (Toast SIM 버튼에서 발행)
    document.addEventListener('sim:request', (e) => {
        const { flight } = e.detail;
        if (flight) openSimPreviewModal(flight);
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
        waypointTable?.setFlights(state.flights);
        separationSummary?.setFlights(state.flights);
        conflictWizard.setFlights(state.flights);

        // 펄스 + diff 라벨
        (diffs || []).forEach(d => {
            ribbon.pulseFlight(d.flightId);
            ribbon.setCtotDelta(d.flightId, d.deltaMins);
        });

        // Audit
        if (auditEntry) audit.addEntry(auditEntry);

        // Inspector 갱신
        if (inspector.flight) {
            const updated = state.flights.find(f => f.id === inspector.flight.id);
            if (updated) inspector.setFlight(updated);
        }

        updateBadges();
        updateUndoButton();
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
        if (e.target.id === 'btn-settings') settingsModal.open();
        if (e.target.id === 'btn-help') openHelpModal();
        if (e.target.id === 'btn-undo') handleUndo();
        if (e.target.id === 'btn-reset-state') resetState();
        if (e.target.id === 'sim-play') toggleSimPlay();
        if (e.target.id === 'sim-close') closeSimulation();
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
// 시뮬레이션 MVP (P0-5)
// ============================================================
const simState = {
    playing: false,
    simTimeSec: 0,
    speed: 20,
    rafId: null,
    lastTs: null,
    _realNowSec: 0,
    _startSec: 0,
    _endSec: 0,
    targetFlightId: null,
};

function _setSimSpeed(nextSpeed) {
    const speed = Number.isFinite(nextSpeed) ? nextSpeed : 20;
    simState.speed = speed;

    const mainSpeed = document.getElementById('sim-speed');
    if (mainSpeed) mainSpeed.value = String(speed);

    const liveMapSpeed = document.getElementById('lm-alt-speed');
    if (liveMapSpeed) liveMapSpeed.value = String(speed);
}

// 슬라이더/속도 리스너는 DOM 생성 후 1회만 등록 (renderApp 이후 setupSimEvents 호출)
function setupSimEvents() {
    const slider = document.getElementById('sim-slider');
    slider?.addEventListener('input', () => {
        simState.simTimeSec = parseInt(slider.value, 10);
        simState.lastTs = null;
        _applySimTime();
    });
    document.getElementById('sim-speed')?.addEventListener('change', (e) => {
        _setSimSpeed(parseInt(e.target.value, 10) || 20);
    });

    // 렌더 시점에 메인/루트맵 속도 선택값을 현재 시뮬레이션 속도와 동기화
    _setSimSpeed(simState.speed);
}

function _initSimSlider() {
    const slider = document.getElementById('sim-slider');
    if (!slider) return;
    const times = state.flights
        .map(f => toAbsSec(timeToSec(f.ctot || f.eobt)))
        .filter(t => t > 0);
    const startSec = times.length ? Math.min(...times) : toAbsSec(nowUtcSec());
    const endSec   = times.length ? Math.max(...times) + 70 * 60 : startSec + 2 * 3600;
    simState._startSec  = startSec;
    simState._endSec    = endSec;
    simState.simTimeSec = toAbsSec(nowUtcSec());
    slider.min   = startSec;
    slider.max   = endSec;
    slider.value = toAbsSec(nowUtcSec());
}

function closeSimulation() {
    if (!simState.playing && !ribbon._simTimeSec) return;
    _stopSimLoop();
    document.getElementById('sim-play').textContent = '▶';
    ribbon.clearSimTime();
    miniMap.clearSimPositions();
    popupMap?.clearSimPositions();
    simState.simTimeSec = toAbsSec(nowUtcSec());
    simState.targetFlightId = null;
}

function resetState() {
    openConfirmModal({
        title: '전체 초기화',
        message: 'ATD 확정, CTOT 수동 조정, 시뮬레이션이 모두 초기화됩니다.\nEOBT 기준으로 CTOT가 재계산됩니다. 계속하시겠습니까?',
        onConfirm: _doReset
    });
}

function _doReset() {
    // 1. 시뮬레이션 중단
    _stopSimLoop();
    document.getElementById('sim-play').textContent = '▶';
    ribbon.clearSimTime();
    miniMap.clearSimPositions();
    popupMap?.clearSimPositions();
    simState.simTimeSec = toAbsSec(nowUtcSec());
    simState.targetFlightId = null;

    // 2. 항공편별 수동 입력값 제거 → EOBT 기준 재계산
    state.flights = state.flights.map(f => {
        const clean = { ...f };
        delete clean.atd;
        delete clean.ctot;
        delete clean.ctotFloor;
        if (clean.status === 'DEP') delete clean.status;
        return clean;
    });
    state.flights = recalcAll(state.flights);
    state.prevFlights = state.flights.map(f => ({ ...f }));

    // 3. 앱 상태 초기화
    state.setNowTarget = null;
    state.conflictArmed = false;
    state.auditLog = [];
    _recomputeConflicts();

    // 4. Undo 스택 비우기
    clearUndoStack();

    // 5. UI 전체 갱신
    ribbon.setFlights(state.flights);
    ribbon.setConflicts(state.conflicts);
    miniMap.setFlights(state.flights);
    miniMap.setConflicts(state.conflicts);
    popupMap?.setFlights(state.flights);
    popupMap?.setConflicts(state.conflicts);
    queue.setFlights(state.flights);
    queue.setConflicts(state.conflicts);
    waypointTable?.setFlights(state.flights);
    separationSummary?.setFlights(state.flights);
    conflictWizard.setFlights(state.flights);
    updateBadges();
    updateUndoButton();

    // 6. 서버 메모리 리셋 (실패해도 무시)
    apiDelete('/api/v2/reset').catch(e => console.warn('서버 리셋 실패:', e.message));

    showToast('전체 초기화 완료 — CTOT가 EOBT 기준으로 재계산되었습니다', 'success');
}

function toggleSimPlay() {
    if (simState.playing) {
        _stopSimLoop();
        document.getElementById('sim-play').textContent = '▶';
    } else {
        const slider = document.getElementById('sim-slider');
        simState.simTimeSec = slider ? parseInt(slider.value, 10) : toAbsSec(nowUtcSec());
        simState.lastTs = null;
        simState.rafId = requestAnimationFrame(_simLoop);
        simState.playing = true;
        document.getElementById('sim-play').textContent = '⏸';
    }
}

// 시뮬레이션 미리보기 모달
function openSimPreviewModal(flight) {
    if (document.getElementById('sim-preview-modal')) return;

    const ctotSec = toAbsSec(timeToSec(flight.ctot || flight.eobt));
    const nowSec = toAbsSec(nowUtcSec());

    const overlay = document.createElement('div');
    overlay.id = 'sim-preview-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
    <div class="modal-box" style="width:380px">
        <div class="modal-header">
            <span>시뮬레이션 미리보기</span>
            <button class="modal-close" id="sim-modal-close">×</button>
        </div>
        <div class="modal-body" style="padding:16px">
            <div style="margin-bottom:12px;color:var(--accent);font-weight:bold">${escapeHtml(flight.callsign)} (${flight.dept})</div>
            <div class="sim-options" style="display:flex;flex-direction:column;gap:10px">
                <label class="sim-option" style="display:flex;align-items:center;gap:8px;cursor:pointer">
                    <input type="radio" name="sim-start" value="now" checked>
                    <span>현재 시각 기준 (${secToTime(nowSec)}Z)</span>
                </label>
                <label class="sim-option" style="display:flex;align-items:center;gap:8px;cursor:pointer">
                    <input type="radio" name="sim-start" value="ctot">
                    <span>CTOT 기준 (${secToTime(ctotSec)}Z - 5분 전부터)</span>
                </label>
            </div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border)">
            <button class="btn-wiz-cancel" id="sim-cancel">취소</button>
            <button class="btn-wiz-ok" id="sim-start-btn">▶ 시작</button>
        </div>
    </div>`;

    document.body.appendChild(overlay);

    const close = () => {
        document.removeEventListener('keydown', handleEsc);
        overlay.remove();
    };
    const handleEsc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', handleEsc);

    overlay.querySelector('#sim-modal-close').addEventListener('click', close);
    overlay.querySelector('#sim-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#sim-start-btn').addEventListener('click', () => {
        const selected = overlay.querySelector('input[name="sim-start"]:checked').value;
        const startSec = selected === 'ctot' ? Math.max(0, ctotSec - 300) : nowSec;
        simState.targetFlightId = flight.id;
        close();
        startSimulationAt(startSec);
    });
}

// 특정 시점부터 시뮬레이션 시작
function startSimulationAt(startSec) {
    const slider = document.getElementById('sim-slider');
    if (slider) {
        // 슬라이더 범위 확장 (필요 시)
        if (startSec < parseInt(slider.min)) slider.min = startSec - 300;
        if (startSec > parseInt(slider.max)) slider.max = startSec + 3600;
        slider.value = startSec;
    }
    simState.simTimeSec = startSec;
    simState.lastTs = null;
    _applySimTime();
    // 자동 재생 시작
    if (!simState.playing) {
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
        const endSec = simState._endSec || (simState._realNowSec + 7200);
        const dt = (ts - simState.lastTs) / 1000;
        simState.simTimeSec = Math.min(endSec, simState.simTimeSec + dt * simState.speed);
        if (simState.simTimeSec >= endSec) {
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
    miniMap.setSimPositions(computeSimPositions(state.flights, sec, simState.targetFlightId));
    popupMap?.setSimPositions(computeSimPositions(state.flights, sec, simState.targetFlightId));
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
    // #app 내부의 sim-bar 바로 뒤에 삽입
    const app = document.getElementById('app');
    const simBar = document.getElementById('sim-bar');
    if (simBar && app) {
        app.insertBefore(banner, simBar.nextSibling);
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
    waypointTable?.setFlights(state.flights);
    separationSummary?.setFlights(state.flights);
    document.getElementById('badge-whatif')?.classList.remove('active');
    document.body.classList.remove('whatif-mode');
    showWhatifBanner(false);
    saveUiPref('whatifActive', false);
    updateBadges();
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
    waypointTable?.setFlights(state.flights);
    separationSummary?.setFlights(state.flights);
    conflictWizard.setFlights(state.flights);
    document.getElementById('badge-whatif')?.classList.remove('active');
    document.body.classList.remove('whatif-mode');
    showWhatifBanner(false);
    saveUiPref('whatifActive', false);
    updateBadges();
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
        const t = state.setNowTarget || _getDefaultSetNowTarget();
        if (!t?.callsign) {
            bs.textContent = 'SET NOW 미지정';
            return;
        }
        if (t.atd) {
            const timeTxt = `${String(t.atd).slice(0, 2)}:${String(t.atd).slice(2)}Z`;
            bs.textContent = `SET NOW ${t.callsign} · ${t.dept} · ${timeTxt}`;
            return;
        }
        const eobtTxt = t.eobt ? `${String(t.eobt).slice(0, 2)}:${String(t.eobt).slice(2)}Z` : '--:--Z';
        bs.textContent = `SET NOW 기본 ${t.callsign} · ${t.dept} · EOBT ${eobtTxt}`;
    }
}

// ============================================================
// 시계
// ============================================================
function startClock() {
    if (_clockTimer) clearInterval(_clockTimer);
    const el = document.getElementById('clock');
    // KST 날짜(UTC+9) 기준으로 변경 감지 — UTC 15:00 = KST 00:00
    let _lastKstDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    let _refreshCountdown = FLIGHT_REFRESH_MS;
    let _mapUpdateCountdown = 10000;
    _clockTimer = setInterval(() => {
        if (el) el.textContent = formatHHMMSS() + 'Z';
        const kstDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
        if (kstDate !== _lastKstDate) {
            _lastKstDate = kstDate;
            reloadFlightsForNewDay();
            _refreshCountdown = FLIGHT_REFRESH_MS;
        }
        // 주기적 DB 재조회 (시뮬레이션 중 제외)
        _refreshCountdown -= 1000;
        if (_refreshCountdown <= 0 && !simState.playing) {
            _refreshCountdown = FLIGHT_REFRESH_MS;
            reloadFlightsForNewDay().then(() => {
                const syncEl = document.getElementById('refresh-ts');
                if (syncEl) syncEl.textContent = 'SYNC ' + nowUtcTime().slice(0, 5);
            });
        }
        // 실시간 모드: 슬라이더, 시간 표시 갱신
        if (!simState.playing) {
            const sec = toAbsSec(nowUtcSec());
            const slider = document.getElementById('sim-slider');
            if (slider) slider.value = sec;
            const disp = document.getElementById('sim-time-display');
            if (disp) disp.textContent = secToTime(sec) + 'Z';
            // ATD 항공기 위치 미니맵 반영 (10초마다)
            _mapUpdateCountdown -= 1000;
            if (_mapUpdateCountdown <= 0) {
                _mapUpdateCountdown = 10000;
                const dots = computeSimPositions(state.flights, sec, null);
                miniMap.setSimPositions(dots);
                popupMap?.setSimPositions(dots);
            }
        }
    }, 1000);
}

async function reloadFlightsForNewDay() {
    showToast('날짜가 변경되었습니다. 항공편 목록을 갱신합니다...', 'info');
    try {
        // Oracle에 아직 없는 로컬 ATD를 재조회 후 복원하기 위해 미리 저장
        const localAtdMap = new Map();
        for (const f of state.flights) {
            if (f.atd) localAtdMap.set(f.id, f.atd);
        }

        const res = await apiGet('/api/v2/flights/today');
        const freshData = res.data || [];

        // Oracle에 ATD가 없는 항공기에 로컬 ATD 복원
        for (const raw of freshData) {
            if (!raw.atd && localAtdMap.has(raw.id)) {
                raw.atd = localAtdMap.get(raw.id);
                raw.status = 'DEP';
            }
        }

        state.flights = recalcAll(freshData);
        state.prevFlights = state.flights.map(f => ({ ...f }));
        _recomputeConflicts();
        state.whatifEngine = new WhatifEngine(state.flights);
        initAtdManager(state);
        ribbon.setFlights(state.flights);
        ribbon.setConflicts(state.conflicts);
        miniMap.setFlights(state.flights);
        miniMap.setConflicts(state.conflicts);
        popupMap?.setFlights(state.flights);
        popupMap?.setConflicts(state.conflicts);
        queue.setFlights(state.flights);
        queue.setConflicts(state.conflicts);
        waypointTable?.setFlights(state.flights);
        separationSummary?.setFlights(state.flights);
        conflictWizard.setFlights(state.flights);
        updateBadges();
        showToast('항공편 목록이 갱신되었습니다', 'success');
    } catch (err) {
        showToast('항공편 갱신 실패 — 수동 새로고침 필요', 'error');
    }
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
    if (prefs.queueW) {
        document.documentElement.style.setProperty('--queue-w', `${prefs.queueW}px`);
    }
    if (prefs.wttH) {
        document.documentElement.style.setProperty('--wtt-h', `${prefs.wttH}px`);
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
            resizeCanvas();
        }
        dragging = false;
        document.body.style.userSelect = '';
    });

    vSplitter.addEventListener('dblclick', () => {
        document.documentElement.style.setProperty('--right-w', '380px');
        saveUiPref('rightW', 380);
        resizeCanvas();
    });
}

function setupBpSplitter() {
    const splitter = document.getElementById('bp-splitter');
    if (!splitter) return;
    let dragging = false, startX = 0, startW = 0;

    splitter.addEventListener('mousedown', (e) => {
        dragging = true;
        startX = e.clientX;
        startW = document.getElementById('queue-section')?.getBoundingClientRect().width || 400;
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const panel = document.getElementById('bottom-panel');
        if (!panel) return;
        const panelW = panel.getBoundingClientRect().width;
        const dx = e.clientX - startX;
        const newW = Math.max(180, Math.min(panelW - 186, startW + dx));
        document.documentElement.style.setProperty('--queue-w', `${newW}px`);
        saveUiPref('queueW', newW);
    });

    document.addEventListener('mouseup', () => {
        dragging = false;
        document.body.style.userSelect = '';
    });

    splitter.addEventListener('dblclick', () => {
        const panel = document.getElementById('bottom-panel');
        const panelW = panel?.getBoundingClientRect().width || 800;
        const defaultW = Math.floor(panelW * 0.6);
        document.documentElement.style.setProperty('--queue-w', `${defaultW}px`);
        saveUiPref('queueW', defaultW);
    });
}

function setupSepInnerSplitter() {
    const splitter = document.getElementById('sep-inner-splitter');
    if (!splitter) return;
    let dragging = false, startY = 0, startH = 0;

    splitter.addEventListener('mousedown', (e) => {
        dragging = true;
        startY = e.clientY;
        startH = document.getElementById('waypoint-table-body')?.getBoundingClientRect().height || 180;
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const section = document.getElementById('separation-section');
        if (!section) return;
        const sectionH = section.getBoundingClientRect().height;
        const dy = e.clientY - startY;
        // 최소 80px, 최대 섹션 높이의 70%
        const newH = Math.max(80, Math.min(sectionH * 0.7, startH + dy));
        document.documentElement.style.setProperty('--wtt-h', `${newH}px`);
        saveUiPref('wttH', newH);
    });

    document.addEventListener('mouseup', () => {
        dragging = false;
        document.body.style.userSelect = '';
    });

    splitter.addEventListener('dblclick', () => {
        // 기본값 180px로 복원
        document.documentElement.style.setProperty('--wtt-h', '180px');
        saveUiPref('wttH', 180);
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
