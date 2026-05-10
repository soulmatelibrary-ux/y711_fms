/**
 * ATD 입력 → cascade CTOT 재계산 → 이벤트 발행
 */
import { timeToSec, secToTime, nowUtcTime } from '../utils/timeUtils.js';
import { recalcFrom } from './ctotEngine.js';
import { detectConflicts } from './conflictDetector.js';
import { apiPost } from '../utils/api.js';
import { showToast, showUndoToast } from '../utils/toast.js';

// 앱 전역 상태 (main.js에서 초기화)
let _state = null;

// Undo 스택 (최대 10단계)
const _undoStack = [];
const MAX_UNDO = 10;

export function initAtdManager(state) {
    _state = state;
}

export function canUndo() {
    return _undoStack.length > 0;
}

export function undoAtd() {
    if (!_state || !_undoStack.length) return;
    const snap = _undoStack.pop();
    _state.flights = snap.flights;
    _state.conflicts = detectConflicts(snap.flights);
    _state.prevFlights = snap.flights.map(f => ({ ...f }));
    document.dispatchEvent(new CustomEvent('atd:updated', {
        detail: { flightId: null, diffs: [], conflicts: _state.conflicts, auditEntry: null, isUndo: true }
    }));
}

/**
 * ATD 확정 + cascade 재계산
 * @param {string} flightId
 * @param {string} atdHHMM - "1023" 형태
 * @param {string} reason - "manual" | "now_btn" | "drag"
 */
export async function setAtd(flightId, atdHHMM, reason = 'manual') {
    if (!_state) return;

    const flight = _state.flights.find(f => f.id === flightId);
    if (!flight) return;

    const prevAtd = flight.atd || null;

    // 롤백용 스냅샷 저장 (Undo 스택과 별도로 보관)
    const savedFlights = _state.flights.map(f => ({ ...f }));

    // Undo 스택에 현재 상태 저장
    _undoStack.push({ flights: savedFlights });
    if (_undoStack.length > MAX_UNDO) _undoStack.shift();

    // diff 계산용 스냅샷 (뮤테이션 전 캡처)
    const snapshot = (_state.prevFlights || _state.flights).map(f => ({ ...f }));

    // 1. 로컬 상태 낙관적 업데이트
    flight.atd = atdHHMM;
    flight.status = 'DEP';
    const recalculated = recalcFrom(_state.flights, flightId);
    _state.flights = recalculated;

    const diffs = [];
    recalculated.forEach(f => {
        const orig = snapshot.find(p => p.id === f.id);
        if (orig && orig.ctot !== f.ctot) {
            diffs.push({
                flightId: f.id,
                callsign: f.callsign,
                dept: f.dept,
                prevCtot: orig.ctot,
                newCtot: f.ctot,
                deltaMins: Math.round((timeToSec(f.ctot) - timeToSec(orig.ctot)) / 60)
            });
        }
    });

    const conflicts = detectConflicts(recalculated);
    _state.conflicts = conflicts;

    const auditEntry = {
        time: nowUtcTime(),
        flightId,
        callsign: flight.callsign,
        dept: flight.dept,
        prevAtd,
        newAtd: atdHHMM,
        reason,
        diffs,
        user: localStorage.getItem('username') || 'unknown'
    };
    _state.auditLog = [auditEntry, ...(_state.auditLog || [])].slice(0, 100);
    _state.prevFlights = recalculated.map(f => ({ ...f }));

    // 2. UI 즉시 갱신 (낙관적 업데이트)
    document.dispatchEvent(new CustomEvent('atd:updated', {
        detail: { flightId, atdHHMM, diffs, conflicts, auditEntry }
    }));

    // 3. 서버 저장 — 실패 시 UI 롤백
    try {
        await apiPost('/api/v2/atd', { flightId, atd: atdHHMM, prevAtd, reason });
        apiPost('/api/v2/change-log', {
            event_type: 'atd_set',
            flight_id: flightId,
            callsign: flight.callsign,
            dept: flight.dept,
            prev_value: prevAtd,
            new_value: atdHHMM,
            cascade_diffs: JSON.stringify(diffs),
            reason
        }).catch(e => console.warn('change-log 저장 실패:', e.message));
    } catch (e) {
        console.warn('ATD 서버 저장 실패 — 롤백:', e.message);
        _undoStack.pop();
        _state.flights = savedFlights;
        _state.conflicts = detectConflicts(savedFlights);
        _state.prevFlights = savedFlights.map(f => ({ ...f }));
        _state.auditLog = (_state.auditLog || []).filter(entry => entry !== auditEntry);
        document.dispatchEvent(new CustomEvent('atd:updated', {
            detail: { flightId: null, diffs: [], conflicts: _state.conflicts, auditEntry: null, isRollback: true }
        }));
        showToast(`ATD 저장 실패 — ${flight.callsign} (변경 취소됨)`, 'error');
        return;
    }

    showUndoToast(`ATD 설정 — ${flight.callsign}`, undoAtd);
    return { diffs, conflicts };
}

/**
 * CTOT 조정 (ATD 확정 없이 일정 변경)
 * 미출발 항공편의 CTOT만 조정하고 cascade 재계산
 */
export async function adjustCtot(flightId, newCtotHHMM) {
    if (!_state) return;
    const flight = _state.flights.find(f => f.id === flightId);
    if (!flight || flight.status === 'DEP') return;

    _undoStack.push({ flights: _state.flights.map(f => ({ ...f })) });
    if (_undoStack.length > MAX_UNDO) _undoStack.shift();

    const snapshot = _state.flights.map(f => ({ ...f }));
    const prevCtot = flight.ctot;
    flight.ctot = newCtotHHMM;
    flight.ctotFloor = newCtotHHMM; // recalcAll이 수동 값을 덮어쓰지 않도록 잠금

    const recalculated = recalcFrom(_state.flights, flightId);
    _state.flights = recalculated;
    _state.conflicts = detectConflicts(recalculated);

    const diffs = [];
    recalculated.forEach(f => {
        const orig = snapshot.find(p => p.id === f.id);
        if (orig && orig.ctot !== f.ctot) {
            diffs.push({
                flightId: f.id,
                callsign: f.callsign,
                dept: f.dept,
                prevCtot: orig.ctot,
                newCtot: f.ctot,
                deltaMins: Math.round((timeToSec(f.ctot) - timeToSec(orig.ctot)) / 60)
            });
        }
    });

    const auditEntry = {
        time: nowUtcTime(),
        flightId,
        callsign: flight.callsign,
        dept: flight.dept,
        prevCtot,
        newCtot: newCtotHHMM,
        reason: 'manual_ctot_adjust',
        diffs,
        user: localStorage.getItem('username') || 'unknown'
    };
    _state.auditLog = [auditEntry, ...(_state.auditLog || [])].slice(0, 100);
    _state.prevFlights = recalculated.map(f => ({ ...f }));

    document.dispatchEvent(new CustomEvent('atd:updated', {
        detail: { flightId, diffs, conflicts: _state.conflicts, auditEntry }
    }));

    apiPost('/api/v2/change-log', {
        event_type: 'ctot_adjust',
        flight_id: flightId,
        callsign: flight.callsign,
        dept: flight.dept,
        prev_value: prevCtot,
        new_value: newCtotHHMM,
        cascade_diffs: JSON.stringify(diffs),
        reason: 'manual_ctot_adjust'
    }).catch(e => console.warn('change-log 저장 실패:', e.message));

    return { diffs, conflicts: _state.conflicts };
}

/**
 * What-if 모드: ATD 확정 없이 미리보기 (setAtd 결과 시뮬레이션)
 */
export function previewAtd(flights, flightId, atdHHMM) {
    const copy = flights.map(f => ({ ...f }));
    const f = copy.find(fl => fl.id === flightId);
    if (!f) return { flights: copy, conflicts: [] };
    f.atd = atdHHMM;
    f.status = 'DEP';
    const recalc = recalcFrom(copy, flightId);
    const conflicts = detectConflicts(recalc);
    return { flights: recalc, conflicts };
}

/**
 * CTOT 변경 미리보기 (resolveConflictDelay 결과 시뮬레이션)
 * ConflictWizard의 옵션 hover 미리보기에서 사용
 */
export function previewCtot(flights, flightId, newCtotHHMM) {
    const copy = flights.map(f => ({ ...f }));
    const f = copy.find(fl => fl.id === flightId);
    if (!f) return { flights: copy, conflicts: [] };
    f.ctot = newCtotHHMM;
    const recalc = recalcFrom(copy, flightId);
    const conflicts = detectConflicts(recalc);
    return { flights: recalc, conflicts };
}

/**
 * 충돌 해결 — 후행편 CTOT 지연
 */
export async function resolveConflictDelay(conflict, reason = 'conflict_resolve') {
    if (!_state) return;

    const f2 = conflict.f2;
    const neededDelaySec = conflict.requiredSec - conflict.timeDiffSec + 30; // 30초 버퍼
    const newCtotSec = timeToSec(f2.ctot) + neededDelaySec;
    const newCtot = secToTime(newCtotSec);

    _undoStack.push({ flights: _state.flights.map(f => ({ ...f })) });
    if (_undoStack.length > MAX_UNDO) _undoStack.shift();

    const f = _state.flights.find(fl => fl.id === f2.id);
    if (!f) return;

    const prevCtot = f.ctot;
    f.ctot = newCtot;
    f.ctotFloor = newCtot; // 충돌 해결로 설정된 CTOT 잠금
    const recalculated = recalcFrom(_state.flights, f2.id);
    _state.flights = recalculated;
    _state.conflicts = detectConflicts(recalculated);

    const auditEntry = {
        time: nowUtcTime(),
        flightId: f2.id,
        callsign: f2.callsign,
        dept: f2.dept,
        prevCtot,
        newCtot,
        reason,
        diffs: [{ flightId: f2.id, callsign: f2.callsign, dept: f2.dept, prevCtot, newCtot,
            deltaMins: Math.round((timeToSec(newCtot) - timeToSec(prevCtot)) / 60) }],
        user: localStorage.getItem('username') || 'unknown'
    };
    _state.auditLog = [auditEntry, ...(_state.auditLog || [])].slice(0, 100);

    document.dispatchEvent(new CustomEvent('atd:updated', {
        detail: { flightId: f2.id, diffs: auditEntry.diffs, conflicts: _state.conflicts, auditEntry }
    }));

    apiPost('/api/v2/change-log', {
        event_type: 'conflict_resolve',
        flight_id: f2.id,
        callsign: f2.callsign,
        dept: f2.dept,
        prev_value: prevCtot,
        new_value: newCtot,
        cascade_diffs: JSON.stringify(auditEntry.diffs),
        reason
    }).catch(e => console.warn('change-log 저장 실패:', e.message));
}
