/**
 * 유틸리티 헬퍼 함수들
 */

export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDateRange(startStr, endStr) {
    if (!startStr || !endStr) return '기간을 선택하세요';

    const start = new Date(startStr);
    const end = new Date(endStr);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const diffMonths = Math.round(diffDays / 30);

    let periodText = '';
    if (diffMonths === 1) periodText = '약 1개월';
    else if (diffMonths < 12) periodText = `약 ${diffMonths}개월`;
    else if (diffMonths === 12) periodText = '약 1년';
    else periodText = `약 ${(diffMonths / 12).toFixed(1)}년`;

    return `${startStr} ~ ${endStr} (${periodText})`;
}

export function validateTime(str) {
    if (!str) return false;
    // "HHMM" 형식 (콜론 없음)
    if (/^([01]?[0-9]|2[0-3])[0-5][0-9]$/.test(str)) return true;
    // "HH:MM" 형식 (하위 호환)
    if (/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(str)) return true;
    return false;
}

export function createSvgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
}

export function timeStringToSeconds(timeStr) {
    if (!timeStr) return 0;

    // "HHMM" 형식 (콜론 없음)
    if (/^\d{4}$/.test(timeStr)) {
        const hours = parseInt(timeStr.substring(0, 2));
        const minutes = parseInt(timeStr.substring(2, 4));
        return hours * 3600 + minutes * 60;
    }

    // "HH:MM" 형식
    const [hourStr, minStr] = timeStr.split(':');
    if (hourStr && minStr) {
        const hours = parseInt(hourStr);
        const minutes = parseInt(minStr);
        return hours * 3600 + minutes * 60;
    }

    return 0;
}

export function secondsToTimeString(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${String(hours).padStart(2, '0')}${String(minutes).padStart(2, '0')}`;
}

export function altitudeToY(fl) {
    /* LIVE ROUTE MAP 고도 범위: FL100(10,000ft) ~ FL320(32,000ft) */
    const mapHeight = 400; // SVG 높이
    const flMin = 100;
    const flMax = 320;
    const y = ((flMax - fl) / (flMax - flMin)) * mapHeight;
    return Math.max(10, Math.min(mapHeight - 10, y));
}

export function getDayOfWeek(date) {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return days[date.getDay()];
}

export function getDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function parseTime(timeStr) {
    if (!timeStr) return null;

    // "HHMM" 형식 처리
    if (/^\d{4}$/.test(timeStr)) {
        const hours = parseInt(timeStr.substring(0, 2));
        const minutes = parseInt(timeStr.substring(2, 4));
        return { hours, minutes, string: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}` };
    }

    // "HH:MM" 형식 처리
    const [hourStr, minStr] = timeStr.split(':');
    if (hourStr && minStr) {
        const hours = parseInt(hourStr);
        const minutes = parseInt(minStr);
        return { hours, minutes, string: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}` };
    }

    return null;
}

/**
 * CTOT 상태 결정 함수
 * @param {Object} flight - 항공편 정보
 * @param {Object} prevFlight - 이전 항공편
 * @param {Object} nextFlight - 다음 항공편
 * @param {number} separationInterval - 분리 기준 (초 단위)
 * @returns {string} 상태: 'normal', 'delayed', 'early', 'manual', 'conflict'
 */
export function getCtotStatus(flight, prevFlight, nextFlight, separationInterval = 180) {
    const eobtSec = timeStringToSeconds(flight.eobt_utc || flight.eobt);
    const ctotSec = timeStringToSeconds(flight.ctot || flight.eobt_utc || flight.eobt);

    if (!ctotSec || !eobtSec) return 'normal';

    const diffMin = (ctotSec - eobtSec) / 60;
    const statuses = [];

    // 간격 위반 체크 (최우선)
    if (nextFlight && (nextFlight.ctot || nextFlight.eobt_utc)) {
        const nextCtotSec = timeStringToSeconds(nextFlight.ctot || nextFlight.eobt_utc);
        if (nextCtotSec) {
            const gapSec = nextCtotSec - ctotSec;
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

// 별칭: timeToSec() = timeStringToSeconds()
export const timeToSec = timeStringToSeconds;
