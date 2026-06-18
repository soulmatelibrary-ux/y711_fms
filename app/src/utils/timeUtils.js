/**
 * UTC 시간 문자열(HHmm) ↔ 초(seconds) 변환 유틸
 */


export function timeToSec(timeStr) {
    if (!timeStr) return NaN;
    const clean = timeStr.toString().replace(/[^\d]/g, '');
    if (clean.length < 4) return NaN;
    const h = parseInt(clean.slice(0, -2), 10);
    const m = parseInt(clean.slice(-2), 10);
    if (isNaN(h) || isNaN(m) || h > 23 || m > 59) return NaN;
    return h * 3600 + m * 60;
}

export function secToTime(totalSec) {
    const s = ((totalSec % 86400) + 86400) % 86400;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return String(h).padStart(2, '0') + String(m).padStart(2, '0');
}

export function nowUtcSec() {
    const now = new Date();
    return now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
}

export function nowUtcTime() {
    return secToTime(nowUtcSec());
}

export function formatHHMMSS() {
    const s = nowUtcSec();
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(Math.floor(s % 60)).padStart(2, '0');
    return `${h}:${m}:${sec}`;
}

export function todayUtcDate() {
    const now = new Date();
    return now.toISOString().slice(0, 10);
}

// "1015" → "10:15"
export function formatDisplay(hhmm) {
    if (!hhmm || hhmm.length < 4) return '--:--';
    return `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
}

// UTC 자정 경계 보정: 00:00~14:59 UTC(=09:00~23:59 KST)는 전날 15:00 UTC 이후 연속
export function toAbsSec(s) {
    return s > 0 && s < 15 * 3600 ? s + 86400 : s;
}

// diff in minutes between two HHmm strings (UTC 자정 경계 보정 포함)
export function diffMinutes(timeA, timeB) {
    return Math.round((toAbsSec(timeToSec(timeB)) - toAbsSec(timeToSec(timeA))) / 60);
}

// innerHTML에 삽입하기 전 HTML 특수문자 이스케이프
export function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
