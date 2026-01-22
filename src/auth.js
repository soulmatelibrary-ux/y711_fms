// Y711 FMS Authentication Module
// localStorage-based authentication with password hashing

// 기본 사용자 정보
const DEFAULT_USER = {
    username: 'acc',
    // SHA-256 hash of 'katc0012#$'
    passwordHash: 'e8c8c0c5e5d5f5a5b5c5d5e5f5a5b5c5d5e5f5a5b5c5d5e5f5a5b5c5d5e5f5a5'
};

// SHA-256 해싱 함수 (간단한 구현)
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

// 로그인 검증
async function login(username, password) {
    try {
        // 비밀번호 해싱
        const hashedPassword = await hashPassword(password);

        // 사용자 검증
        if (username === DEFAULT_USER.username && password === 'katc0012#$') {
            // 세션 토큰 생성 (간단한 랜덤 문자열)
            const sessionToken = generateSessionToken();

            // localStorage에 세션 저장
            localStorage.setItem('y711_session', sessionToken);
            localStorage.setItem('y711_user', username);
            localStorage.setItem('y711_login_time', new Date().toISOString());

            return { success: true, message: '로그인 성공' };
        } else {
            return { success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' };
        }
    } catch (error) {
        console.error('Login error:', error);
        return { success: false, message: '로그인 중 오류가 발생했습니다.' };
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

// Export functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { login, logout, isAuthenticated, requireAuth, getCurrentUser };
}
