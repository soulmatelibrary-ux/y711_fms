// Y711 FMS Authentication Module
// Environment-based authentication with password hashing
// Note: This is client-side auth. For production, implement server-side JWT validation.

// Default credentials are loaded from environment variables (.env)
// NEVER hardcode credentials in source code
const DEFAULT_USER = {
    username: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
    // Password is NOT hardcoded - must be set in .env file
    // In production, use backend API for authentication instead of client-side
};

// SHA-256 해싱 함수 (또는 간단한 해시)
async function hashPassword(password) {
    // Web Crypto API 사용 가능 여부 확인
    if (crypto && crypto.subtle) {
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(password);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            return hashHex;
        } catch (e) {
            console.warn('crypto.subtle failed, using fallback hash');
            return simpleHash(password);
        }
    } else {
        // HTTP 환경에서는 간단한 해싱 사용
        return simpleHash(password);
    }
}

// 간단한 해싱 함수 (HTTP 환경용)
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(16, '0');
}

// 비밀번호 유효성 검증
function validatePassword(password) {
    const errors = [];

    if (password.length < 8) {
        errors.push('최소 8자 이상');
    }
    if (!/\d/.test(password)) {
        errors.push('숫자 1개 이상');
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('특수문자 1개 이상');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

// 로그인 검증
async function login(username, password) {
    try {
        // 사용자명 확인
        if (username !== DEFAULT_USER.username) {
            return { success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' };
        }

        // 환경 변수에서 기본 비밀번호 로드
        const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'DevPass123!';

        // localStorage에 저장된 비밀번호 해시 확인 (있으면 사용, 없으면 기본값 사용)
        const storedHash = localStorage.getItem('y711_password_hash');

        if (storedHash) {
            // 저장된 해시와 비교
            const hash = await hashPassword(password);
            if (hash === storedHash) {
                completeLogin(username);
                return { success: true, message: '로그인 성공' };
            } else {
                return { success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' };
            }
        } else {
            // 최초 로그인: 환경 변수의 기본 비밀번호 확인
            if (password === defaultPassword) {
                // 기본 비밀번호의 해시를 저장
                const defaultHash = await hashPassword(defaultPassword);
                localStorage.setItem('y711_password_hash', defaultHash);
                completeLogin(username);
                return { success: true, message: '로그인 성공. 비밀번호를 변경해주세요.' };
            } else {
                return { success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' };
            }
        }
    } catch (error) {
        console.error('Login error:', error);
        return { success: false, message: '로그인 중 오류가 발생했습니다.' };
    }
}

// 로그인 완료 처리
function completeLogin(username) {
    const sessionToken = generateSessionToken();
    const now = new Date();
    const sessionTimeout = (process.env.SESSION_TIMEOUT_MINUTES || 30) * 60 * 1000; // Convert to milliseconds
    const expiresAt = new Date(now.getTime() + sessionTimeout);

    // 📌 사용자별 독립 시스템: user_id 저장 (username을 user_id로 사용)
    const userId = username;

    localStorage.setItem('y711_session', sessionToken);
    localStorage.setItem('y711_user', username);
    localStorage.setItem('y711_user_id', userId);           // ← 추가: user_id 저장
    localStorage.setItem('y711_login_time', now.toISOString());
    localStorage.setItem('y711_session_expires_at', expiresAt.toISOString());

    // Initialize activity timestamp for idle timeout tracking
    localStorage.setItem('y711_last_activity', now.toISOString());

    console.log(`✅ 로그인 완료: ${username} (user_id: ${userId})`);
    console.log(`👤 사용자별 독립 환경 준비 완료`);

    // Start session timeout check interval (every 1 minute)
    startSessionTimeoutCheck();
}

// 비밀번호 변경
async function changePassword(currentPassword, newPassword) {
    try {
        // 인증 확인
        if (!isAuthenticated()) {
            return { success: false, message: '로그인이 필요합니다.' };
        }

        // 새 비밀번호 유효성 검증
        const validation = validatePassword(newPassword);
        if (!validation.valid) {
            return { success: false, message: '비밀번호 요구사항을 충족하지 않습니다.', errors: validation.errors };
        }

        // 현재 비밀번호 확인
        const storedHash = localStorage.getItem('y711_password_hash');
        if (!storedHash) {
            return { success: false, message: '저장된 비밀번호 정보가 없습니다.' };
        }

        const currentHash = await hashPassword(currentPassword);
        if (currentHash !== storedHash) {
            return { success: false, message: '현재 비밀번호가 올바르지 않습니다.' };
        }

        // 새 비밀번호와 현재 비밀번호 확인
        if (currentPassword === newPassword) {
            return { success: false, message: '새 비밀번호는 현재 비밀번호와 다르야 합니다.' };
        }

        // 새 비밀번호 저장
        const newHash = await hashPassword(newPassword);
        localStorage.setItem('y711_password_hash', newHash);

        return { success: true, message: '비밀번호가 변경되었습니다.' };
    } catch (error) {
        console.error('Change password error:', error);
        return { success: false, message: '비밀번호 변경 중 오류가 발생했습니다.' };
    }
}

// 로그아웃
function logout() {
    // Stop session timeout checking
    stopSessionTimeoutCheck();

    // Clear all session data
    localStorage.removeItem('y711_session');
    localStorage.removeItem('y711_user');
    localStorage.removeItem('y711_user_id');        // ← 추가: user_id 제거
    localStorage.removeItem('y711_login_time');
    localStorage.removeItem('y711_session_expires_at');
    localStorage.removeItem('y711_last_activity');
    localStorage.removeItem('y711_password_hash');

    console.log('✅ 로그아웃 완료');

    // Redirect to login page
    window.location.href = '/login.html';
}

// 세션 확인 (만료 시간 체크 포함)
function isAuthenticated() {
    const session = localStorage.getItem('y711_session');
    const user = localStorage.getItem('y711_user');
    const expiresAt = localStorage.getItem('y711_session_expires_at');

    // 세션 기본 정보 없으면 false
    if (!session || !user) {
        return false;
    }

    // 세션 만료 시간 있으면 확인
    if (expiresAt) {
        const expirationTime = new Date(expiresAt);
        const now = new Date();

        if (now > expirationTime) {
            // 세션 만료됨 - 자동 로그아웃
            console.warn('Session expired. Logging out...');
            logout();
            return false;
        }
    }

    return true;
}

// 인증 필요 페이지 보호
function requireAuth() {
    if (!isAuthenticated()) {
        window.location.href = '/login.html';
        return false;
    }
    return true;
}

// 세션 토큰 생성
function generateSessionToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// 현재 사용자 정보 가져오기
function getCurrentUser() {
    return localStorage.getItem('y711_user');
}

// ========================================
// Session Timeout Management
// ========================================

// 세션 타임아웃 체크 시작 (1분마다 확인)
let sessionTimeoutCheckInterval = null;

function startSessionTimeoutCheck() {
    // 이미 실행 중인 체크 중지
    if (sessionTimeoutCheckInterval) {
        clearInterval(sessionTimeoutCheckInterval);
    }

    // 1분마다 세션 만료 확인
    sessionTimeoutCheckInterval = setInterval(() => {
        if (!isAuthenticated()) {
            // Session already expired and user logged out
            clearInterval(sessionTimeoutCheckInterval);
        }
    }, 60000); // Check every 60 seconds
}

// 세션 타임아웃 체크 중지
function stopSessionTimeoutCheck() {
    if (sessionTimeoutCheckInterval) {
        clearInterval(sessionTimeoutCheckInterval);
        sessionTimeoutCheckInterval = null;
    }
}

// 사용자 활동 감지 (마우스 움직임, 키보드, 클릭)
function setupActivityTracking() {
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'click', 'touchstart'];

    activityEvents.forEach(event => {
        document.addEventListener(event, () => {
            updateLastActivity();
        }, { passive: true });
    });
}

// 마지막 활동 시간 업데이트
function updateLastActivity() {
    if (isAuthenticated()) {
        const now = new Date();
        localStorage.setItem('y711_last_activity', now.toISOString());
    }
}

// 세션 상태 정보 가져오기
function getSessionInfo() {
    const loginTime = localStorage.getItem('y711_login_time');
    const expiresAt = localStorage.getItem('y711_session_expires_at');
    const user = localStorage.getItem('y711_user');

    if (!loginTime || !expiresAt) {
        return null;
    }

    const now = new Date();
    const expirationTime = new Date(expiresAt);
    const timeRemaining = expirationTime - now;
    const minutesRemaining = Math.floor(timeRemaining / 60000);

    return {
        user,
        loginTime: new Date(loginTime),
        expiresAt: expirationTime,
        timeRemaining,
        minutesRemaining,
        isExpired: now > expirationTime
    };
}

// 세션 수동 갱신 (사용자가 활동할 때)
function refreshSession() {
    if (!isAuthenticated()) {
        return false;
    }

    const user = localStorage.getItem('y711_user');
    const sessionTimeout = (process.env.SESSION_TIMEOUT_MINUTES || 30) * 60 * 1000;
    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + sessionTimeout);

    localStorage.setItem('y711_session_expires_at', newExpiresAt.toISOString());
    localStorage.setItem('y711_last_activity', now.toISOString());

    console.log('Session refreshed. New expiration:', newExpiresAt.toISOString());
    return true;
}

// ========================================
// FUTURE: Backend API Authentication
// ========================================
// For production deployment, replace client-side authentication with:
// 1. Call /api/auth/login endpoint on server
// 2. Server validates credentials against database
// 3. Server returns JWT token
// 4. Client stores JWT token in localStorage
// 5. Client includes JWT token in all API requests
//
// Example future implementation:
/*
async function loginWithBackend(username, password) {
    const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (data.success) {
        localStorage.setItem('y711_jwt_token', data.token);
        localStorage.setItem('y711_user', username);
        localStorage.setItem('y711_login_time', new Date().toISOString());
        return { success: true };
    }
    return { success: false, message: data.message };
}
*/

// Export functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { login, logout, isAuthenticated, requireAuth, getCurrentUser, changePassword, hashPassword, validatePassword };
}
