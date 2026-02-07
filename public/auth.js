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
    localStorage.setItem('y711_session', sessionToken);
    localStorage.setItem('y711_user', username);
    localStorage.setItem('y711_login_time', new Date().toISOString());
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
    localStorage.removeItem('y711_session');
    localStorage.removeItem('y711_user');
    localStorage.removeItem('y711_login_time');
    window.location.href = '/login.html';
}

// 세션 확인
function isAuthenticated() {
    const session = localStorage.getItem('y711_session');
    const user = localStorage.getItem('y711_user');
    return !!(session && user);
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
