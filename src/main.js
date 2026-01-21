// ============================================
// GLOBAL STATE & DATA
// ============================================
let allFlights = [];
let simInterval = null;
let simTimeSeconds = 14 * 3600;
let simSpeed = 1;
let separationInterval = 120; // Seconds (2 minutes default)

// Filter & Config State
let currentCFLFilter = "ALL";
let lookbackWindow = 60; 

let segmentConfig = {
    'RKSS_ENTRY': 8,
    'RKTU_ENTRY': 5,
    'RKJK_ENTRY': 3,
    'RKJJ_ENTRY': 1
};

let waypoints = [
    { from: 'BULTI', to: 'MEKIL', duration: 2 },
    { from: 'MEKIL', to: 'GONAX', duration: 2 },
    { from: 'GONAX', to: 'BEDES', duration: 2 },
    { from: 'BEDES', to: 'ELPOS', duration: 3 },
    { from: 'ELPOS', to: 'MANGI', duration: 4 },
    { from: 'MANGI', to: 'DALSU', duration: 4 },
    { from: 'DALSU', to: 'NULDI', duration: 7 },
    { from: 'NULDI', to: 'DOTOL', duration: 2 }
];

const waypointCoords = {
    'BULTI': { lat: 36.72277778, lon: 126.82500000 },
    'MEKIL': { lat: 36.55611111, lon: 126.83138888 },
    'GONAX': { lat: 36.38666667, lon: 126.83569444 },
    'BEDES': { lat: 36.15111111, lon: 126.81194444 },
    'ELPOS': { lat: 35.90277777, lon: 126.78527777 },
    'MANGI': { lat: 35.50277778, lon: 126.74194444 },
    'DALSU': { lat: 35.12527778, lon: 126.70166666 },
    'NULDI': { lat: 34.42055555, lon: 126.62750000 },
    'DOTOL': { lat: 34.00000000, lon: 126.50000000 } // Approx for DOTOL
};

const airportDatabase = {
    'RKSS': { name: '김포', color: 'var(--gmp-color)', mergePoint: 'BULTI', lat: 37.5583, lon: 126.7906 },
    'RKTU': { name: '청주', color: 'var(--cjj-color)', mergePoint: 'BULTI', lat: 36.7166, lon: 127.4966 },
    'RKJK': { name: '군산', color: 'var(--kuv-color)', mergePoint: 'MANGI', lat: 35.9033, lon: 126.6150 },
    'RKJJ': { name: '광주', color: 'var(--kwj-color)', mergePoint: 'DALSU', lat: 35.1264, lon: 126.8088 }
};

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Calculate segment ratios based on true distance
function updateWaypointDurations() {
    let prevWp = 'BULTI';
    const mainChain = ['MEKIL', 'GONAX', 'BEDES', 'ELPOS', 'MANGI', 'DALSU', 'NULDI', 'DOTOL'];
    
    // Total distance of the main chain
    let totalDist = 0;
    let chainDistances = [];
    let currentPos = waypointCoords['BULTI'];
    
    mainChain.forEach(name => {
        const target = waypointCoords[name];
        const d = getDistance(currentPos.lat, currentPos.lon, target.lat, target.lon);
        chainDistances.push({ from: name === 'MEKIL' ? 'BULTI' : mainChain[mainChain.indexOf(name)-1], to: name, dist: d });
        totalDist += d;
        currentPos = target;
    });

    // We have 26 minutes total for the chain (2+2+2+3+4+4+7+2)
    const baseTotalTime = 26; 
    waypoints = chainDistances.map(cd => ({
        from: cd.from,
        to: cd.to,
        duration: Math.round((cd.dist / totalDist) * baseTotalTime * 10) / 10
    }));

    // Update entry segments as well
    Object.keys(airportDatabase).forEach(code => {
        const apt = airportDatabase[code];
        const mp = waypointCoords[apt.mergePoint];
        const d = getDistance(apt.lat, apt.lon, mp.lat, mp.lon);
        // Approximation: 1 min per 10km for entry
        segmentConfig[`${code}_ENTRY`] = Math.round(d / 10);
    });
}

const els = {};

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

function validateTime(str) {
    return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(str);
}

function createSvgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
}

function altitudeToY(fl) {
    const maxFl = 280;
    const minFl = 140;
    const topY = 50;
    const bottomY = 500;
    return bottomY - ((fl - minFl) / (maxFl - minFl)) * (bottomY - topY);
}

function getAirportX(code) {
    if (airportX && airportX[code]) return airportX[code];
    return 100; // Fallback
}

// ============================================
// LOGIC: WAYPOINTS & CTOT
// ============================================
function calculateFlightWaypoints(flight, startTimeSec) {
    const route = [];
    const entryKey = `${flight.airport}_ENTRY`;
    const entryDur = segmentConfig[entryKey] || 10;
    const mpName = airportDatabase[flight.airport].mergePoint;

    let currentSec = startTimeSec + (entryDur * 60);
    route.push({ name: mpName, time: currentSec });

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

function updateCTOTs(startIndex = 0) {
    if (!els.flightQueue) return;
    const items = Array.from(els.flightQueue.children).filter(el => !el.classList.contains('placeholder'));
    const visibleItems = items.filter(item => item.style.display !== 'none');

    let prevTimeSec = -1;

    for (let i = 0; i < visibleItems.length; i++) {
        const item = visibleItems[i];
        const id = item.dataset.id;
        const flight = allFlights.find(f => f.id === id);
        if (!flight) continue;

        const eobtSec = timeToSec(flight.eobt);
        let tentativeCtot = eobtSec;

        if (flight.atd) {
            tentativeCtot = timeToSec(flight.atd);
            flight.ctot = flight.atd;
            flight.routeWaypoints = calculateFlightWaypoints(flight, tentativeCtot);
            prevTimeSec = tentativeCtot;
            continue;
        }

        // If manually set, respect it as the base
        if (flight.isManualCtot && flight.ctot) {
            tentativeCtot = timeToSec(flight.ctot);
        } else if (prevTimeSec !== -1) {
            tentativeCtot = Math.max(prevTimeSec + separationInterval, eobtSec);
        }

        let conflictFound = true;
        let safetyLoop = 0;
        while (conflictFound && safetyLoop < 15) {
            conflictFound = false;
            const myWaypoints = calculateFlightWaypoints(flight, tentativeCtot);
            for (let j = 0; j < i; j++) {
                const otherFlight = allFlights.find(f => f.id === visibleItems[j].dataset.id);
                if (!otherFlight || !otherFlight.routeWaypoints) continue;

                for (const myWp of myWaypoints) {
                    const otherWp = otherFlight.routeWaypoints.find(wp => wp.name === myWp.name);
                    if (otherWp && Math.abs(myWp.time - otherWp.time) < separationInterval) {
                        const requiredWpTime = otherWp.time + separationInterval;
                        tentativeCtot += (requiredWpTime - myWp.time);
                        conflictFound = true;
                        break;
                    }
                }
                if (conflictFound) break;
            }
            safetyLoop++;
        }

        flight.ctot = secToTime(tentativeCtot);
        flight.routeWaypoints = calculateFlightWaypoints(flight, tentativeCtot);
        
        // Update total flight duration
        if (flight.routeWaypoints.length > 0) {
            const lastWpTime = flight.routeWaypoints[flight.routeWaypoints.length - 1].time;
            flight.duration = (lastWpTime - tentativeCtot) / 60 + 5;
        }

        prevTimeSec = tentativeCtot;

        const input = item.querySelector('.ctot-input');
        if (input && document.activeElement !== input) {
            input.value = flight.ctot;
            if (tentativeCtot > eobtSec) input.classList.add('delayed');
            else input.classList.remove('delayed');
            
            if (flight.isManualCtot) {
                input.style.border = '1px solid var(--accent-cyan)';
                input.style.color = 'var(--accent-cyan)';
            } else {
                input.style.border = '';
                input.style.color = '';
            }
        }
    }
    renderTimelineFlights();
}

// ============================================
// UI RENDERING
// ============================================
function renderFlightQueue() {
    if (!els.flightQueue) return;
    els.flightQueue.innerHTML = '';

    const cutoffTimeSec = lookbackWindow === Infinity ? 0 : simTimeSeconds - (lookbackWindow * 60);

    allFlights.forEach((flight) => {
        let isVisible = true;
        if (currentCFLFilter !== "ALL" && flight.cfl !== currentCFLFilter) isVisible = false;
        
        const flightTimeSec = timeToSec(flight.atd || flight.eobt);
        if (flightTimeSec < cutoffTimeSec) isVisible = false;

        const el = document.createElement('div');
        el.className = 'queue-item';
        el.dataset.id = flight.id;
        if (flight.atd) el.classList.add('departed');
        if (!isVisible) el.style.display = 'none';

        el.innerHTML = `
            <span class="col-cs">${flight.callsign}</span>
            <span class="col-dept">${flight.dept}</span>
            <span class="col-dest">${flight.dest}</span>
            <span class="col-cfl">${flight.cfl}</span>
            <span class="col-eobt">${flight.eobt}</span>
            <input type="text" class="col-atd atd-input" placeholder="-" value="${flight.atd || ''}">
            <input type="text" class="col-ctot ctot-input" value="${flight.ctot}" ${flight.atd ? 'disabled' : ''}>
        `;

        el.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT') selectFlight(flight.id);
        });

        const ctotInput = el.querySelector('.ctot-input');
        ctotInput?.addEventListener('change', (e) => {
            if (validateTime(e.target.value)) {
                flight.ctot = e.target.value;
                flight.isManualCtot = true; // Mark as manually adjusted
                updateCTOTs(0);
            } else { e.target.value = flight.ctot; }
        });

        const atdInput = el.querySelector('.atd-input');
        atdInput?.addEventListener('change', (e) => {
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

function renderTimelineFlights() {
    document.querySelectorAll('.flight-block').forEach(e => e.remove());
    const windowStartSec = 12 * 3600;
    const cutoffTimeSec = lookbackWindow === Infinity ? 0 : simTimeSeconds - (lookbackWindow * 60);
    const PX_PER_SEC = 1350 / 3600;

    allFlights.forEach(flight => {
        const track = document.querySelector(`.airport-track[data-airport="${flight.airport}"]`);
        if (!track) return;

        const flightTimeSec = timeToSec(flight.atd || flight.eobt);
        if (flightTimeSec < cutoffTimeSec) return;

        const timeVal = flight.atd || flight.ctot;
        const startSec = timeToSec(timeVal);
        const left = (startSec - windowStartSec) * PX_PER_SEC;

        const block = document.createElement('div');
        block.className = 'flight-block';
        if (flight.atd) block.classList.add('departed');
        block.style.left = `${left}px`;
        block.textContent = flight.callsign;
        block.dataset.id = flight.id;

        block.addEventListener('click', (e) => {
            e.stopPropagation();
            selectFlight(flight.id);
        });
        track.appendChild(block);
    });
}

function updateFlightMap() {
    const aircraftLayer = document.getElementById('aircraft-layer');
    if (!aircraftLayer) return;
    aircraftLayer.innerHTML = '';

    allFlights.forEach(flight => {
        const startSec = flight.atd ? timeToSec(flight.atd) : timeToSec(flight.ctot);
        if (simTimeSeconds < startSec) return;
        
        const totalDurationSec = flight.duration * 60;
        const arrivalSec = startSec + totalDurationSec;
        if (simTimeSeconds > arrivalSec) return;

        const elapsedMin = (simTimeSeconds - startSec) / 60;
        const pos = calculatePosition(flight, elapsedMin);
        drawAircraft(aircraftLayer, flight, pos);
    });
}

let waypointsX = {};
let airportX = {};

function updateWaypointX() {
    const mainChain = ['BULTI', 'MEKIL', 'GONAX', 'BEDES', 'ELPOS', 'MANGI', 'DALSU', 'NULDI', 'DOTOL'];
    let totalDist = 0;
    let dists = [0];
    for(let i=1; i<mainChain.length; i++) {
        const p1 = waypointCoords[mainChain[i-1]];
        const p2 = waypointCoords[mainChain[i]];
        const d = getDistance(p1.lat, p1.lon, p2.lat, p2.lon);
        totalDist += d;
        dists.push(totalDist);
    }

    const startX = 300; 
    const endX = 1450;
    const scale = (endX - startX) / totalDist;

    mainChain.forEach((name, i) => {
        waypointsX[name] = startX + (dists[i] * scale);
    });

    // Calculate Airport positions based on their distance to merge points
    Object.keys(airportDatabase).forEach(code => {
        const apt = airportDatabase[code];
        const mpCoords = waypointCoords[apt.mergePoint];
        if (mpCoords) {
            const d = getDistance(apt.lat, apt.lon, mpCoords.lat, mpCoords.lon);
            // Put airport to the left of its merge point
            airportX[code] = waypointsX[apt.mergePoint] - (d * scale);
            
            // Limit minimum X to 50
            if (airportX[code] < 50) airportX[code] = 50;
        }
    });
}

function calculatePosition(flight, elapsedMin) {
    const startTimeSec = flight.atd ? timeToSec(flight.atd) : timeToSec(flight.ctot);
    const currentTimeSec = startTimeSec + (elapsedMin * 60);

    const startX = getAirportX(flight.airport);
    const route = flight.routeWaypoints || [];
    
    let prevX = startX, prevTime = startTimeSec;
    let nextX = startX, nextTime = startTimeSec;

    for (const wp of route) {
        if (currentTimeSec < wp.time) {
            nextX = waypointsX[wp.name] || prevX;
            nextTime = wp.time;
            break;
        }
        prevX = waypointsX[wp.name] || prevX;
        prevTime = wp.time;
    }

    if (nextTime === startTimeSec && route.length > 0) {
        prevX = waypointsX[route[route.length - 1].name];
        prevTime = route[route.length - 1].time;
        nextX = 1550;
        nextTime = startTimeSec + (flight.duration * 60);
    }

    let progress = (nextTime > prevTime) ? (currentTimeSec - prevTime) / (nextTime - prevTime) : 0;
    const x = prevX + (nextX - prevX) * progress;

    const cruiseY = altitudeToY(flight.altitude);
    const groundY = 580;
    const climbRatio = 0.2;
    const totalProgress = elapsedMin / flight.duration;
    let y = (totalProgress < climbRatio) ? groundY - (groundY - cruiseY) * (totalProgress / climbRatio) : cruiseY;
    
    return { x, y };
}

function drawAircraft(layer, flight, pos) {
    const g = createSvgEl('g', { transform: `translate(${pos.x}, ${pos.y})` });
    const color = airportDatabase[flight.airport]?.color || '#fff';
    const path = createSvgEl('path', { d: 'M0,-6 L-4,4 L0,2 L4,4 Z', fill: color, stroke: '#fff', 'stroke-width': 1, transform: 'rotate(90)' });
    const label = createSvgEl('text', { x: 0, y: -10, 'text-anchor': 'middle', fill: '#fff', 'font-size': 9, 'font-weight': 'bold' });
    label.textContent = flight.callsign;
    g.appendChild(path);
    g.appendChild(label);
    layer.appendChild(g);
}

// ============================================
// INITIALIZATION & SESSION
// ============================================
function cacheOMElements() {
    els.simClock = document.getElementById('sim-clock');
    els.flightQueue = document.getElementById('flight-queue');
    els.cflFilter = document.getElementById('cfl-filter-select');
    els.timeRangeFilter = document.getElementById('time-range-select');
    els.sepButtons = document.querySelectorAll('.btn-sep');
    els.calcBtn = document.getElementById('calc-ctot-btn');
    els.playBtn = document.getElementById('play-btn');
    els.prevBtn = document.getElementById('prev-btn');
    els.nextBtn = document.getElementById('next-btn');
    els.speedSelect = document.getElementById('speed-select');
    els.timeAxis = document.querySelector('.time-axis');
    els.timeMarker = document.getElementById('time-marker');
    els.mapSvg = document.getElementById('flight-map-svg');
    els.settingsModal = document.getElementById('settings-modal');
    els.saveSettingsBtn = document.getElementById('save-settings');
    els.addWaypointBtn = document.getElementById('add-waypoint-btn');
}

function setupEventListeners() {
    els.cflFilter?.addEventListener('change', (e) => {
        currentCFLFilter = e.target.value;
        renderFlightQueue();
        updateCTOTs(0);
    });

    els.timeRangeFilter?.addEventListener('change', (e) => {
        const val = e.target.value;
        lookbackWindow = val === 'ALL' ? Infinity : parseInt(val);
        renderFlightQueue();
        renderTimelineFlights();
    });

    els.sepButtons?.forEach(btn => {
        btn.addEventListener('click', (e) => {
            els.sepButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            separationInterval = parseInt(btn.dataset.min) * 60;
            updateCTOTs(0);
        });
    });

    els.calcBtn?.addEventListener('click', () => updateCTOTs(0));
    els.playBtn?.addEventListener('click', togglePlay);
    els.prevBtn?.addEventListener('click', () => jumpTime(-300));
    els.nextBtn?.addEventListener('click', () => jumpTime(300));
    els.speedSelect?.addEventListener('change', (e) => simSpeed = parseInt(e.target.value));

    document.getElementById('view-settings')?.addEventListener('click', () => {
        renderSettings();
        els.settingsModal?.classList.remove('hidden');
    });
    document.getElementById('close-settings')?.addEventListener('click', () => {
        els.settingsModal?.classList.add('hidden');
    });

    els.saveSettingsBtn?.addEventListener('click', saveSettings);
    els.addWaypointBtn?.addEventListener('click', addWaypointInput);

    // SortableJS initialization for drag & drop rescheduling
    if (typeof Sortable !== 'undefined' && els.flightQueue) {
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
}

async function loadScheduleData() {
    const mockFlights = [];
    const currentTimeSec = 14 * 3600;
    const configs = [
        { code: 'RKSS', count: 10, prefix: 'KAL' },
        { code: 'RKTU', count: 5, prefix: 'ASIANA' },
        { code: 'RKJK', count: 2, prefix: 'JINAIR' },
        { code: 'RKJJ', count: 2, prefix: 'JEJU' }
    ];

    let idx = 0;
    configs.forEach(cfg => {
        for (let i = 0; i < cfg.count; i++) {
            const eobtSec = currentTimeSec + (idx * 300);
            const alt = 240; // All flights set to FL240 for testing
            mockFlights.push({
                id: `F${3000 + idx}`,
                callsign: `${cfg.prefix}${100 + i}`,
                airport: cfg.code,
                dept: cfg.code, dest: 'RKPC', type: 'A321',
                eobt: secToTime(eobtSec), atd: null, ctot: secToTime(eobtSec),
                status: 'SCH', duration: 60, altitude: alt, cfl: `FL${alt}`, routeWaypoints: []
            });
            idx++;
        }
    });

    allFlights = mockFlights.sort((a, b) => timeToSec(a.eobt) - timeToSec(b.eobt));
    simTimeSeconds = currentTimeSec;
    console.log("Mock data loaded:", allFlights.length);
}

function initTimeline() {
    if (!els.timeAxis) return;
    els.timeAxis.innerHTML = '';
    const PX_PER_SEC = 1350 / 3600;
    for (let h = 12; h <= 20; h++) {
        for (let m = 0; m < 60; m += 10) {
            const timeSec = h * 3600 + m * 60;
            const tick = document.createElement('div');
            tick.className = m === 0 ? 'time-label-tick major' : 'time-label-tick minor';
            tick.style.left = `${(timeSec - 12 * 3600) * PX_PER_SEC}px`;
            if (m === 0) tick.textContent = `${h}:00`;
            else if (m === 30) { tick.textContent = `:30`; tick.classList.add('half-hour'); }
            els.timeAxis.appendChild(tick);
        }
    }
    renderTimelineFlights();
}

function initFlightMap() {
    if (!els.mapSvg) return;
    
    // Update waypoint positions based on cumulative distance for the X-axis
    updateWaypointX();

    const gLanes = document.getElementById('altitude-lanes');
    if (gLanes) {
        gLanes.innerHTML = '';
        const ground = createSvgEl('line', { x1: 0, y1: 580, x2: 1600, y2: 580, stroke: '#444', 'stroke-width': 2 });
        gLanes.appendChild(ground);
        for (let fl = 140; fl <= 280; fl += 20) {
            const y = altitudeToY(fl);
            const line = createSvgEl('line', { x1: 0, y1: y, x2: 1600, y2: y, stroke: '#333', 'stroke-width': 1, 'stroke-dasharray': '5,5' });
            gLanes.appendChild(line);
            const txt = createSvgEl('text', { x: 10, y: y + 4, fill: '#666', 'font-size': 10 });
            txt.textContent = `FL${fl}`;
            gLanes.appendChild(txt);
        }
    }

    const gMP = document.getElementById('merge-points');
    if (gMP) {
        gMP.innerHTML = '';
        Object.keys(waypointsX).forEach(name => {
            const x = waypointsX[name];
            const line = createSvgEl('line', { x1: x, y1: 0, x2: x, y2: 580, stroke: 'var(--accent-cyan)', 'stroke-width': 1, 'stroke-dasharray': '2,2', opacity: 0.3 });
            gMP.appendChild(line);
            const txt = createSvgEl('text', { x: x, y: 20, fill: 'var(--accent-cyan)', 'text-anchor': 'middle', 'font-size': 11 });
            txt.textContent = name;
            gMP.appendChild(txt);
        });
    }

    const gAirports = document.getElementById('airport-labels');
    if (gAirports) {
        gAirports.innerHTML = '';
        Object.keys(airportDatabase).forEach(code => {
            const x = getAirportX(code);
            const color = airportDatabase[code].color || '#fff';
            
            // Draw a marker (circle) slightly above ground for visibility
            const circle = createSvgEl('circle', { cx: x, cy: 575, r: 6, fill: color, stroke: '#fff', 'stroke-width': 2 });
            gAirports.appendChild(circle);

            // Draw the airport code text slightly higher
            const txt = createSvgEl('text', { x: x, y: 592, 'text-anchor': 'middle', fill: '#fff', 'font-size': 12, 'font-weight': 'bold', 'style': 'text-shadow: 0 0 4px #000;' });
            txt.textContent = code;
            gAirports.appendChild(txt);
            
            // Add a connector line from airport to surface if needed (already on surface line)
        });
    }
}

function togglePlay() {
    if (simInterval) { clearInterval(simInterval); simInterval = null; els.playBtn.textContent = '▶'; }
    else {
        simInterval = setInterval(() => {
            simTimeSeconds += simSpeed;
            updateSimulationUI();
            updateFlightMap();
        }, 1000 / 60);
        els.playBtn.textContent = '⏸';
    }
}

function updateSimulationUI() {
    if (els.simClock) els.simClock.textContent = secToTime(Math.floor(simTimeSeconds));
    const markerPos = (simTimeSeconds - 12 * 3600) * (1350 / 3600);
    if (els.timeMarker) els.timeMarker.style.left = `${markerPos}px`;
}

function jumpTime(sec) {
    simTimeSeconds += sec;
    updateSimulationUI();
    updateFlightMap();
}

function selectFlight(id) {
    document.querySelectorAll('.active-flight').forEach(e => e.classList.remove('active-flight'));
    const qItem = Array.from(els.flightQueue?.children || []).find(el => el.dataset.id === id);
    if (qItem) qItem.classList.add('active-flight');
    document.querySelectorAll('.flight-block.selected').forEach(e => e.classList.remove('selected'));
    const tBlock = document.querySelector(`.flight-block[data-id="${id}"]`);
    if (tBlock) { tBlock.classList.add('selected'); tBlock.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }); }
}

function renderSettings() {
    const entryContainer = document.getElementById('entry-segments-config');
    if (entryContainer) {
        entryContainer.innerHTML = '';
        Object.keys(segmentConfig).forEach(key => {
            const div = document.createElement('div');
            div.className = 'input-item';
            div.innerHTML = `<span>${key} (Min)</span><input type="number" id="cfg-${key}" value="${segmentConfig[key]}">`;
            entryContainer.appendChild(div);
        });
    }

    const wpList = document.getElementById('waypoints-config-list');
    if (wpList) {
        wpList.innerHTML = '';
        waypoints.forEach((wp, idx) => {
            const div = document.createElement('div');
            div.className = 'waypoint-list-item';
            div.innerHTML = `
                <input type="text" value="${wp.from}" data-idx="${idx}" data-field="from">
                <input type="text" value="${wp.to}" data-idx="${idx}" data-field="to">
                <input type="number" value="${wp.duration}" data-idx="${idx}" data-field="duration">
                <button class="btn-icon delete-wp" data-idx="${idx}">🗑</button>
            `;
            wpList.appendChild(div);
        });
        document.querySelectorAll('.delete-wp').forEach(btn => btn.addEventListener('click', (e) => {
            waypoints.splice(parseInt(e.target.dataset.idx), 1);
            renderSettings();
        }));
    }
}

function addWaypointInput() { waypoints.push({ from: '', to: '', duration: 10 }); renderSettings(); }

function saveSettings() {
    Object.keys(segmentConfig).forEach(key => segmentConfig[key] = parseInt(document.getElementById(`cfg-${key}`).value));
    const newWaypoints = [];
    document.querySelectorAll('.waypoint-list-item').forEach(item => {
        const inputs = item.querySelectorAll('input');
        newWaypoints.push({ from: inputs[0].value, to: inputs[1].value, duration: parseInt(inputs[2].value) });
    });
    waypoints = newWaypoints;
    alert('Settings Saved!');
    els.settingsModal?.classList.add('hidden');
    updateCTOTs(0);
}

document.addEventListener('DOMContentLoaded', async () => {
    updateWaypointDurations(); // Calculate initial ratios based on GPS coordinates
    cacheOMElements();
    setupEventListeners();
    await loadScheduleData();
    renderFlightQueue();
    updateCTOTs(0);
    initTimeline();
    initFlightMap();
    updateSimulationUI();
});
