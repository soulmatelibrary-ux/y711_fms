console.log('main.js: Top-level execution start');

// SQLite Database
let db = null;
let sqlJs = null;

// Initialize SQLite
async function initDatabase() {
    try {
        // sql.js는 index.html에서 script 태그로 로드됨
        // window.initSqlJs를 사용
        if (typeof window.initSqlJs === 'undefined') {
            console.error('sql.js not loaded. Make sure sql-wasm.js is included in index.html');
            throw new Error('sql.js not available');
        }

        sqlJs = await window.initSqlJs({
            locateFile: file => `/${file}`
        });

        console.log('initDatabase: sql.js initialized');

        // Try to load existing database from localStorage
        const data = localStorage.getItem('fms_database');
        if (data) {
            const buffer = new Uint8Array(JSON.parse(data));
            db = new sqlJs.Database(buffer);
            console.log('initDatabase: Database loaded from localStorage');
        } else {
            db = new sqlJs.Database();
            console.log('initDatabase: New database created');
        }

        // Create tables if they don't exist
        db.run(`
            CREATE TABLE IF NOT EXISTS flights (
                id TEXT PRIMARY KEY,
                callsign TEXT,
                dept TEXT,
                dest TEXT,
                cfl TEXT,
                eobt_utc TEXT,
                day_of_week INTEGER,
                uploaded_date TEXT
            )
        `);

        // Load today's flights automatically
        loadTodaysFlights();

    } catch (error) {
        console.error('Failed to initialize database (falling back to mock):', error);
        loadMockScheduleData(); // Fallback to mock data
    }
}

// Save database to localStorage
function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Array.from(data);
        localStorage.setItem('fms_database', JSON.stringify(buffer));
    }
}

// ============================================
// GLOBAL STATE & DATA
// ============================================
let allFlights = [];
let simInterval = null;
let simTimeSeconds = (() => {
    const now = new Date();
    return now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
})();
let simSpeed = 1;
let lastSelectedFlightId = null;
let separationInterval = 180; // Seconds (3 minutes default)
let referenceFlightId = null; // 기준 항공기 ID
let conflictingFlightIds = new Set(); // 충돌 중인 항공기 ID들

// Filter & Config State
let selectedDayOfWeek = 1; // Monday default
let selectedDate = new Date(); // Current selected date
let excelFlightData = []; // Store uploaded Excel data
let segmentConfig = {
    'RKSS_BULTI': 8,
    'RKTU_MEKIL': 7,
    'RKJK_MANGI': 3,
    'RKJJ_DALSU': 1
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

// Conflict detection points - where different airports' flights converge
// separationMinutes는 전역 separationInterval(초)을 분 단위로 사용
const conflictZones = [
    {
        name: 'MEKIL_CONVERGENCE',
        waypoint: 'MEKIL',
        airports: ['RKSS', 'RKTU'], // 김포, 청주가 여기서 만남
        separationMinutes: 3 // 3분 분리 기준 (separationInterval과 동일)
    },
    {
        name: 'MANGI_CONVERGENCE',
        waypoint: 'MANGI',
        airports: ['RKJK'], // 군산
        separationMinutes: 3
    },
    {
        name: 'DALSU_CONVERGENCE',
        waypoint: 'DALSU',
        airports: ['RKJJ'], // 광주
        separationMinutes: 3
    }
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
    'RKSS': { name: '김포', color: '#58a6ff', mergePoint: 'BULTI', firstMerge: 'BULTI', lat: 37.5583, lon: 126.7906, depInterval: 4, taxiTime: 20 },
    'RKTU': { name: '청주', color: '#bc8cff', mergePoint: 'BULTI', firstMerge: 'MEKIL', lat: 36.7166, lon: 127.4966, depInterval: 10, taxiTime: 15 },
    'RKJK': { name: '군산', color: '#39c5bb', mergePoint: 'MANGI', firstMerge: 'MANGI', lat: 35.9033, lon: 126.6150, depInterval: 10, taxiTime: 10 },
    'RKJJ': { name: '광주', color: '#d29922', mergePoint: 'DALSU', firstMerge: 'DALSU', lat: 35.1264, lon: 126.8088, depInterval: 10, taxiTime: 12 }
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
        chainDistances.push({ from: name === 'MEKIL' ? 'BULTI' : mainChain[mainChain.indexOf(name) - 1], to: name, dist: d });
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

}

const els = {};

// ============================================
// HELPERS
// ============================================

// DAY_OF_WEEK 변환: 숫자(1~7) 또는 한글(월~일) → 숫자(1~7)
function parseDayOfWeek(value) {
    if (!value) return 0;

    // 숫자인 경우
    if (typeof value === 'number') return value;

    const str = String(value).trim();

    // 숫자 문자열인 경우
    if (/^[1-7]$/.test(str)) return parseInt(str);

    // 한글 요일인 경우
    const dayMap = {
        '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 7,
        '월요일': 1, '화요일': 2, '수요일': 3, '목요일': 4, '금요일': 5, '토요일': 6, '일요일': 7
    };

    return dayMap[str] || 0;
}

function timeToSec(str) {
    if (!str) return 0;

    // 숫자로 들어온 경우 문자열로 변환
    if (typeof str === 'number') {
        str = str.toString();
    }

    // "HHMM" 형식 지원 (콜론 없음)
    if (typeof str === 'string' && !str.includes(':')) {
        const padded = str.padStart(4, '0');
        const h = parseInt(padded.substring(0, 2), 10);
        const m = parseInt(padded.substring(2, 4), 10);
        if (!isNaN(h) && !isNaN(m)) {
            return h * 3600 + m * 60;
        }
    }

    // "HH:MM" 형식
    const [h, m] = str.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return 0;
    return h * 3600 + m * 60;
}

function secToTime(sec) {
    if (isNaN(sec) || sec < 0) {
        console.error('Invalid seconds value:', sec);
        return "0000";
    }
    const h = Math.floor(sec / 3600) % 24; // 24시간 넘으면 00시로
    const m = Math.floor((sec % 3600) / 60);
    if (h < 0 || m < 0) return "0000";
    return `${h.toString().padStart(2, '0')}${m.toString().padStart(2, '0')}`;
}

// Check if time falls within operational window
function isInTodaysWindow(timeStr, targetDate = new Date()) {
    return true; // Accept all times
}

// Get current UTC time
function getCurrentUtcTime() {
    const now = new Date();
    return `${now.getUTCHours().toString().padStart(2, '0')}${now.getUTCMinutes().toString().padStart(2, '0')}`;
}

// Find the index of flight closest to current UTC time
function findCurrentFlightIndex() {
    if (allFlights.length === 0) {
        console.log('No flights available, returning index 0');
        return 0;
    }

    const now = new Date();
    // Get current UTC time directly
    const currentUtcHours = now.getUTCHours();
    const currentUtcMinutes = now.getUTCMinutes();
    const currentUtcSec = currentUtcHours * 3600 + currentUtcMinutes * 60;

    console.log(`Current UTC time: ${currentUtcHours.toString().padStart(2, '0')}:${currentUtcMinutes.toString().padStart(2, '0')}`);
    console.log(`Total flights available: ${allFlights.length}`);

    // Show first few flights for debugging
    allFlights.slice(0, 5).forEach((flight, idx) => {
        console.log(`Flight ${idx}: ${flight.callsign} at UTC ${flight.eobtUtc}`);
    });

    let closestIndex = 0;
    let minTimeDiff = Infinity;

    allFlights.forEach((flight, index) => {
        const flightUtcSec = timeToSec(flight.eobtUtc);

        // For operational flights, consider the UTC operational day cycle (21:00-12:00)
        let adjustedFlightSec = flightUtcSec;
        let adjustedCurrentSec = currentUtcSec;

        // Operational day boundary handling for UTC times
        // 운항일 기준: UTC 21:00 ~ 다음날 UTC 12:00 (KST 06:00 ~ 21:00)
        // If current time is in early UTC hours (00:00-12:00) and flight is in evening (21:00-23:59)
        if (currentUtcSec < 12 * 3600 && flightUtcSec >= 21 * 3600) {
            adjustedCurrentSec = currentUtcSec + 24 * 3600; // Add 24 hours to current time
        }
        // If flight is in early UTC hours (00:00-12:00) and current time is in evening (21:00-23:59)
        else if (flightUtcSec < 12 * 3600 && currentUtcSec >= 21 * 3600) {
            adjustedFlightSec = flightUtcSec + 24 * 3600; // Add 24 hours to flight time
        }

        const timeDiff = Math.abs(adjustedFlightSec - adjustedCurrentSec);

        if (timeDiff < minTimeDiff) {
            minTimeDiff = timeDiff;
            closestIndex = index;
        }
    });

    const closestFlight = allFlights[closestIndex];
    console.log(`Current time closest flight: ${closestFlight?.callsign} at UTC ${closestFlight?.eobtUtc} (index ${closestIndex} of ${allFlights.length})`);

    return closestIndex;
}

// Save Excel data to SQLite database
function saveExcelDataToDb(excelData) {
    if (!db) return;

    const today = new Date().toISOString().split('T')[0];

    // Clear ALL existing data (새 Excel 업로드 시 기존 데이터 모두 삭제)
    db.run('DELETE FROM flights');

    // Insert new data
    const stmt = db.prepare(`
        INSERT INTO flights (id, callsign, dept, dest, cfl, eobt_utc, day_of_week, uploaded_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    excelData.forEach((row, index) => {
        const id = `${today}_${index}`;
        stmt.run([
            id,
            row.CALLSIGN || '',
            row.DEPT || '',
            row.DEST || '',
            row.CFL || '',
            row.EOBT || '',
            parseDayOfWeek(row.DAY_OF_WEEK),
            today
        ]);
    });

    stmt.free();
    saveDatabase();
    console.log('Excel data saved to database:', excelData.length, 'flights');
}

// Load flights from database (7일 반복 스케줄)
function loadTodaysFlights() {
    console.log("=== LOADING FLIGHTS FROM DATABASE ===");

    if (!db) {
        console.log('Database not initialized, loading mock data');
        loadMockScheduleData();
        return;
    }

    // If we have Excel data in memory, use it
    if (excelFlightData.length > 0) {
        console.log('Using Excel data from memory:', excelFlightData.length, 'flights');
        selectedDate = new Date();
        updateDateSelector();
        loadFlightsForDate();
        return;
    }

    try {
        // Load ALL flights from database (7일 반복 스케줄)
        const allResults = db.exec('SELECT * FROM flights');

        if (allResults.length > 0 && allResults[0].values.length > 0) {
            const rows = allResults[0].values;
            console.log(`Found ${rows.length} flights in database (7-day schedule)`);

            const dbFlights = [];
            rows.forEach(row => {
                dbFlights.push({
                    CALLSIGN: row[1],
                    DEPT: row[2],
                    DEST: row[3],
                    CFL: row[4],
                    EOBT: row[5],
                    DAY_OF_WEEK: row[6]
                });
            });

            excelFlightData = dbFlights;
            console.log('Loaded', dbFlights.length, 'flights from database (7-day schedule)');

            // Set current date as selected
            selectedDate = new Date();
            updateDateSelector();

            loadFlightsForDate();
        } else {
            console.log('No data in database, loading mock data');
            loadMockScheduleData();
        }
    } catch (error) {
        console.error('Error loading from database:', error);
        loadMockScheduleData();
    }
}

// Update date selector to show current selection
function updateDateSelector() {
    const dateSelect = document.getElementById('schedule-date');
    if (dateSelect) {
        const dateStr = selectedDate.toISOString().split('T')[0];
        dateSelect.value = dateStr;
    }
}

function validateTime(str) {
    if (!str) return false;
    // "HHMM" 형식 (콜론 없음)
    if (/^([01]?[0-9]|2[0-3])[0-5][0-9]$/.test(str)) return true;
    // "HH:MM" 형식 (하위 호환)
    if (/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(str)) return true;
    return false;
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
    const apt = airportDatabase[flight.airport];
    const firstMerge = apt?.firstMerge || apt?.mergePoint;
    const entryKey = `${flight.airport}_${firstMerge}`;
    const entryDur = segmentConfig[entryKey] || 10;

    // startTimeSec = CTOT (이륙 시간)
    // 첫 웨이포인트(firstMerge) 도착 = 이륙 + entry 시간
    // 청주는 BULTI를 거치지 않고 바로 MEKIL로 진입
    let currentSec = startTimeSec + (entryDur * 60);
    route.push({ name: firstMerge, time: currentSec });

    // firstMerge부터 웨이포인트 체인 따라가기
    let currentName = firstMerge;
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

// Detect conflicts at convergence points
function detectConflicts() {
    const conflicts = [];

    conflictZones.forEach(zone => {
        const flightsAtWaypoint = [];

        allFlights.forEach(flight => {
            if (!flight.routeWaypoints) return;

            const waypoint = flight.routeWaypoints.find(wp => wp.name === zone.waypoint);
            if (waypoint) {
                flightsAtWaypoint.push({
                    flight: flight,
                    time: waypoint.time,
                    callsign: flight.callsign
                });
            }
        });

        // Check for conflicts (flights within separation time)
        for (let i = 0; i < flightsAtWaypoint.length; i++) {
            for (let j = i + 1; j < flightsAtWaypoint.length; j++) {
                const timeDiff = Math.abs(flightsAtWaypoint[i].time - flightsAtWaypoint[j].time);
                const separationSec = zone.separationMinutes * 60;

                if (timeDiff < separationSec) {
                    conflicts.push({
                        zone: zone.name,
                        waypoint: zone.waypoint,
                        flight1: flightsAtWaypoint[i].flight,
                        flight2: flightsAtWaypoint[j].flight,
                        timeDiff: timeDiff,
                        severity: timeDiff < 30 ? 'critical' : 'warning'
                    });

                    console.warn(`🚨 CONFLICT at ${zone.waypoint}: ${flightsAtWaypoint[i].callsign} and ${flightsAtWaypoint[j].callsign} separated by ${Math.round(timeDiff)}s`);
                }
            }
        }
    });

    return conflicts;
}

// Visual conflict indication in timeline
function showConflictIndicators(conflicts) {
    // Remove existing conflict indicators
    document.querySelectorAll('.conflict-indicator').forEach(el => el.remove());

    const windowStartSec = timelineStartHour * 3600;
    const PX_PER_SEC = 1350 / 3600;

    conflicts.forEach(conflict => {
        const track1 = document.querySelector(`.airport-track[data-airport="${conflict.flight1.airport}"]`);
        const track2 = document.querySelector(`.airport-track[data-airport="${conflict.flight2.airport}"]`);

        if (track1) {
            const timeVal1 = conflict.flight1.atd || conflict.flight1.ctot;
            const startSec1 = timeToSec(timeVal1);
            const left1 = (startSec1 - windowStartSec) * PX_PER_SEC;

            const indicator1 = document.createElement('div');
            indicator1.className = `conflict-indicator ${conflict.severity}`;
            indicator1.style.left = `${left1}px`;
            indicator1.textContent = '⚠️';
            indicator1.title = `CONFLICT at ${conflict.waypoint}: ${conflict.flight1.callsign} & ${conflict.flight2.callsign}`;

            track1.appendChild(indicator1);
        }

        if (track2) {
            const timeVal2 = conflict.flight2.atd || conflict.flight2.ctot;
            const startSec2 = timeToSec(timeVal2);
            const left2 = (startSec2 - windowStartSec) * PX_PER_SEC;

            const indicator2 = document.createElement('div');
            indicator2.className = `conflict-indicator ${conflict.severity}`;
            indicator2.style.left = `${left2}px`;
            indicator2.textContent = '⚠️';
            indicator2.title = `CONFLICT at ${conflict.waypoint}: ${conflict.flight1.callsign} & ${conflict.flight2.callsign}`;

            track2.appendChild(indicator2);
        }
    });
}



function updateCTOTs(startIndex = 0) {
    if (!els.flightQueue) return;
    const items = Array.from(els.flightQueue.children).filter(el => !el.classList.contains('placeholder'));
    const visibleItems = items.filter(item => item.style.display !== 'none');

    // 기준 항공기 인덱스 찾기
    const refIndex = referenceFlightId ?
        visibleItems.findIndex(item => item.dataset.id === referenceFlightId) : -1;

    // Group flights by airport for departure interval calculation
    const airportGroups = {};

    for (let i = startIndex; i < visibleItems.length; i++) {
        const item = visibleItems[i];
        const id = item.dataset.id;
        const flight = allFlights.find(f => f.id === id);
        if (!flight) continue;

        const eobtSec = timeToSec(flight.eobt);
        let tentativeCtot = eobtSec;
        flight.recCfl = null;

        // Skip departed flights
        if (flight.atd) {
            tentativeCtot = timeToSec(flight.atd);
            flight.ctot = flight.atd;
            flight.routeWaypoints = calculateFlightWaypoints(flight, tentativeCtot);
            continue;
        }

        const airport = flight.airport;
        const aptInfo = airportDatabase[airport];
        const depInterval = (aptInfo?.depInterval || 10) * 60; // in seconds

        // Initialize airport group tracking
        if (!airportGroups[airport]) airportGroups[airport] = [];

        // 기준 항공기 이전: CTOT 비움 (계산하지 않음)
        if (refIndex >= 0 && i < refIndex) {
            flight.ctot = '';
            flight.ctotUtc = '';
            flight.routeWaypoints = [];
            continue;
        }

        const isManual = flight.isManualCtot && flight.ctot;
        if (isManual) {
            tentativeCtot = timeToSec(flight.ctot);
            // 자정 넘김 처리: 수동 CTOT가 EOBT보다 작으면 다음 날로 간주
            if (tentativeCtot < eobtSec - 3600) { // 1시간 이상 차이나면 다음 날
                tentativeCtot += 86400;
            }
        } else {
            // Priority 1: Must be at or after EOBT
            tentativeCtot = eobtSec;

            // Priority 2: Maintain airport-specific departure interval
            const prevFromSameAirport = airportGroups[airport][airportGroups[airport].length - 1];
            if (prevFromSameAirport) {
                let prevCtot = timeToSec(prevFromSameAirport.ctot);
                // 이전 항공기가 다음 날이면 86400 추가
                if (prevFromSameAirport.isNextDay) {
                    prevCtot += 86400;
                }
                tentativeCtot = Math.max(tentativeCtot, prevCtot + depInterval);
            }
        }

        // Priority 3: Conflict detection (altitude-independent)
        // Check all waypoints against all flights above in the list
        // 수동 CTOT는 조정하지 않고 웨이포인트만 계산
        let myWaypoints = calculateFlightWaypoints(flight, tentativeCtot);

        if (!isManual) {
            // 자동 CTOT만 충돌 감지 후 조정
            let conflictFound = true;
            let safetyLoop = 0;
            while (conflictFound && safetyLoop < 30) {
                conflictFound = false;

                for (let j = 0; j < i; j++) {
                    const otherFlight = allFlights.find(f => f.id === visibleItems[j].dataset.id);
                    if (!otherFlight || !otherFlight.routeWaypoints || otherFlight.routeWaypoints.length === 0) continue;

                    for (const myWp of myWaypoints) {
                        const otherWp = otherFlight.routeWaypoints.find(wp => wp.name === myWp.name);
                        if (!otherWp) continue;

                        // 자정 넘김 보정: 두 시간의 실제 차이 계산
                        let myTime = myWp.time;
                        let otherTime = otherWp.time;

                        // 시간 차이가 12시간(43200초) 이상이면 자정 넘김으로 간주
                        let timeDiff = Math.abs(myTime - otherTime);
                        if (timeDiff > 43200) {
                            // 더 작은 시간에 86400을 더해서 비교
                            if (myTime < otherTime) {
                                myTime += 86400;
                            } else {
                                otherTime += 86400;
                            }
                            timeDiff = Math.abs(myTime - otherTime);
                        }

                        if (timeDiff < separationInterval) {
                            // Priority: LIST ORDER. If I am below in the list, I must wait.
                            const requiredWpTime = otherTime + separationInterval;
                            const adjustment = requiredWpTime - myTime;
                            if (adjustment > 0) {
                                tentativeCtot += adjustment;
                                myWaypoints = calculateFlightWaypoints(flight, tentativeCtot); // CTOT 변경 시 재계산
                                conflictFound = true;
                                break;
                            }
                        }
                    }
                    if (conflictFound) break;
                }
                safetyLoop++;
            }
        }

        // 모두 UTC 기준이므로 변환 없음
        flight.ctot = secToTime(tentativeCtot);
        flight.ctotUtc = flight.ctot; // 동일

        // Handle midnight rollover for CTOT display
        // If CTOT goes beyond 24:00, it should show as next day time
        if (tentativeCtot >= 24 * 3600) {
            const nextDayTime = tentativeCtot % (24 * 3600);
            flight.ctot = secToTime(nextDayTime);
            flight.ctotUtc = flight.ctot;
            flight.isNextDay = true; // Flag to indicate next day CTOT
        } else {
            flight.isNextDay = false;
        }

        flight.routeWaypoints = myWaypoints; // 이미 계산된 웨이포인트 사용 (중복 계산 제거)

        // Debug log for troubleshooting
        if (isNaN(tentativeCtot) || tentativeCtot < 0) {
            console.error('Invalid tentativeCtot for flight:', flight.callsign, tentativeCtot);
            tentativeCtot = eobtSec; // Fallback to EOBT
            flight.ctot = flight.eobt;
            flight.routeWaypoints = calculateFlightWaypoints(flight, tentativeCtot); // 폴백 시 재계산
        }

        airportGroups[airport].push(flight);

        // Update total flight duration
        if (flight.routeWaypoints.length > 0) {
            const lastWpTime = flight.routeWaypoints[flight.routeWaypoints.length - 1].time;
            flight.duration = (lastWpTime - tentativeCtot) / 60 + 5;
        }

        const input = item.querySelector('.ctot-input');
        if (input && document.activeElement !== input) {
            input.value = flight.ctotUtc || flight.ctot;
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

    // Detect and show conflicts after CTOT calculation
    const conflicts = detectConflicts();
    showConflictIndicators(conflicts);

    renderTimelineFlights();
}

// ============================================
// UI RENDERING
// ============================================

// CTOT 상태 판단 함수
function getCtotStatus(flight, prevFlight, nextFlight) {
    const eobtSec = timeToSec(flight.eobt);
    const ctotSec = timeToSec(flight.ctot);

    if (!ctotSec || !eobtSec) return 'normal';

    const diffMin = (ctotSec - eobtSec) / 60;
    const statuses = [];

    // 간격 위반 체크 (최우선)
    if (nextFlight && nextFlight.ctot) {
        const nextCtotSec = timeToSec(nextFlight.ctot);
        if (nextCtotSec) {
            const gapSec = nextCtotSec - ctotSec;  // 초 단위로 비교
            if (gapSec < separationInterval && gapSec >= 0) {
                statuses.push('conflict');
            }
        }
    }

    // 수동 변경 체크
    if (flight.isManualCtot) {
        statuses.push('manual');
    }

    // 지연/앞당김 체크 (5분 이상)
    if (diffMin >= 5) {
        statuses.push('delayed');
    } else if (diffMin <= -5) {
        statuses.push('early');
    }

    // 우선순위: conflict > manual > delayed/early > normal
    if (statuses.includes('conflict')) return 'conflict';
    if (statuses.includes('manual')) return 'manual';
    if (statuses.includes('delayed')) return 'delayed';
    if (statuses.includes('early')) return 'early';

    return 'normal';
}

function renderFlightQueue() {
    if (!els.flightQueue) return;
    els.flightQueue.innerHTML = '';

    console.log("=== RENDERING FLIGHT QUEUE ===");
    console.log("Total allFlights count:", allFlights.length);

    if (allFlights.length === 0) {
        const placeholder = document.createElement('div');
        placeholder.className = 'queue-item placeholder';
        placeholder.textContent = 'No flights loaded';
        els.flightQueue.appendChild(placeholder);
        return;
    }

    // Find current flight index for highlighting
    const currentIndex = findCurrentFlightIndex();
    const now = new Date();
    const currentUtcTime = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')}`;

    console.log(`Rendering ${allFlights.length} flights, current time index: ${currentIndex}`);

    // 기준 항공기 인덱스 찾기
    const refIndex = referenceFlightId ? allFlights.findIndex(f => f.id === referenceFlightId) : -1;

    allFlights.forEach((flight, index) => {
        const isCurrentTime = index === currentIndex;
        const isReference = flight.id === referenceFlightId;
        const isAfterReference = refIndex >= 0 && index > refIndex;

        // CTOT 상태 판단 (인접 항공기 참조)
        const prevFlight = index > 0 ? allFlights[index - 1] : null;
        const nextFlight = index < allFlights.length - 1 ? allFlights[index + 1] : null;
        const ctotStatus = getCtotStatus(flight, prevFlight, nextFlight);

        const el = document.createElement('div');
        el.className = 'queue-item';
        if (isCurrentTime) el.classList.add('current-time-flight');
        if (isReference) el.classList.add('is-reference');
        if (isAfterReference) el.classList.add('after-reference');
        el.dataset.id = flight.id;
        if (flight.atd) el.classList.add('departed');

        // 공항별 색상
        const airportColor = airportDatabase[flight.airport]?.color || 'var(--text-primary)';

        // CTOT 상태 클래스 조합
        const ctotClasses = ['col-ctot', 'ctot-input'];
        if (flight.isNextDay) ctotClasses.push('next-day-ctot');
        if (ctotStatus !== 'normal') ctotClasses.push(ctotStatus);

        el.innerHTML = `
            <button class="ref-btn" title="기준 항공기로 설정">${isReference ? '⭐' : '☆'}</button>
            <span class="col-cs" style="color: ${airportColor}">${flight.callsign}</span>
            <span class="col-dept">${flight.dept}</span>
            <span class="col-dest">${flight.dest}</span>
            <div class="col-cfl">
                <span class="cfl-value">${flight.cfl}</span>
                ${flight.recCfl ? `<span class="rec-badge" title="Recommended CFL to avoid delay">➜${flight.recCfl}</span>` : ''}
            </div>
            <input type="text" class="col-eobt eobt-input" value="${flight.eobtUtc || flight.eobt}">
            <div class="col-atd-wrapper">
                <input type="text" class="col-atd atd-input" placeholder="-" value="${flight.atd || ''}">
                ${isCurrentTime ? '<span class="current-time-indicator">📍</span>' : ''}
            </div>
            <input type="text" class="${ctotClasses.join(' ')}" value="${flight.ctotUtc || flight.ctot}${flight.isNextDay ? '+1' : ''}" ${flight.atd ? 'disabled' : ''}>
        `;

        // 기준 항공기 선택 버튼 이벤트
        el.querySelector('.ref-btn')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (referenceFlightId === flight.id) {
                referenceFlightId = null; // 해제
            } else {
                referenceFlightId = flight.id; // 설정
                flight.isManualCtot = true; // 기준 항공기는 수동 모드
            }
            updateCTOTs(0);
            renderFlightQueue();
        });

        el.addEventListener('click', (e) => {
            const badge = e.target.closest('.rec-badge');
            if (badge) {
                e.preventDefault();
                e.stopPropagation();

                const newCfl = flight.recCfl;
                flight.cfl = newCfl;
                flight.altitude = parseInt(newCfl.replace('FL', ''));
                flight.recCfl = null;

                // Sequence is important: Calculate first, then render
                updateCTOTs(0);
                renderFlightQueue();
                updateFlightMap(); // Refresh map immediately
                return;
            }
            if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'BUTTON') selectFlight(flight.id);
        });



        const eobtInput = el.querySelector('.eobt-input');
        eobtInput?.addEventListener('change', (e) => {
            if (validateTime(e.target.value)) {
                flight.eobt = e.target.value;
                updateCTOTs(0);
                renderFlightQueue();
                renderTimelineFlights();
            } else { e.target.value = flight.eobt; }
        });

        const ctotInput = el.querySelector('.ctot-input');
        ctotInput?.addEventListener('change', (e) => {
            if (validateTime(e.target.value)) {
                // 모든 시간은 UTC 기준
                flight.ctot = e.target.value;
                flight.ctotUtc = e.target.value;
                flight.isManualCtot = true; // Mark as manually adjusted

                // 수동 CTOT 설정 전 검증
                let ctotSec = timeToSec(flight.ctot);
                const eobtSec = timeToSec(flight.eobt);
                // 자정 넘김 처리: CTOT가 EOBT보다 작으면 다음 날
                const isNextDay = ctotSec < eobtSec - 3600;
                if (isNextDay) {
                    ctotSec += 86400;
                }

                let warnings = [];

                // 검증 1: 같은 공항 이륙 간격 검사
                const airport = flight.airport;
                const aptInfo = airportDatabase[airport];
                const depInterval = (aptInfo?.depInterval || 10) * 60;

                for (const otherFlight of allFlights) {
                    if (otherFlight.id === flight.id || otherFlight.airport !== airport) continue;
                    if (!otherFlight.ctot) continue;

                    let otherCtotSec = timeToSec(otherFlight.ctot);
                    if (otherFlight.isNextDay) otherCtotSec += 86400;

                    // 시간 차이 계산 (자정 넘김 고려)
                    let timeDiff = Math.abs(ctotSec - otherCtotSec);
                    if (timeDiff > 43200) {
                        timeDiff = 86400 - timeDiff;
                    }

                    if (timeDiff < depInterval && timeDiff > 0) {
                        warnings.push(`이륙간격: ${otherFlight.callsign}과 ${Math.round(timeDiff/60)}분 (기준: ${depInterval/60}분)`);
                    }
                }

                // 검증 2: 웨이포인트 충돌 검사
                const tempWaypoints = calculateFlightWaypoints(flight, ctotSec);

                for (const otherFlight of allFlights) {
                    if (otherFlight.id === flight.id || !otherFlight.routeWaypoints || otherFlight.routeWaypoints.length === 0) continue;

                    for (const myWp of tempWaypoints) {
                        const otherWp = otherFlight.routeWaypoints.find(wp => wp.name === myWp.name);
                        if (!otherWp) continue;

                        // 자정 넘김 보정
                        let myTime = myWp.time;
                        let otherTime = otherWp.time;
                        let timeDiff = Math.abs(myTime - otherTime);

                        if (timeDiff > 43200) {
                            if (myTime < otherTime) myTime += 86400;
                            else otherTime += 86400;
                            timeDiff = Math.abs(myTime - otherTime);
                        }

                        if (timeDiff < separationInterval) {
                            warnings.push(`${myWp.name}: ${otherFlight.callsign}과 ${Math.round(timeDiff/60)}분 분리 (기준: ${separationInterval/60}분)`);
                            break;
                        }
                    }
                }

                if (warnings.length > 0) {
                    console.warn(`⚠️ 수동 CTOT 경고: ${flight.callsign}`, warnings);
                    e.target.style.backgroundColor = 'rgba(255, 68, 68, 0.3)';
                    e.target.title = `경고:\n${warnings.join('\n')}`;
                } else {
                    e.target.style.backgroundColor = '';
                    e.target.title = '';
                }

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

    // Scroll to current time flight with improved timing
    setTimeout(() => {
        const currentFlightElement = els.flightQueue.querySelector('.current-time-flight');
        if (currentFlightElement && allFlights.length > 0) {
            // Ensure the element is fully rendered before scrolling
            requestAnimationFrame(() => {
                currentFlightElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'nearest'
                });

                // Add temporary highlight to make it more visible
                currentFlightElement.style.animation = 'pulse 2s ease-in-out';
                setTimeout(() => {
                    currentFlightElement.style.animation = '';
                }, 2000);
            });

            console.log(`Scrolled to current time flight: ${allFlights[currentIndex]?.callsign} at index ${currentIndex}`);
        } else {
            console.log('No current time flight found for scrolling');
        }
    }, 100);

    console.log(`Rendered ${allFlights.length} flights, current time flight at index ${currentIndex} (UTC: ${currentUtcTime})`);
}

function renderTimelineFlights() {
    document.querySelectorAll('.flight-block').forEach(e => e.remove());
    const windowStartSec = timelineStartHour * 3600;
    const PX_PER_SEC = 1350 / 3600;

    allFlights.forEach(flight => {
        const track = document.querySelector(`.airport-track[data-airport="${flight.airport}"]`);
        if (!track) return;

        const timeVal = flight.atd || flight.ctot;
        const startSec = timeToSec(timeVal);
        const left = (startSec - windowStartSec) * PX_PER_SEC;

        const block = document.createElement('div');
        block.className = 'flight-block';
        if (flight.atd) block.classList.add('departed');

        // Apply airport color
        const color = airportDatabase[flight.airport]?.color || 'var(--accent-blue)';
        block.style.borderColor = color;
        block.style.background = `linear-gradient(to right, ${color}44, ${color}22)`;

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

    // 24시간 순환 처리된 시뮬레이션 시간
    const simTimeInDay = simTimeSeconds % 86400;

    allFlights.forEach(flight => {
        // CTOT가 없거나 빈 문자열이면 표시 안 함 (기준 항공기 이전 항공기들)
        if (!flight.ctot && !flight.atd) return;

        const ctotSec = flight.atd ? timeToSec(flight.atd) : timeToSec(flight.ctot);

        const taxiTime = (airportDatabase[flight.airport]?.taxiTime || 15) * 60;
        const taxiStartSec = ctotSec - taxiTime; // 택시 시작 = CTOT - 택시시간

        if (simTimeInDay < taxiStartSec) return; // 택시 시작 전에는 표시 안 함

        const totalDurationSec = flight.duration * 60;
        const arrivalSec = ctotSec + totalDurationSec; // 도착 = CTOT(이륙) + 비행시간
        if (simTimeInDay > arrivalSec) return;

        const elapsedMin = (simTimeInDay - taxiStartSec) / 60;
        const isFullscreen = els.mapSection?.classList.contains('fullscreen');
        const pos = calculatePosition(flight, elapsedMin, isFullscreen);
        drawAircraft(aircraftLayer, flight, pos);
        flight.currentPos = pos; // Store for analysis
    });

    // --- Separation Analysis ---
    drawSeparationAnalysis(aircraftLayer, simTimeInDay);
}

function drawSeparationAnalysis(layer, simTimeInDay) {
    // 이전 충돌 기록 초기화
    const newConflictingIds = new Set();

    const activeFlights = allFlights
        .filter(f => {
            const ctotSec = f.atd ? timeToSec(f.atd) : timeToSec(f.ctot);
            if (!ctotSec && ctotSec !== 0) return false;
            const taxiTime = (airportDatabase[f.airport]?.taxiTime || 15) * 60;
            const taxiStartSec = ctotSec - taxiTime;
            const arrivalSec = ctotSec + f.duration * 60;
            return simTimeInDay >= taxiStartSec && simTimeInDay <= arrivalSec && f.currentPos;
        })
        .sort((a, b) => b.currentPos.x - a.currentPos.x);

    for (let i = 0; i < activeFlights.length - 1; i++) {
        const lead = activeFlights[i];
        const follow = activeFlights[i + 1];

        const distPx = lead.currentPos.x - follow.currentPos.x;
        if (distPx > 15 && distPx < 600) {
            let leadStartTime = lead.atd ? timeToSec(lead.atd) : timeToSec(lead.ctot);
            let followStartTime = follow.atd ? timeToSec(follow.atd) : timeToSec(follow.ctot);
            // 자정 넘김 처리
            if (lead.isNextDay) leadStartTime += 86400;
            if (follow.isNextDay) followStartTime += 86400;
            let timeDiffSec = Math.abs(followStartTime - leadStartTime);

            // Wrap-around guard: always measure the shortest interval within 24h
            if (timeDiffSec > 43200) {
                timeDiffSec = 86400 - timeDiffSec;
            }

            const timeDiffMin = timeDiffSec / 60;

            // 분리 기준 위반 체크 (설정값 사용)
            const isConflict = timeDiffSec < separationInterval;

            if (isConflict) {
                newConflictingIds.add(lead.id);
                newConflictingIds.add(follow.id);
            }

            const midX = (lead.currentPos.x + follow.currentPos.x) / 2;
            const midY = (lead.currentPos.y + follow.currentPos.y) / 2;

            // 충돌 시 빨간색, 정상 시 흰색
            const lineColor = isConflict ? 'rgba(255, 68, 68, 0.8)' : 'rgba(255, 255, 255, 0.4)';
            const lineWidth = isConflict ? 2 : 1;

            const line = createSvgEl('line', {
                x1: follow.currentPos.x + 10, y1: follow.currentPos.y,
                x2: lead.currentPos.x - 10, y2: lead.currentPos.y,
                stroke: lineColor,
                'stroke-width': lineWidth,
                'stroke-dasharray': isConflict ? '8,4' : '4,4'
            });

            const isFullscreen = document.querySelector('.map-section')?.classList.contains('fullscreen');
            const labelFontSize = isFullscreen ? 14 : 11;

            // 충돌 시 빨간색 + 경고 아이콘
            const labelColor = isConflict ? '#ff4444' : 'var(--accent-cyan)';
            const labelText = isConflict ? `⚠️ ${Math.round(timeDiffMin)}min` : `${Math.round(timeDiffMin)}min`;

            const label = createSvgEl('text', {
                x: midX, y: midY - 5,
                'text-anchor': 'middle',
                fill: labelColor,
                'font-size': `${labelFontSize}px`,
                'font-weight': 'bold',
                'style': 'text-shadow: 0 0 4px #000;'
            });
            label.textContent = labelText;

            layer.appendChild(line);
            layer.appendChild(label);

            // 충돌 시 깜빡이는 원 추가
            if (isConflict) {
                const warningCircle = createSvgEl('circle', {
                    cx: midX, cy: midY,
                    r: 20,
                    fill: 'none',
                    stroke: '#ff4444',
                    'stroke-width': 2,
                    opacity: 0.7,
                    class: 'conflict-pulse'
                });
                layer.appendChild(warningCircle);
            }
        }
    }

    // 충돌 항공기 ID 업데이트
    conflictingFlightIds = newConflictingIds;

    // 목록에 충돌 표시 업데이트
    updateConflictHighlights();
}

// 목록에서 충돌 항공기 하이라이트
function updateConflictHighlights() {
    document.querySelectorAll('.queue-item').forEach(el => {
        const flightId = el.dataset.id;
        if (conflictingFlightIds.has(flightId)) {
            el.classList.add('conflict-warning');
        } else {
            el.classList.remove('conflict-warning');
        }
    });
}

let waypointsX = {};
let airportX = {};

function updateWaypointX() {
    const mainChain = ['BULTI', 'MEKIL', 'GONAX', 'BEDES', 'ELPOS', 'MANGI', 'DALSU', 'NULDI', 'DOTOL'];
    let totalDist = 0;
    let dists = [0];
    for (let i = 1; i < mainChain.length; i++) {
        const p1 = waypointCoords[mainChain[i - 1]];
        const p2 = waypointCoords[mainChain[i]];
        const d = getDistance(p1.lat, p1.lon, p2.lat, p2.lon);
        totalDist += d;
        dists.push(totalDist);
    }

    const startX = 200;
    const endX = 1530;
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

            // Special handling for RKSS/RKTU separation if they are too close
            if (code === 'RKTU') {
                const rkssX = getAirportX('RKSS');
                if (rkssX !== 100) { // Check if RKSS position is already calculated (not fallback)
                    const diff = Math.abs(airportX[code] - rkssX);
                    if (diff < 60) {
                        airportX[code] = rkssX + 65; // Shift RKTU further right for clearer visibility
                    }
                }
            }

            // Limit minimum X to 30
            if (airportX[code] < 30) airportX[code] = 30;
        }
    });
}

function calculatePosition(flight, elapsedMin, isFullscreen = true) {
    // CTOT = 이륙 시간 (Calculated Take-Off Time)
    const ctotSec = flight.atd ? timeToSec(flight.atd) : timeToSec(flight.ctot);
    const taxiTime = (airportDatabase[flight.airport]?.taxiTime || 15) * 60;
    const taxiStartSec = ctotSec - taxiTime; // 택시 시작 = CTOT - 택시시간
    const currentTimeSec = taxiStartSec + (elapsedMin * 60);

    const apt = airportDatabase[flight.airport];
    const startX = getAirportX(flight.airport);
    const groundY = 800; // 지상 Y좌표

    // 택시 중 (지상) - 화면 하단에서 시작
    if (currentTimeSec < ctotSec) {
        return {
            x: startX,
            y: isFullscreen ? groundY : 380
        };
    }

    // firstMerge 지점 계산 (X와 Y 동기화의 기준점)
    const firstMergeWp = apt?.firstMerge || apt?.mergePoint;
    const entryKey = `${flight.airport}_${firstMergeWp}`;
    const entryDur = segmentConfig[entryKey] || 10;
    const firstMergeTime = ctotSec + (entryDur * 60); // 직접 계산하여 동기화
    const firstMergeX = waypointsX[firstMergeWp] || startX;

    const route = flight.routeWaypoints || [];
    const airborneSecond = currentTimeSec - ctotSec; // 이륙 후 경과 시간(초)
    const airborneMin = airborneSecond / 60; // 이륙 후 경과 시간(분)

    // 고도 및 비행시간 안전 처리
    const altitude = parseInt(flight.altitude) || 200; // 기본값 FL200
    const cruiseY = altitudeToY(altitude);

    // 같은 공항 출발 항공기들의 Y축 오프셋 계산 (겹침 방지)
    const sameAirportFlights = allFlights
        .filter(f => f.airport === flight.airport)
        .sort((a, b) => timeToSec(a.ctot) - timeToSec(b.ctot));
    const flightIndex = sameAirportFlights.findIndex(f => f.id === flight.id);
    const offsetPattern = [0, -25, 25, -50, 50, -75, 75];
    const yOffset = offsetPattern[flightIndex % offsetPattern.length] || 0;

    let x, y;

    if (currentTimeSec < firstMergeTime) {
        // 상승 구간: 공항 → firstMerge (X와 Y 동기화)
        const climbProgress = airborneSecond / (firstMergeTime - ctotSec);
        x = startX + (firstMergeX - startX) * climbProgress;
        if (isFullscreen) {
            y = groundY - (groundY - cruiseY) * climbProgress;
        } else {
            const dashGroundY = 330;
            const dashCruiseY = 270;
            y = dashGroundY - (dashGroundY - dashCruiseY) * Math.min(climbProgress, 1);
        }
    } else {
        // 순항 구간: firstMerge 이후
        // X 계산: route 웨이포인트 기반
        let prevX = firstMergeX, prevTime = firstMergeTime;
        let nextX = firstMergeX, nextTime = firstMergeTime;

        for (const wp of route) {
            if (wp.name === firstMergeWp) continue; // firstMerge는 이미 처리됨
            const wpTime = ctotSec + (entryDur * 60) + getTimeToWaypoint(firstMergeWp, wp.name);
            if (currentTimeSec < wpTime) {
                nextX = waypointsX[wp.name] || prevX;
                nextTime = wpTime;
                break;
            }
            prevX = waypointsX[wp.name] || prevX;
            prevTime = wpTime;
        }

        // 마지막 웨이포인트 이후
        if (nextTime === firstMergeTime && route.length > 0) {
            const lastWp = route[route.length - 1];
            prevX = waypointsX[lastWp.name] || firstMergeX;
            prevTime = lastWp.time;
            nextX = 1550;
            nextTime = ctotSec + (flight.duration * 60);
        }

        const progress = (nextTime > prevTime) ? (currentTimeSec - prevTime) / (nextTime - prevTime) : 0;
        x = prevX + (nextX - prevX) * progress;

        // Y 계산: 순항 고도 + 오프셋
        if (isFullscreen) {
            y = cruiseY + yOffset;
        } else {
            y = 270; // Dashboard cruise Y
        }
    }

    return { x, y };
}

// firstMerge에서 특정 웨이포인트까지 시간 계산
function getTimeToWaypoint(fromWp, toWp) {
    let totalTime = 0;
    let currentWp = fromWp;
    let safety = 0;
    while (currentWp !== toWp && safety < 20) {
        const leg = waypoints.find(wp => wp.from === currentWp);
        if (!leg) break;
        totalTime += leg.duration * 60;
        currentWp = leg.to;
        safety++;
    }
    return totalTime;
}

function drawAircraft(layer, flight, pos) {
    const isFullscreen = document.querySelector('.map-section')?.classList.contains('fullscreen');
    const fontSize = isFullscreen ? 22 : 18;
    const timeFontSize = isFullscreen ? 14 : 12;
    let timeVal = flight.atd || flight.ctot;

    // Get current simulation time
    const simTime = secToTime(Math.floor(simTimeSeconds));

    // 기준 항공기(⭐)는 빨간색으로 표시
    const isReference = flight.id === referenceFlightId;
    const color = isReference ? '#ff4444' : (airportDatabase[flight.airport]?.color || '#fff');
    const strokeColor = isReference ? '#ff4444' : '#fff';

    const g = createSvgEl('g', { transform: `translate(${pos.x}, ${pos.y})` });
    // 항공기 크기: 기준 항공기는 더 크게
    const scale = isReference ? 2.5 : 1.8;
    const path = createSvgEl('path', {
        d: 'M0,-6 L-4,4 L0,2 L4,4 Z',
        fill: color,
        stroke: strokeColor,
        'stroke-width': isReference ? 2 : 1,
        transform: `rotate(90) scale(${scale})`
    });

    // Callsign and CTOT label (위치 조정 - 항공기 크기에 맞게)
    const labelY = isReference ? -20 : -16;
    const label = createSvgEl('text', { x: 0, y: labelY, 'text-anchor': 'middle', fill: color, 'font-size': fontSize, 'font-weight': 'bold', 'style': 'text-shadow: 0 0 3px #000;' });
    label.textContent = `${flight.callsign}(${timeVal})${isReference ? '⭐' : ''}`;

    // Simulation time label (below aircraft)
    const simTimeLabelY = isReference ? 18 : 14;
    const simTimeLabel = createSvgEl('text', { x: 0, y: simTimeLabelY, 'text-anchor': 'middle', fill: '#aaa', 'font-size': timeFontSize, 'font-weight': 'normal', 'style': 'text-shadow: 0 0 2px #000;' });
    simTimeLabel.textContent = simTime;

    g.appendChild(path);
    g.appendChild(label);
    g.appendChild(simTimeLabel);
    layer.appendChild(g);
}

// ============================================
// INITIALIZATION & SESSION
// ============================================
function cacheOMElements() {
    els.simClock = document.getElementById('sim-clock');
    els.flightQueue = document.getElementById('flight-queue');
    els.mergePointSelect = document.getElementById('merge-point-select');
    els.calcBtn = document.getElementById('calc-ctot-btn');
    els.playBtn = document.getElementById('play-btn');
    els.stopBtn = document.getElementById('stop-btn');
    els.prevBtn = document.getElementById('prev-btn');
    els.nextBtn = document.getElementById('next-btn');
    els.speedSelect = document.getElementById('speed-select');
    els.timeAxis = document.querySelector('.time-axis');
    els.timeMarker = document.getElementById('time-marker');
    els.mapSvg = document.getElementById('flight-map-svg');
    els.settingsModal = document.getElementById('settings-modal');
    els.saveSettingsBtn = document.getElementById('save-settings');
    els.addWaypointBtn = document.getElementById('add-waypoint-btn');
    els.mapFullscreenBtn = document.getElementById('map-fullscreen-btn');
    els.mapSection = document.querySelector('.map-section');
    els.mapSimClock = document.getElementById('map-sim-clock');
    els.mapClockContainer = document.getElementById('map-clock-container');
}

function setupEventListeners() {
    // Merge Point Selection
    els.mergePointSelect?.addEventListener('change', (e) => {
        separationInterval = parseInt(e.target.value) * 60;
        updateCTOTs(0);
    });

    // Set default value
    if (els.mergePointSelect) {
        els.mergePointSelect.value = '3';
        separationInterval = 3 * 60;
    }

    els.calcBtn?.addEventListener('click', () => updateCTOTs(0));
    els.playBtn?.addEventListener('click', togglePlay); els.stopBtn?.addEventListener('click', resetSimulation); els.prevBtn?.addEventListener('click', () => jumpTime(-300));
    els.nextBtn?.addEventListener('click', () => jumpTime(300));
    els.speedSelect?.addEventListener('change', (e) => simSpeed = parseInt(e.target.value));

    // CTOT 초기화 버튼
    document.getElementById('reset-ctot-btn')?.addEventListener('click', async () => {
        if (confirm('모든 CTOT를 초기화하시겠습니까?')) {
            referenceFlightId = null;
            await loadScheduleData();
            updateCTOTs(0);
            renderFlightQueue();
            renderTimelineFlights();
        }
    });

    els.mapFullscreenBtn?.addEventListener('click', () => {
        if (els.mapSection) {
            const isFullscreen = els.mapSection.classList.toggle('fullscreen');
            els.mapFullscreenBtn.textContent = isFullscreen ? 'Close View' : 'Full View';
            if (els.mapClockContainer) els.mapClockContainer.style.display = isFullscreen ? 'flex' : 'none';
            updateFlightMap(); // Refresh to update font sizes
        }
    });

    document.getElementById('view-settings')?.addEventListener('click', () => {
        console.log('Settings button clicked');
        try {
            renderSettings();
            if (els.settingsModal) {
                els.settingsModal.classList.remove('hidden');
                console.log('Settings modal shown');
            } else {
                console.error('settingsModal element not found in cache');
                // Fallback attempt to cache
                els.settingsModal = document.getElementById('settings-modal');
                els.settingsModal?.classList.remove('hidden');
            }
        } catch (err) {
            console.error('Error rendering settings:', err);
            // Still try to show the modal even if rendering partially failed
            els.settingsModal?.classList.remove('hidden');
        }
    });
    document.getElementById('close-settings')?.addEventListener('click', () => {
        els.settingsModal?.classList.add('hidden');
    });

    // 도움말 모달
    document.getElementById('help-btn')?.addEventListener('click', () => {
        document.getElementById('help-modal')?.classList.remove('hidden');
    });
    document.getElementById('close-help')?.addEventListener('click', () => {
        document.getElementById('help-modal')?.classList.add('hidden');
    });
    // 모달 외부 클릭 시 닫기
    document.getElementById('help-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'help-modal') {
            e.target.classList.add('hidden');
        }
    });

    els.saveSettingsBtn?.addEventListener('click', saveSettings);
    els.addWaypointBtn?.addEventListener('click', addWaypointInput);

    // Excel Upload
    document.getElementById('excel-upload')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) processExcelFile(file);
    });

    // Date Selection
    document.getElementById('schedule-date')?.addEventListener('change', (e) => {
        selectedDate = new Date(e.target.value);
        selectedDate.setHours(12); // Set to noon to avoid timezone issues
        if (excelFlightData.length > 0) {
            loadFlightsForDate();
        }
    });

    // Previous Day Button
    document.getElementById('prev-day-btn')?.addEventListener('click', () => {
        selectedDate.setDate(selectedDate.getDate() - 1);
        updateDateSelector();
        if (excelFlightData.length > 0) {
            loadFlightsForDate();
        }
    });

    // Next Day Button
    document.getElementById('next-day-btn')?.addEventListener('click', () => {
        selectedDate.setDate(selectedDate.getDate() + 1);
        updateDateSelector();
        if (excelFlightData.length > 0) {
            loadFlightsForDate();
        }
    });

    // Today Button
    document.getElementById('today-btn')?.addEventListener('click', () => {
        selectedDate = new Date();
        updateDateSelector();
        if (excelFlightData.length > 0) {
            loadFlightsForDate();
        }
    });

    // SortableJS initialization for drag & drop rescheduling
    if (typeof Sortable !== 'undefined' && els.flightQueue) {
        Sortable.create(els.flightQueue, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            filter: 'input',
            preventOnFilter: false,
            onEnd: () => {
                // DOM 순서에 맞게 allFlights 배열 재정렬
                const items = Array.from(els.flightQueue.children).filter(el => !el.classList.contains('placeholder'));
                const newOrder = [];
                items.forEach(item => {
                    const flight = allFlights.find(f => f.id === item.dataset.id);
                    if (flight) {
                        // 기준 항공기의 수동 CTOT는 유지, 나머지는 초기화
                        if (flight.id !== referenceFlightId) {
                            flight.isManualCtot = false;
                        }
                        newOrder.push(flight);
                    }
                });
                allFlights = newOrder;
                updateCTOTs(0);
                renderFlightQueue();
            }
        });
    }
}

function processExcelFile(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet);

            console.log('Excel data loaded:', jsonData.length, 'rows');
            excelFlightData = jsonData;

            // Save to database
            saveExcelDataToDb(jsonData);

            loadFlightsForDate(); // Use new date-based loading

            // Show success message
            const statusDiv = document.getElementById('upload-status');
            if (statusDiv) {
                statusDiv.textContent = `✅ ${jsonData.length} flights loaded and saved`;
                statusDiv.style.color = '#00ff00';
                setTimeout(() => {
                    statusDiv.textContent = '';
                }, 3000);
            }
        } catch (error) {
            console.error('Error reading Excel file:', error);
            const statusDiv = document.getElementById('upload-status');
            if (statusDiv) {
                statusDiv.textContent = '❌ Error processing file';
                statusDiv.style.color = '#ff4444';
            }
        }
    };
    reader.readAsArrayBuffer(file);
}

// Load flights for selected date (UTC 21:00 to UTC 21:00 next day cycle)
function loadFlightsForDate(targetDate = selectedDate) {
    console.log("=== LOADING FLIGHTS FOR DATE ===");
    console.log("Target date:", targetDate.toDateString());
    console.log("Excel data available:", excelFlightData.length, "flights");

    if (excelFlightData.length === 0) {
        console.log('No Excel data, using mock data');
        loadMockScheduleData();
        return;
    }

    // Get day of week for the selected operational day
    // Excel uses 1=Monday, 2=Tuesday, ... 7=Sunday
    // JS getDay() uses 0=Sunday, 1=Monday, ... 6=Saturday
    // Convert JS to Excel format: Sunday 0->7, others stay same
    const jsDayOfWeek = targetDate.getDay();
    const targetDayOfWeek = jsDayOfWeek === 0 ? 7 : jsDayOfWeek; // Convert to Excel format (1-7)

    const mockFlights = [];

    // Filter Excel data for the selected day of week
    const todaysFlights = excelFlightData.filter(row => {
        const dayOfWeek = parseDayOfWeek(row.DAY_OF_WEEK);
        return dayOfWeek === targetDayOfWeek;
    });

    console.log(`Filtered flights for day of week ${targetDayOfWeek} (${targetDate.toDateString()}): ${todaysFlights.length} flights`);

    // All flights for this day of week are included in the operational period
    const filteredFlights = todaysFlights;

    console.log(`Processing ${filteredFlights.length} flights for operational day...`);

    filteredFlights.forEach((row, idx) => {
        const callsign = row.CALLSIGN || `FL${idx}`;
        const dept = row.DEPT || 'RKSS';
        const dest = row.DEST || 'RKPC';
        const cfl = row.CFL || 'FL280';

        // EOBT를 HHMM 형식으로 유지 (콜론 없음)
        // Excel EOBT는 이미 UTC 값임
        let eobt = row.EOBT || '1400';
        if (typeof eobt === 'number') {
            // 숫자로 들어온 경우 (예: 1430 → "1430")
            eobt = eobt.toString().padStart(4, '0');
        } else if (typeof eobt === 'string') {
            // 콜론이 있으면 제거하고 4자리로 패딩
            eobt = eobt.replace(':', '').padStart(4, '0');
        }

        // EOBT는 이미 UTC이므로 변환 없이 그대로 사용
        const eobtUtc = eobt;

        const altitude = parseInt(cfl.replace('FL', ''));

        mockFlights.push({
            id: `F${3000 + idx}`,
            callsign: callsign,
            airport: dept,
            dept: dept,
            dest: dest,
            type: 'A321',
            eobt: eobt, // UTC time (from Excel)
            eobtUtc: eobtUtc, // Same as eobt (already UTC)
            atd: null,
            ctot: eobt,
            status: 'SCH',
            duration: 60,
            altitude: altitude,
            cfl: cfl,
            routeWaypoints: []
        });
    });

    // Convert EOBT to Operational Day Base Time (EOBD) for proper sorting
    // 운항일 기준: UTC 21:00 ~ 다음날 UTC 12:00 (KST 06:00 ~ 21:00)
    // 정렬 순서: UTC 21:00~23:59 → 00:00~12:00
    mockFlights.forEach(flight => {
        const eobtUtcSec = timeToSec(flight.eobtUtc);

        // Operational day starts at UTC 21:00 (KST 06:00)
        // UTC 21:00~23:59: 그대로 (먼저 표시)
        // UTC 00:00~20:59: +24시간 (나중에 표시)
        flight.eobd = eobtUtcSec < 21 * 3600 ? eobtUtcSec + 24 * 3600 : eobtUtcSec;
    });

    // Sort by EOBD - UTC 21:00+ comes first, then 00:00-20:59
    mockFlights.sort((a, b) => a.eobd - b.eobd);

    console.log(`EOBD sorting complete (UTC 21:00 기준). First 5 flights after sort:`);
    mockFlights.slice(0, 5).forEach((flight, idx) => {
        console.log(`  ${idx + 1}. ${flight.callsign} - UTC: ${flight.eobtUtc}, EOBD: ${flight.eobd}`);
    });
    console.log(`Last 3 flights:`);
    mockFlights.slice(-3).forEach((flight, idx) => {
        console.log(`  ${flight.callsign} - UTC: ${flight.eobtUtc}, EOBD: ${flight.eobd}`);
    });

    allFlights = mockFlights;
    selectedDayOfWeek = targetDayOfWeek;

    console.log(`✅ FLIGHTS LOADED SUCCESSFULLY:`);
    console.log(`  - Operational day: ${targetDate.toDateString()}`);
    console.log(`  - Day of week: ${targetDayOfWeek}`);
    console.log(`  - Total flights: ${allFlights.length}`);
    console.log(`  - Time range: ${allFlights[0]?.eobtUtc || 'N/A'} - ${allFlights[allFlights.length - 1]?.eobtUtc || 'N/A'} UTC`);

    renderFlightQueue();
    updateCTOTs(0);
    renderTimelineFlights();
}

function loadMockScheduleData() {
    console.log("=== LOADING MOCK SCHEDULE DATA ===");

    const mockFlights = [];
    const baseTimeSec = 6 * 3600; // Start at 06:00 UTC
    const timeRange = 18 * 3600; // Span 18 hours (until 24:00)

    // 김포는 거의 계속 운항, 다른 공항들과 섞여서 EOBT 생성
    const flightSchedule = [];

    // 김포(RKSS): 높은 빈도 - 전체 약 120편
    for (let i = 0; i < 120; i++) {
        flightSchedule.push({
            code: 'RKSS',
            callsign: `KAL${100 + i}`,
            eobtOffset: Math.random() * timeRange,
            prefs: [280, 260, 180, 160]
        });
    }

    // 청주(RKTU): 약 60편
    for (let i = 0; i < 60; i++) {
        flightSchedule.push({
            code: 'RKTU',
            callsign: `AAR${100 + i}`,
            eobtOffset: Math.random() * timeRange,
            prefs: [280, 260, 200, 140]
        });
    }

    // 군산(RKJK): 약 20편
    for (let i = 0; i < 20; i++) {
        flightSchedule.push({
            code: 'RKJK',
            callsign: `JNA${100 + i}`,
            eobtOffset: Math.random() * timeRange,
            prefs: [200, 180]
        });
    }

    // 광주(RKJJ): 약 20편
    for (let i = 0; i < 20; i++) {
        flightSchedule.push({
            code: 'RKJJ',
            callsign: `JJA${100 + i}`,
            eobtOffset: Math.random() * timeRange,
            prefs: [160, 140]
        });
    }

    console.log(`Created ${flightSchedule.length} flight schedules`);

    // 시간순으로 정렬하여 현실적인 섞임 구현
    flightSchedule.sort((a, b) => a.eobtOffset - b.eobtOffset);

    // Mock flight 객체 생성
    flightSchedule.forEach((sched, idx) => {
        const eobtSec = baseTimeSec + Math.floor(sched.eobtOffset);
        const alt = sched.prefs[idx % sched.prefs.length];

        // Operational Day calculation for mock data (Simple)
        // Assume current day
        const now = new Date();
        const operationalDateStr = now.getFullYear().toString() +
            (now.getMonth() + 1).toString().padStart(2, '0') +
            now.getDate().toString().padStart(2, '0');

        const eobdTimeStr = secToTime(eobtSec);

        mockFlights.push({
            id: `F${3000 + idx}`,
            callsign: sched.callsign,
            airport: sched.code,
            dept: sched.code, dest: 'RKPC', type: 'A321',
            eobt: secToTime(eobtSec),
            eobtUtc: secToTime(eobtSec), // Same as eobt for mock data
            eobdFormatted: `${operationalDateStr} ${eobdTimeStr}`,
            atd: null, ctot: secToTime(eobtSec),
            status: 'SCH', duration: 60, altitude: alt, cfl: `FL${alt}`, routeWaypoints: []
        });
    });

    allFlights = mockFlights;

    // Set sim time to current real time in UTC seconds
    const now = new Date();
    simTimeSeconds = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();

    console.log(`✅ MOCK DATA LOADED:`);
    console.log(`  - Total flights: ${allFlights.length}`);
    console.log(`  - Time range: ${allFlights[0]?.eobt || 'N/A'} - ${allFlights[allFlights.length - 1]?.eobt || 'N/A'}`);

    renderFlightQueue();
    updateCTOTs(0);
    renderTimelineFlights();
}

async function loadScheduleData() {
    // Check if we have Excel data, otherwise use mock data
    if (excelFlightData.length > 0) {
        loadFlightsForDate();
    } else {
        await loadMockScheduleData();
    }
}

// 타임라인 시간 범위 (동적으로 계산)
let timelineStartHour = 0;
let timelineEndHour = 24;

function initTimeline() {
    if (!els.timeAxis) return;
    els.timeAxis.innerHTML = '';

    // 비행 데이터 기반으로 시간 범위 계산
    if (allFlights.length > 0) {
        const times = allFlights.map(f => timeToSec(f.eobt || f.ctot)).filter(t => t > 0);
        if (times.length > 0) {
            const minTime = Math.min(...times);
            const maxTime = Math.max(...times);
            timelineStartHour = Math.max(0, Math.floor(minTime / 3600) - 1);
            timelineEndHour = Math.min(24, Math.ceil(maxTime / 3600) + 2);
        }
    }

    const PX_PER_SEC = 1350 / 3600;
    for (let h = timelineStartHour; h <= timelineEndHour; h++) {
        for (let m = 0; m < 60; m += 5) {
            const timeSec = h * 3600 + m * 60;
            const tick = document.createElement('div');

            // 정시(00분)는 major, 30분은 half-hour, 나머지는 minor
            if (m === 0) {
                tick.className = 'time-label-tick major';
                tick.textContent = `${h}:00`;
            } else if (m === 30) {
                tick.className = 'time-label-tick minor half-hour';
                tick.textContent = `:30`;
            } else {
                tick.className = 'time-label-tick minor';
                // 5분 단위 표시 (15, 45분은 숫자 표시)
                if (m === 15 || m === 45) {
                    tick.textContent = `:${m}`;
                }
            }

            tick.style.left = `${(timeSec - timelineStartHour * 3600) * PX_PER_SEC}px`;
            els.timeAxis.appendChild(tick);
        }
    }
    renderTimelineFlights();

    // Initialize timeline scroll to current simulation time
    setTimeout(() => {
        updateSimulationUI();
    }, 100);
}

function initFlightMap() {
    if (!els.mapSvg) return;

    // Update waypoint positions based on cumulative distance for the X-axis
    updateWaypointX();

    const gLanes = document.getElementById('altitude-lanes');
    if (gLanes) {
        gLanes.innerHTML = '';
        // Dashboard single line (hidden in fullscreen)
        const dashLine = createSvgEl('line', {
            id: 'dashboard-route-line',
            x1: 0, y1: 300, x2: 1600, y2: 300,
            stroke: 'rgba(255,255,255,0.1)', 'stroke-width': 1
        });
        gLanes.appendChild(dashLine);

        // Standard altitude lanes (hidden in dashboard)
        const laneGroup = createSvgEl('g', { id: 'altitude-lane-group' });
        const ground = createSvgEl('line', { x1: 0, y1: 800, x2: 1600, y2: 800, stroke: '#444', 'stroke-width': 2 });
        laneGroup.appendChild(ground);
        for (let fl = 140; fl <= 280; fl += 20) {
            const y = altitudeToY(fl);
            const line = createSvgEl('line', { x1: 0, y1: y, x2: 1600, y2: y, stroke: '#333', 'stroke-width': 1, 'stroke-dasharray': '5,5' });
            laneGroup.appendChild(line);
            const txt = createSvgEl('text', { x: 10, y: y + 4, fill: '#666', 'font-size': 10 });
            txt.textContent = `FL${fl}`;
            laneGroup.appendChild(txt);
        }
        gLanes.appendChild(laneGroup);
    }

    const gMP = document.getElementById('merge-points');
    if (gMP) {
        gMP.innerHTML = '';
        Object.keys(waypointsX).forEach(name => {
            const x = waypointsX[name];
            // Highlight merge points with different colors
            const isMergePoint = ['MEKIL', 'MANGI', 'DALSU'].includes(name);
            const lineColor = isMergePoint ? 'var(--accent-orange)' : 'var(--accent-cyan)';
            const textColor = isMergePoint ? 'var(--accent-orange)' : 'var(--accent-cyan)';
            const strokeWidth = isMergePoint ? 2 : 1;
            const opacity = isMergePoint ? 0.7 : 0.3;

            const line = createSvgEl('line', {
                x1: x, y1: 0, x2: x, y2: 800,
                stroke: lineColor,
                'stroke-width': strokeWidth,
                'stroke-dasharray': '2,2',
                opacity: opacity
            });
            gMP.appendChild(line);

            const txt = createSvgEl('text', {
                x: x, y: 20,
                fill: textColor,
                'text-anchor': 'middle',
                'font-size': isMergePoint ? 24 : 20,
                'font-weight': isMergePoint ? 'bold' : 'normal',
                'style': 'text-shadow: 0 0 3px #000;'
            });
            txt.textContent = name;
            gMP.appendChild(txt);
        });
    }

    const gAirports = document.getElementById('airport-labels');
    if (gAirports) {
        gAirports.innerHTML = '';
        Object.keys(airportDatabase).forEach(code => {
            const x = getAirportX(code);
            const apt = airportDatabase[code];
            const color = apt.color || '#fff';

            // Draw a marker (circle) - 지상 레벨에 배치
            const circle = createSvgEl('circle', { cx: x, cy: 800, r: 8, fill: color, stroke: '#fff', 'stroke-width': 2 });
            gAirports.appendChild(circle);

            // Draw the airport name (공항명) above circle
            const nameTxt = createSvgEl('text', { x: x, y: 785, 'text-anchor': 'middle', fill: color, 'font-size': 14, 'font-weight': 'bold', 'style': 'text-shadow: 0 0 4px #000;' });
            nameTxt.textContent = apt.name;
            gAirports.appendChild(nameTxt);

            // Draw the airport code text below circle (화면 하단)
            const txt = createSvgEl('text', { x: x, y: 825, 'text-anchor': 'middle', fill: '#aaa', 'font-size': 11, 'font-weight': 'normal', 'style': 'text-shadow: 0 0 4px #000;' });
            txt.textContent = code;
            gAirports.appendChild(txt);
        });
    }

    const gAirportCallouts = document.getElementById('airport-callouts');
    if (gAirportCallouts) {
        gAirportCallouts.innerHTML = '';
        const sortedAirports = Object.keys(airportDatabase)
            .sort((a, b) => getAirportX(a) - getAirportX(b));

        sortedAirports.forEach((code, index) => {
            const x = getAirportX(code);
            const apt = airportDatabase[code];
            const color = apt.color || '#fff';
            const boxWidth = 150;
            const boxHeight = 28;
            const calloutY = 40 + index * 34;
            const anchorY = 250;

            const guide = createSvgEl('line', {
                x1: x,
                y1: calloutY + boxHeight / 2,
                x2: x,
                y2: anchorY,
                stroke: color,
                'stroke-width': 1,
                'stroke-dasharray': '4,4',
                opacity: 0.5
            });
            gAirportCallouts.appendChild(guide);

            const rect = createSvgEl('rect', {
                x: x - boxWidth / 2,
                y: calloutY - boxHeight / 2,
                width: boxWidth,
                height: boxHeight,
                rx: 8,
                fill: 'rgba(5, 10, 20, 0.8)',
                stroke: color,
                'stroke-width': 1.2
            });
            gAirportCallouts.appendChild(rect);

            const nameText = createSvgEl('text', {
                x: x,
                y: calloutY - 2,
                'text-anchor': 'middle',
                fill: '#ffffff',
                'font-size': 13,
                'font-weight': 'bold',
                'style': 'text-shadow: 0 0 4px #000;'
            });
            nameText.textContent = apt.name;
            gAirportCallouts.appendChild(nameText);

            const metaText = createSvgEl('text', {
                x: x,
                y: calloutY + 11,
                'text-anchor': 'middle',
                fill: '#c5d5ff',
                'font-size': 11,
                'style': 'text-shadow: 0 0 4px #000;'
            });
            metaText.textContent = `${code} → ${apt.mergePoint}`;
            gAirportCallouts.appendChild(metaText);
        });
    }
}

function resetSimulation() {
    if (simInterval) { clearInterval(simInterval); simInterval = null; }
    if (els.playBtn) els.playBtn.textContent = '▶';

    // Reset simulation time to current UTC (CTOT values preserved)
    const now = new Date();
    simTimeSeconds = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();

    // UI만 업데이트 (데이터 리로드 안 함 - CTOT 유지)
    updateSimulationUI();
    updateFlightMap();
    renderFlightQueue();
    renderTimelineFlights();

    console.log("Simulation Reset Complete (CTOT preserved).");
}

function togglePlay() {
    if (simInterval) {
        clearInterval(simInterval);
        simInterval = null;
        els.playBtn.textContent = '▶';
    } else {
        // 기준 항공기(⭐)가 있으면 그 시간부터 시작, 없으면 선택된 항공기 시간
        const targetFlightId = referenceFlightId || lastSelectedFlightId;
        if (targetFlightId) {
            const flight = allFlights.find(f => f.id === targetFlightId);
            if (flight) {
                const startTimeStr = flight.atd || flight.ctot;
                if (startTimeStr) {
                    const startTimeSec = timeToSec(startTimeStr);
                    simTimeSeconds = Math.max(0, startTimeSec - 120); // 2 minutes before departure
                    updateSimulationUI();
                    updateFlightMap();
                }
            }
        }

        simInterval = setInterval(() => {
            simTimeSeconds += simSpeed;
            updateSimulationUI();
            updateFlightMap();
        }, 1000 / 60);
        els.playBtn.textContent = '⏸';
    }
}

let lastScrollUpdate = 0; // Throttle scroll updates

function updateSimulationUI() {
    const timeStr = secToTime(Math.floor(simTimeSeconds));
    if (els.simClock) els.simClock.textContent = timeStr;
    if (els.mapSimClock) els.mapSimClock.textContent = timeStr;

    const windowStartSec = timelineStartHour * 3600;
    const windowEndSec = timelineEndHour * 3600;
    const PX_PER_SEC = 1350 / 3600;

    // 24시간 순환 처리된 시뮬레이션 시간
    const simTimeInDay = simTimeSeconds % 86400;

    // 마커 위치 계산 (24시간 순환 적용)
    const markerPos = (simTimeInDay - windowStartSec) * PX_PER_SEC;

    // 마커는 매 프레임 부드럽게 이동 (throttle 없음)
    if (els.timeMarker) {
        if (simTimeInDay >= windowStartSec && simTimeInDay <= windowEndSec) {
            els.timeMarker.style.left = `${markerPos}px`;
            els.timeMarker.style.display = 'block';
        } else {
            els.timeMarker.style.display = 'none';
        }
    }

    // 스크롤만 2초마다 업데이트 (마커는 계속 부드럽게 이동)
    const now = Date.now();
    if (now - lastScrollUpdate > 2000) {
        lastScrollUpdate = now;

        const timelineScrollArea = document.querySelector('.timeline-scroll-area');
        if (timelineScrollArea && simTimeInDay >= windowStartSec && simTimeInDay <= windowEndSec) {
            const scrollLeft = Math.max(0, markerPos - (timelineScrollArea.clientWidth / 2));
            timelineScrollArea.scrollTo({
                left: scrollLeft,
                behavior: 'smooth'
            });
        }
    }
}

function jumpTime(sec) {
    simTimeSeconds += sec;
    updateSimulationUI();
    updateFlightMap();
}

function selectFlight(id) {
    lastSelectedFlightId = id;
    document.querySelectorAll('.active-flight').forEach(e => e.classList.remove('active-flight'));
    const qItem = Array.from(els.flightQueue?.children || []).find(el => el.dataset.id === id);
    if (qItem) qItem.classList.add('active-flight');

    document.querySelectorAll('.flight-block.selected').forEach(e => e.classList.remove('selected'));
    const tBlock = document.querySelector(`.flight-block[data-id="${id}"]`);
    if (tBlock) {
        tBlock.classList.add('selected');
        tBlock.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
}

function renderSettings() {
    console.log('Rendering settings...');
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

    // Airport Configuration
    const airportContainer = document.getElementById('airport-config');
    if (airportContainer) {
        airportContainer.innerHTML = '';
        Object.keys(airportDatabase).forEach(code => {
            const airport = airportDatabase[code];
            const div = document.createElement('div');
            div.className = 'airport-config-item';
            div.style.cssText = 'display:grid; grid-template-columns: 1fr 1fr 1fr 0.5fr; gap:0.5rem; margin-bottom:0.5rem; align-items:center;';
            div.innerHTML = `
                <span style="font-weight:600; color:${airport.color}">${code} (${airport.name})</span>
                <input type="number" id="taxi-${code}" value="${airport.taxiTime}" min="5" max="60" style="padding:4px; background:rgba(0,0,0,0.3); border:1px solid var(--border-color); color:white; border-radius:4px;">
                <input type="number" id="dep-${code}" value="${airport.depInterval}" min="1" max="30" style="padding:4px; background:rgba(0,0,0,0.3); border:1px solid var(--border-color); color:white; border-radius:4px;">
                <input type="color" id="color-${code}" value="${airport.color}" style="width:40px; height:28px; border:none; cursor:pointer; border-radius:4px;">
            `;
            airportContainer.appendChild(div);
        });
    }

    const wpList = document.getElementById('waypoints-config-list');
    if (wpList) {
        wpList.innerHTML = '';
        if (Array.isArray(waypoints)) {
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
        }
        document.querySelectorAll('.delete-wp').forEach(btn => btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.dataset.idx);
            if (!isNaN(idx)) {
                waypoints.splice(idx, 1);
                renderSettings();
            }
        }));
    }
    console.log('Settings rendered successfully');
}

function addWaypointInput() { waypoints.push({ from: '', to: '', duration: 10 }); renderSettings(); }

// CSS 변수 동적 업데이트 (Legend용)
function updateCssVariables() {
    const root = document.documentElement;
    root.style.setProperty('--gmp-color', airportDatabase['RKSS'].color);
    root.style.setProperty('--cjj-color', airportDatabase['RKTU'].color);
    root.style.setProperty('--kuv-color', airportDatabase['RKJK'].color);
    root.style.setProperty('--kwj-color', airportDatabase['RKJJ'].color);
}

function saveSettings() {
    // Save entry segment configs
    Object.keys(segmentConfig).forEach(key => {
        const input = document.getElementById(`cfg-${key}`);
        if (input) segmentConfig[key] = parseInt(input.value) || segmentConfig[key];
    });

    // Save airport configurations
    Object.keys(airportDatabase).forEach(code => {
        const taxiInput = document.getElementById(`taxi-${code}`);
        const depInput = document.getElementById(`dep-${code}`);
        const colorInput = document.getElementById(`color-${code}`);

        if (taxiInput) {
            airportDatabase[code].taxiTime = parseInt(taxiInput.value) || airportDatabase[code].taxiTime;
        }
        if (depInput) {
            airportDatabase[code].depInterval = parseInt(depInput.value) || airportDatabase[code].depInterval;
        }
        if (colorInput) {
            airportDatabase[code].color = colorInput.value;
        }
    });

    // Update CSS variables for Legend
    updateCssVariables();

    // Save waypoints
    const newWaypoints = [];
    document.querySelectorAll('.waypoint-list-item').forEach(item => {
        const inputs = item.querySelectorAll('input');
        if (inputs.length >= 3) {
            newWaypoints.push({
                from: inputs[0].value,
                to: inputs[1].value,
                duration: parseInt(inputs[2].value) || 10
            });
        }
    });
    waypoints = newWaypoints;

    alert('Settings Saved!\nAirport configurations and waypoints updated.');
    els.settingsModal?.classList.add('hidden');

    // Recalculate CTOTs with new settings
    updateCTOTs(0);

    // Refresh UI with new colors
    renderFlightQueue();
    renderTimelineFlights();
    initFlightMap();

    console.log('Settings saved:', { segmentConfig, airportDatabase, waypoints });
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('App starting (sync phase)...');
    cacheOMElements();
    setupEventListeners();

    // Expose for debugging
    window.fmsDebug = {
        getFlights: () => allFlights,
        getEls: () => els,
        getDB: () => db,
        render: () => renderFlightQueue(),
        isReady: false
    };

    // Run async initialization separately
    (async () => {
        console.log('App starting (async phase)...');
        updateWaypointDurations();

        try {
            console.log('Initializing database...');
            await initDatabase();
            console.log('Loading schedule data...');
            await loadScheduleData();

            console.log('Final UI rendering...');
            renderFlightQueue();
            updateCTOTs(0);
            initTimeline();
            initFlightMap();
            updateSimulationUI();

            window.fmsDebug.isReady = true;
            console.log('App initialization complete. Flights:', allFlights.length);
        } catch (err) {
            console.error('CRITICAL INIT ERROR:', err);
        }
    })();
});
