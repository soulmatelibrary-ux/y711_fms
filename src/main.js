// ============================================
// GLOBAL STATE & DATA
// ============================================
let allFlights = [];
let simInterval = null;
let simTimeSeconds = 14 * 3600;
let simSpeed = 1;
let separationInterval = 120; // Seconds

// Filter & Config State
let currentCFLFilter = "ALL";
let lookbackWindow = 60; // Minutes to show in past (60, 120, 180 or Infinity for ALL)

let segmentConfig = {
    'RKSS_ENTRY': 25, // to Merge Point
    'RKTU_ENTRY': 20,
    'RKJK_ENTRY': 15,
    'RKJJ_ENTRY': 10
};
let waypoints = [
    { from: 'Entry', to: 'GONAX', duration: 0 }, // Entry calculates arrival here
    { from: 'GONAX', to: 'ELPOS', duration: 15 },
    { from: 'ELPOS', to: 'DALSU', duration: 10 },
    { from: 'DALSU', to: 'KIDOS', duration: 12 }
];

// 정렬 상태
let isSortByCFL = false;

// DOM Elements
const els = {};

// 공항 정보
const airportDatabase = {
    'RKSS': { name: '김포', color: 'var(--gmp-color)', mergePoint: 'GONAX' },
    'RKTU': { name: '청주', color: 'var(--cjj-color)', mergePoint: 'GONAX' },
    'RKJK': { name: '군산', color: 'var(--kuv-color)', mergePoint: 'ELPOS' },
    'RKJJ': { name: '광주', color: 'var(--kwj-color)', mergePoint: 'DALSU' }
};

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== Y711 FMS 초기화 중 ===');
    cacheOMElements();
    setupEventListeners();
    initSettingsUI();

    // 1. 데이터 로드
    await loadScheduleData();

    // 2. 초기 렌더링
    renderFlightQueue();
    initTimeline();
    initFlightMap();

    // 3. 시뮬레이션 루프 시작
    updateSimulationUI();
});

function cacheOMElements() {
    els.simClock = document.getElementById('sim-clock');
    els.flightQueue = document.getElementById('flight-queue');

    // 컨트롤
    els.cflFilter = document.getElementById('cfl-filter-select');
    els.timeRangeFilter = document.getElementById('time-range-select');
    els.sepButtons = document.querySelectorAll('.btn-sep');
    els.calcBtn = document.getElementById('calc-ctot-btn');
    els.sortCflBtn = document.getElementById('sort-cfl-btn');

    els.playBtn = document.getElementById('play-btn');
    els.prevBtn = document.getElementById('prev-btn');
    els.nextBtn = document.getElementById('next-btn');
    els.speedSelect = document.getElementById('speed-select');

    els.timelineWrapper = document.getElementById('timelines-wrapper');
    els.timeAxis = document.querySelector('.time-axis');
    els.timeMarker = document.getElementById('time-marker');

    els.mapSvg = document.getElementById('flight-map-svg');

    // 설정 모달
    els.settingsModal = document.getElementById('settings-modal');
    els.saveSettingsBtn = document.getElementById('save-settings');
    els.addWaypointBtn = document.getElementById('add-waypoint-btn');
}

function setupEventListeners() {
    // 1. CFL 필터
    els.cflFilter.addEventListener('change', (e) => {
        currentCFLFilter = e.target.value;
        renderFlightQueue();
        updateCTOTs(0);
    });

    // 2. 시간 범위 필터 (과거 데이터 표시)
    if (els.timeRangeFilter) {
        els.timeRangeFilter.addEventListener('change', (e) => {
            const val = e.target.value;
            lookbackWindow = val === 'ALL' ? Infinity : parseInt(val);
            renderFlightQueue();
            renderTimelineFlights();
        });
    }

    // 3. 분리 간격 버튼 (1분, 2분, 3분, 4분)
    els.sepButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // UI 업데이트
            els.sepButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            // 로직 업데이트
            const min = parseInt(e.target.dataset.min);
            separationInterval = min * 60;
            updateCTOTs(0);
        });
    });

    // 정렬 버튼
    if (els.sortCflBtn) {
        els.sortCflBtn.addEventListener('click', toggleSortByCFL);
    }

    // CTOT 재계산 버튼
    els.calcBtn.addEventListener('click', () => updateCTOTs(0));

    // 시뮬레이션 컨트롤
    els.playBtn.addEventListener('click', togglePlay);
    els.prevBtn.addEventListener('click', () => jumpTime(-300));
    els.nextBtn.addEventListener('click', () => jumpTime(300));
    els.speedSelect.addEventListener('change', (e) => {
        simSpeed = parseInt(e.target.value);
    });

    // SortableJS 초기화
    if (typeof Sortable !== 'undefined') {
        Sortable.create(els.flightQueue, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            filter: 'input',
            preventOnFilter: false,
            onEnd: () => {
                updateCTOTs(0);
            }
        });
    }

    // 뷰 전환 & 설정
    document.getElementById('view-settings')?.addEventListener('click', () => {
        renderSettings();
        els.settingsModal.classList.remove('hidden');
    });
    document.getElementById('close-settings')?.addEventListener('click', () => {
        els.settingsModal.classList.add('hidden');
    });

    els.saveSettingsBtn.addEventListener('click', saveSettings);
    els.addWaypointBtn.addEventListener('click', addWaypointInput);
}

// ============================================
// DATA LOADING
// ============================================
async function loadScheduleData() {
    try {
        // jeju-schedule.json 파일 로드
        const response = await fetch('/mock/jeju-schedule.json');
        const data = await response.json();

        const mockFlights = [];

        // 현재 시뮬레이션 시간 (14:00)
        const currentHour = 14;
        const currentMinute = 0;
        const currentTimeSec = currentHour * 3600 + currentMinute * 60;

        data.flights.forEach((flight, index) => {
            // EOBT 파싱 (예: "15:30")
            const [hour, min] = flight.eobtKst.split(':').map(Number);
            const eobtSec = hour * 3600 + min * 60;

            // 고도 랜덤 할당 (FL140 ~ FL280)
            const altitude = 140 + Math.floor(Math.random() * 8) * 20;

            // 과거 비행 여부 판단 (EOBT < 현재 시간)
            let atd = null;
            if (eobtSec < currentTimeSec) {
                // 과거 비행은 ATD 설정 (EOBT와 동일하게 설정)
                atd = flight.eobtKst;
            }

            mockFlights.push({
                id: `F${1000 + index}`,
                callsign: flight.callsign,
                airport: flight.origin,
                dept: flight.origin,
                dest: flight.destination,
                type: flight.type,
                eobt: flight.eobtKst,
                atd: atd,
                ctot: flight.eobtKst,
                status: atd ? 'DEP' : 'SCH',
                duration: 50, // 기본 비행 시간
                altitude: altitude,
                cfl: `FL${altitude}`,
                routeWaypoints: []
            });
        });

        // EOBT 기준 정렬
        mockFlights.sort((a, b) => timeToSec(a.eobt) - timeToSec(b.eobt));
        allFlights = mockFlights;

        // 시뮬레이션 시작 시간 설정 (14:00)
        simTimeSeconds = currentTimeSec;

        console.log(`✅ ${allFlights.length}개의 비행 데이터 로드 완료`);
    } catch (error) {
        console.error('❌ 비행 데이터 로드 실패:', error);
        // 에러 발생 시 빈 배열로 초기화
        allFlights = [];
        simTimeSeconds = 14 * 3600;
    }
}

// ============================================
// LOGIC: SETTINGS UI
// ============================================
function initSettingsUI() {
    // Initial setup if needed
}

function renderSettings() {
    // 1. Entry Segments
    const entryContainer = document.getElementById('entry-segments-config');
    entryContainer.innerHTML = '';
    Object.keys(segmentConfig).forEach(key => {
        const div = document.createElement('div');
        div.className = 'input-item';
        div.innerHTML = `<span>${key} (Min)</span><input type="number" id="cfg-${key}" value="${segmentConfig[key]}">`;
        entryContainer.appendChild(div);
    });

    // 2. Waypoints
    const wpList = document.getElementById('waypoints-config-list');
    wpList.innerHTML = '';
    waypoints.forEach((wp, idx) => {
        const div = document.createElement('div');
        div.className = 'waypoint-list-item';
        div.innerHTML = `
            <input type="text" value="${wp.from}" data-idx="${idx}" data-field="from" placeholder="From">
            <input type="text" value="${wp.to}" data-idx="${idx}" data-field="to" placeholder="To">
            <input type="number" value="${wp.duration}" data-idx="${idx}" data-field="duration" placeholder="Min">
            <button class="btn-icon delete-wp" data-idx="${idx}" style="text-align:center;">🗑</button>
        `;
        wpList.appendChild(div);
    });

    // Delete Buttons
    document.querySelectorAll('.delete-wp').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            waypoints.splice(idx, 1);
            renderSettings();
        });
    });
}

function addWaypointInput() {
    waypoints.push({ from: '', to: '', duration: 10 });
    renderSettings();
}

function saveSettings() {
    // Save Entry Config
    Object.keys(segmentConfig).forEach(key => {
        const val = document.getElementById(`cfg-${key}`).value;
        segmentConfig[key] = parseInt(val);
    });

    // Save Waypoints
    const wpItems = document.querySelectorAll('.waypoint-list-item');
    const newWaypoints = [];
    wpItems.forEach(item => {
        const inputs = item.querySelectorAll('input');
        newWaypoints.push({
            from: inputs[0].value,
            to: inputs[1].value,
            duration: parseInt(inputs[2].value)
        });
    });
    waypoints = newWaypoints;

    alert('Configuration Saved!');
    els.settingsModal.classList.add('hidden');

    // Recalculate everything
    updateCTOTs(0);
}

// ============================================
// LOGIC: CTOT CALCULATION (Filtered & ATD Aware)
// ============================================
function updateCTOTs_OLD(startIndex = 0) {
    // 1. Filtered List 가져오기 (DOM 순서대로)
    const items = Array.from(els.flightQueue.children);

    // 화면에 보이는(Filter된) 항공기만 대상으로 계산
    const visibleItems = items.filter(item => item.style.display !== 'none');

    let prevTimeSec = -1;

    // Find previous flight in the *visible* list logic
    // (Simpler: just iterate visible items and chain them)

    for (let i = 0; i < visibleItems.length; i++) {
        const item = visibleItems[i];
        const id = item.dataset.id;
        const flight = allFlights.find(f => f.id === id);
        if (!flight) continue;

        const eobtSec = timeToSec(flight.eobt);
        let newCtotSec;

        // 1. 이미 이륙한 경우 (ATD 존재) -> 고정
        if (flight.atd) {
            newCtotSec = timeToSec(flight.atd);
            flight.ctot = flight.atd;
            prevTimeSec = newCtotSec;
            continue;
        }

        // 2. 이륙 전 (SCH)
        // Manual override check (only if triggered by specific item)
        // But here simpler logic: Standard Separation first

        if (prevTimeSec !== -1) {
            // Basic Separation: Departure Time
            const minTime = prevTimeSec + separationInterval;

            // TODO: Advanced Conflict Check (Merge Points) would go here
            // const conflictDelay = checkWaypointConflict(flight, visibleItems.slice(0, i));
            // const targetTime = Math.max(minTime, eobtSec, conflictDelay);

            newCtotSec = Math.max(minTime, eobtSec);
        } else {
            newCtotSec = eobtSec;
        }

        flight.ctot = secToTime(newCtotSec);
        prevTimeSec = newCtotSec;

        // Update Input UI
        const input = item.querySelector('.ctot-input');
        if (input && document.activeElement !== input) {
            input.value = flight.ctot;
            if (newCtotSec > eobtSec) input.classList.add('delayed');
            else input.classList.remove('delayed');
        }
    }
    renderTimelineFlights(); // 타임라인 다시 그리기
}

// ============================================
// UI: LEFT PANEL (QUEUE)
// ============================================
function renderFlightQueue() {
    els.flightQueue.innerHTML = '';

    // 현재 시뮬레이션 시간 기준 과거 범위 계산
    const cutoffTimeSec = lookbackWindow === Infinity
        ? 0
        : simTimeSeconds - (lookbackWindow * 60);

    allFlights.forEach((flight) => {
        // 필터 체크
        let isVisible = true;

        // 1. CFL 필터
        if (currentCFLFilter !== "ALL" && flight.cfl !== currentCFLFilter) {
            isVisible = false;
        }

        // 2. 시간 범위 필터 (과거 데이터)
        const flightTimeSec = timeToSec(flight.atd || flight.eobt);
        if (flightTimeSec < cutoffTimeSec) {
            isVisible = false;
        }

        const el = document.createElement('div');
        el.className = 'queue-item';
        el.dataset.id = flight.id;
        if (flight.atd) el.classList.add('departed');
        if (!isVisible) el.style.display = 'none'; // DOM에는 남겨두되 숨김

        const atdVal = flight.atd || '';

        el.innerHTML = `
            <span class="col-cs">${flight.callsign}</span>
            <span class="col-dept">${flight.dept}</span>
            <span class="col-dest">${flight.dest}</span>
            <span class="col-cfl">${flight.cfl}</span>
            <span class="col-eobt">${flight.eobt}</span>
            <input type="text" class="col-atd atd-input" placeholder="-" value="${atdVal}">
            <input type="text" class="col-ctot ctot-input" value="${flight.ctot}" ${flight.atd ? 'disabled' : ''}>
        `;

        // 이벤트 리스너
        el.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT') selectFlight(flight.id);
        });

        const ctotInput = el.querySelector('.ctot-input');
        if (!flight.atd) {
            ctotInput.addEventListener('change', (e) => {
                const val = e.target.value;
                if (validateTime(val)) {
                    flight.ctot = val;
                    updateCTOTs(0);
                } else { e.target.value = flight.ctot; }
            });
        }

        const atdInput = el.querySelector('.atd-input');
        atdInput.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === '' || validateTime(val)) {
                flight.atd = val === '' ? null : val;
                flight.status = flight.atd ? 'DEP' : 'SCH';
                renderFlightQueue();
                updateCTOTs(0);
            }
        });

        els.flightQueue.appendChild(el);
    });
}

function validateTime(str) {
    return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(str);
}

function selectFlight(id) {
    document.querySelectorAll('.active-flight').forEach(e => e.classList.remove('active-flight'));
    const qItem = Array.from(els.flightQueue.children).find(el => el.dataset.id === id);
    if (qItem) qItem.classList.add('active-flight');

    document.querySelectorAll('.flight-block.selected').forEach(e => e.classList.remove('selected'));
    const tBlock = document.querySelector(`.flight-block[data-id="${id}"]`);
    if (tBlock) {
        tBlock.classList.add('selected');
        tBlock.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
}

// ============================================
// UI: RIGHT PANEL (TIMELINE)
// ============================================
const PX_PER_SEC = 1350 / 3600;

function initTimeline() {
    els.timeAxis.innerHTML = '';
    const startHour = 12;
    const endHour = 20;

    // 10분 단위로 눈금 생성
    for (let h = startHour; h < endHour; h++) {
        for (let m = 0; m < 60; m += 10) {
            const timeSec = h * 3600 + m * 60;
            const tick = document.createElement('div');
            tick.className = m === 0 ? 'time-label-tick major' : 'time-label-tick minor';

            // 위치 계산 (12:00 기준 0px)
            const offsetSec = timeSec - startHour * 3600;
            tick.style.left = `${offsetSec * PX_PER_SEC}px`;

            // 라벨: 정시는 시간 표시, 30분은 분 표시, 나머지는 눈금만
            if (m === 0) {
                tick.textContent = `${h}:00`;
            } else if (m === 30) {
                tick.textContent = `:30`;
                tick.classList.add('half-hour');
            }

            els.timeAxis.appendChild(tick);
        }
    }
    // 마지막 시간 (20:00)
    const lastTick = document.createElement('div');
    lastTick.className = 'time-label-tick major';
    lastTick.style.left = `${(endHour - startHour) * 3600 * PX_PER_SEC}px`;
    lastTick.textContent = `${endHour}:00`;
    els.timeAxis.appendChild(lastTick);

    renderTimelineFlights();
}

function renderTimelineFlights() {
    document.querySelectorAll('.flight-block').forEach(e => e.remove());
    const windowStartSec = 12 * 3600;

    // 현재 시뮬레이션 시간 기준 과거 범위 계산
    const cutoffTimeSec = lookbackWindow === Infinity
        ? 0
        : simTimeSeconds - (lookbackWindow * 60);

    allFlights.forEach(flight => {
        const track = document.querySelector(`.airport-track[data-airport="${flight.airport}"]`);
        if (!track) return;

        // 시간 범위 필터링
        const flightTimeSec = timeToSec(flight.atd || flight.eobt);
        if (flightTimeSec < cutoffTimeSec) return;

        // 사용 시간: ATD가 있으면 ATD, 아니면 CTOT
        const timeVal = flight.atd ? flight.atd : flight.ctot;
        const startSec = timeToSec(timeVal);
        const durationSec = flight.duration * 60;

        const left = (startSec - windowStartSec) * PX_PER_SEC;

        const block = document.createElement('div');
        block.className = 'flight-block';
        if (flight.atd) block.classList.add('departed');

        block.style.left = `${left}px`;
        block.style.width = 'auto';
        block.style.minWidth = '60px';
        block.textContent = flight.callsign;
        block.dataset.id = flight.id;

        let title = `EOBT: ${flight.eobt}, CTOT: ${flight.ctot}`;
        if (flight.atd) title = `DEP: ${flight.atd}` + title;
        block.title = title;

        block.addEventListener('click', (e) => {
            e.stopPropagation();
            selectFlight(flight.id);
        });

        track.appendChild(block);
    });
}

// ============================================
// UI: MAP & SIMULATION
// ============================================
function initFlightMap() {
    drawAltitudeLanes(els.mapSvg);
    drawMergePoints(els.mapSvg);
    drawAirportLabels(els.mapSvg);
}

function togglePlay() {
    if (simInterval) {
        clearInterval(simInterval);
        simInterval = null;
        els.playBtn.textContent = '▶';
    } else {
        simInterval = setInterval(() => {
            simTimeSeconds += simSpeed;
            updateSimulationUI();
            updateFlightMap();
        }, 1000 / 60);
        els.playBtn.textContent = '⏸';
    }
}

function updateSimulationUI() {
    els.simClock.textContent = secToTime(Math.floor(simTimeSeconds));
    const windowStartSec = 12 * 3600;
    const markerPos = (simTimeSeconds - windowStartSec) * PX_PER_SEC;
    els.timeMarker.style.left = `${markerPos}px`;
}

function updateFlightMap() {
    const aircraftLayer = document.getElementById('aircraft-layer');
    aircraftLayer.innerHTML = '';

    allFlights.forEach(flight => {
        // 위치 계산 기준 시간
        const startSec = flight.atd ? timeToSec(flight.atd) : timeToSec(flight.ctot);

        if (simTimeSeconds < startSec) return;
        const arrivalSec = startSec + flight.duration * 60;
        if (simTimeSeconds > arrivalSec) return;

        const elapsedMin = (simTimeSeconds - startSec) / 60;
        const pos = calculatePosition(flight, elapsedMin);
        drawAircraft(aircraftLayer, flight, pos);
    });
}

function calculatePosition(flight, elapsedMin) {
    const startX = getAirportX(flight.airport);
    const endX = 1500;
    const progress = elapsedMin / flight.duration;
    const x = startX + (endX - startX) * progress;

    const climbRatio = 0.2;
    const cruiseY = altitudeToY(flight.altitude);
    const groundY = 580;

    let y;
    if (progress < climbRatio) {
        const climbProgress = progress / climbRatio;
        y = groundY - (groundY - cruiseY) * climbProgress;
    } else {
        y = cruiseY;
    }
    return { x, y };
}

function jumpTime(sec) {
    simTimeSeconds += sec;
    updateSimulationUI();
    updateFlightMap();
}

// ============================================
// HELPERS
// ============================================
function timeToSec(str) {
    if (!str) return 0;
    const [h, m] = str.split(':').map(Number);
    return h * 3600 + m * 60;
}

function secToTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h < 0 || m < 0) return "00:00";
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

const SVG_HEIGHT = 600;
function altitudeToY(fl) {
    const maxFl = 280;
    const minFl = 140;
    const topY = 50;
    const bottomY = 500;
    return bottomY - ((fl - minFl) / (maxFl - minFl)) * (bottomY - topY);
}

function getAirportX(code) {
    const coords = { 'RKSS': 100, 'RKTU': 320, 'RKJK': 520, 'RKJJ': 750 };
    return coords[code] || 100;
}

function calculateFlightWaypoints(flight, startTimeSec) {
    const route = [];

    // 1. Entry Leg
    const entryKey = `${flight.airport}_ENTRY`;
    const entryDur = segmentConfig[entryKey] || 15;
    const mpName = airportDatabase[flight.airport].mergePoint;

    let currentSec = startTimeSec + (entryDur * 60);
    route.push({ name: mpName, time: currentSec });

    // 2. Chain
    let currentName = mpName;
    let safety = 0;
    while (safety < 20) {
        const leg = waypoints.find(wp => wp.from === currentName);
        if (!leg) break;
        currentSec += (leg.duration * 60);
        route.push({ name: leg.to, time: currentSec });
        currentName = leg.to;
        safety++;
    }


    return route;
}

// ============================================
// NEW LOGIC: Settings & Advanced CTOT
// ============================================

function initSettingsUI() {
    // Initial setup if needed
}

function renderSettings() {
    // 1. Entry Segments
    const entryContainer = document.getElementById('entry-segments-config');
    entryContainer.innerHTML = '';
    Object.keys(segmentConfig).forEach(key => {
        const div = document.createElement('div');
        div.className = 'input-item';
        div.innerHTML = `<span>${key} (Min)</span><input type="number" id="cfg-${key}" value="${segmentConfig[key]}">`;
        entryContainer.appendChild(div);
    });

    // 2. Waypoints
    const wpList = document.getElementById('waypoints-config-list');
    wpList.innerHTML = '';
    waypoints.forEach((wp, idx) => {
        const div = document.createElement('div');
        div.className = 'waypoint-list-item';
        div.innerHTML = `
            <input type="text" value="${wp.from}" data-idx="${idx}" data-field="from" placeholder="From">
            <input type="text" value="${wp.to}" data-idx="${idx}" data-field="to" placeholder="To">
            <input type="number" value="${wp.duration}" data-idx="${idx}" data-field="duration" placeholder="Min">
            <button class="btn-icon delete-wp" data-idx="${idx}" style="text-align:center;">🗑</button>
        `;
        wpList.appendChild(div);
    });

    // Delete Buttons
    document.querySelectorAll('.delete-wp').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            waypoints.splice(idx, 1);
            renderSettings();
        });
    });
}

function addWaypointInput() {
    waypoints.push({ from: '', to: '', duration: 10 });
    renderSettings();
}

function saveSettings() {
    // Save Entry Config
    Object.keys(segmentConfig).forEach(key => {
        const val = document.getElementById(`cfg-${key}`).value;
        segmentConfig[key] = parseInt(val);
    });

    // Save Waypoints
    const wpItems = document.querySelectorAll('.waypoint-list-item');
    const newWaypoints = [];
    wpItems.forEach(item => {
        const inputs = item.querySelectorAll('input');
        newWaypoints.push({
            from: inputs[0].value,
            to: inputs[1].value,
            duration: parseInt(inputs[2].value)
        });
    });
    waypoints = newWaypoints;

    alert('Configuration Saved!');
    els.settingsModal.classList.add('hidden');

    // Recalculate everything
    updateCTOTs(0);
}

function updateCTOTs(startIndex = 0) {
    // 1. Filtered List 가져오기 (DOM 순서대로)
    const items = Array.from(els.flightQueue.children);

    // 화면에 보이는(Filter된) 항공기만 대상으로 계산
    const visibleItems = items.filter(item => item.style.display !== 'none');

    let prevTimeSec = -1;

    for (let i = 0; i < visibleItems.length; i++) {
        const item = visibleItems[i];
        const id = item.dataset.id;
        const flight = allFlights.find(f => f.id === id);
        if (!flight) continue;

        const eobtSec = timeToSec(flight.eobt);
        let newCtotSec;

        // 1. 이미 이륙한 경우 (ATD 존재) -> 고정
        if (flight.atd) {
            newCtotSec = timeToSec(flight.atd);
            flight.ctot = flight.atd;

            // Calculate Waypoints ETO for In-air flight (fixed)
            flight.routeWaypoints = calculateFlightWaypoints(flight, newCtotSec);

            prevTimeSec = newCtotSec;
            continue;
        }

        // 2. 이륙 전 (SCH)

        // A. Basic Departure Separation
        let tentativeCtot = eobtSec;
        if (prevTimeSec !== -1) {
            tentativeCtot = Math.max(prevTimeSec + separationInterval, eobtSec);
        }

        // B. Advanced Merge Point Conflict Detection
        let conflictFound = true;
        let safetyLoop = 0;

        while (conflictFound && safetyLoop < 10) {
            conflictFound = false;
            const myWaypoints = calculateFlightWaypoints(flight, tentativeCtot);

            // Compare with all previous visible flights (j < i)
            for (let j = 0; j < i; j++) {
                const otherItem = visibleItems[j];
                const otherFlight = allFlights.find(f => f.id === otherItem.dataset.id);
                if (!otherFlight) continue;

                // Compare Waypoints
                for (const myWp of myWaypoints) {
                    const otherWp = otherFlight.routeWaypoints?.find(wp => wp.name === myWp.name);
                    if (otherWp) {
                        // Conflict Condition: < Separation
                        if (Math.abs(myWp.time - otherWp.time) < separationInterval) {
                            // CONFLICT!
                            const requiredWpTime = otherWp.time + separationInterval;
                            const delayNeeded = requiredWpTime - myWp.time;

                            if (delayNeeded > 0) {
                                tentativeCtot += delayNeeded;
                                conflictFound = true;
                                break;
                            }
                        }
                    }
                }
                if (conflictFound) break;
            }
            safetyLoop++;
        }

        newCtotSec = tentativeCtot;
        flight.ctot = secToTime(newCtotSec);
        flight.routeWaypoints = calculateFlightWaypoints(flight, newCtotSec);
        prevTimeSec = newCtotSec;

        // Update Input UI
        const input = item.querySelector('.ctot-input');
        if (input && document.activeElement !== input) {
            input.value = flight.ctot;
            if (newCtotSec > eobtSec) input.classList.add('delayed');
            else input.classList.remove('delayed');
        }
    }
    renderTimelineFlights(); // 타임라인 다시 그리기
}

function drawAltitudeLanes(svg) {
    const g = document.getElementById('altitude-lanes');
    g.innerHTML = '';
    const gLine = createSvgEl('line', { x1: 0, y1: 580, x2: 1600, y2: 580, stroke: '#444', 'stroke-width': 2 });
    g.appendChild(gLine);

    for (let fl = 140; fl <= 280; fl += 20) {
        const y = altitudeToY(fl);
        const line = createSvgEl('line', { x1: 0, y1: y, x2: 1600, y2: y, stroke: '#333', 'stroke-width': 1, 'stroke-dasharray': '5,5' });
        g.appendChild(line);
        const txt = createSvgEl('text', { x: 10, y: y + 4, fill: '#666', 'font-size': 10 });
        txt.textContent = `FL${fl}`;
        g.appendChild(txt);
    }
}

function drawMergePoints(svg) {
    const g = document.getElementById('merge-points');
    g.innerHTML = '';
    const points = [{ name: 'GONAX', x: 210 }, { name: 'ELPOS', x: 550 }, { name: 'DALSU', x: 900 }, { name: 'KIDOS', x: 1200 }];
    points.forEach(p => {
        const line = createSvgEl('line', { x1: p.x, y1: 0, x2: p.x, y2: 580, stroke: 'var(--accent-cyan)', 'stroke-width': 1, 'stroke-dasharray': '2,2', opacity: 0.3 });
        g.appendChild(line);
        const txt = createSvgEl('text', { x: p.x, y: 20, fill: 'var(--accent-cyan)', 'text-anchor': 'middle', 'font-size': 11 });
        txt.textContent = p.name;
        g.appendChild(txt);
    });
}

function drawAirportLabels(svg) {
    const g = document.getElementById('airport-labels');
    g.innerHTML = '';
    Object.keys(airportDatabase).forEach(code => {
        const x = getAirportX(code);
        const txt = createSvgEl('text', { x: x, y: 595, 'text-anchor': 'middle', fill: '#888', 'font-size': 11, 'font-weight': 'bold' });
        txt.textContent = code;
        g.appendChild(txt);
    });
}

function drawAircraft(layer, flight, pos) {
    const g = createSvgEl('g', { transform: `translate(${pos.x}, ${pos.y})` });
    const path = createSvgEl('path', { d: 'M0,-6 L-4,4 L0,2 L4,4 Z', fill: airportDatabase[flight.airport].color, stroke: '#fff', 'stroke-width': 1, transform: 'rotate(90)' });
    const label = createSvgEl('text', { x: 0, y: -10, 'text-anchor': 'middle', fill: '#fff', 'font-size': 9, 'font-weight': 'bold' });
    label.textContent = flight.callsign;
    g.appendChild(path);
    g.appendChild(label);
    layer.appendChild(g);
}

function createSvgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
}
