/**
 * API fetch 래퍼 — 인증 헤더 자동 첨부 + 401 통일 + idle 타임아웃
 */

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30분
let _idleTimer = null;
let _authEnabled = true;

export function configureAuth({ enabled }) {
    _authEnabled = enabled;
    if (!enabled) {
        clearTimeout(_idleTimer);
        _idleTimer = null;
    }
}

function resetIdleTimer() {
    if (!_authEnabled) return;
    clearTimeout(_idleTimer);
    _idleTimer = setTimeout(handleUnauthorized, IDLE_TIMEOUT_MS);
}

// 사용자 활동 시 타이머 리셋
['mousemove', 'keydown', 'click', 'touchstart'].forEach(evt => {
    window.addEventListener(evt, resetIdleTimer, { passive: true });
});
resetIdleTimer();

function getAuthHeaders() {
    const userId = localStorage.getItem('userId');
    const username = localStorage.getItem('username');
    return {
        'Content-Type': 'application/json',
        'x-user-id': userId || '',
        'x-username': username || ''
    };
}

function handleUnauthorized() {
    if (!_authEnabled) return;
    localStorage.removeItem('userId');
    localStorage.removeItem('username');
    localStorage.removeItem('acc_v2_ui_prefs');
    window.location.href = '/login.html';
    throw new Error('Unauthorized');
}

async function parseJsonResponse(res) {
    const text = await res.text();
    if (!text || !text.trim()) throw new Error(`서버 응답 없음 (HTTP ${res.status})`);
    try {
        return JSON.parse(text);
    } catch (_) {
        throw new Error(`서버 응답 파싱 실패 (HTTP ${res.status}): ${text.slice(0, 80)}`);
    }
}

export async function apiGet(path) {
    const res = await fetch(path, { headers: getAuthHeaders() });
    if (res.status === 401) handleUnauthorized();
    const data = await parseJsonResponse(res);
    if (!data.success) throw new Error(data.error || 'API error');
    return data;
}

export async function apiPost(path, body) {
    const res = await fetch(path, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(body)
    });
    if (res.status === 401) handleUnauthorized();
    const data = await parseJsonResponse(res);
    if (!data.success) throw new Error(data.error || 'API error');
    return data;
}

export async function apiPut(path, body) {
    const res = await fetch(path, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(body)
    });
    if (res.status === 401) handleUnauthorized();
    const data = await parseJsonResponse(res);
    if (!data.success) throw new Error(data.error || 'API error');
    return data;
}

export async function apiDelete(path) {
    const res = await fetch(path, {
        method: 'DELETE',
        headers: getAuthHeaders()
    });
    if (res.status === 401) handleUnauthorized();
    const data = await parseJsonResponse(res);
    if (!data.success) throw new Error(data.error || 'API error');
    return data;
}

export async function apiPatch(path, body) {
    const res = await fetch(path, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(body)
    });
    if (res.status === 401) handleUnauthorized();
    const data = await parseJsonResponse(res);
    if (!data.success) throw new Error(data.error || 'API error');
    return data;
}
