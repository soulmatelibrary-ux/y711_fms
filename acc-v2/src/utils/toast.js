/**
 * 토스트 알림 유틸리티
 */

let _container = null;

function getContainer() {
    if (!_container || !document.body.contains(_container)) {
        _container = document.createElement('div');
        _container.id = 'toast-container';
        document.body.appendChild(_container);
    }
    return _container;
}

/**
 * @param {string} message
 * @param {'info'|'success'|'error'|'warn'} type
 * @param {Function|null} retryFn - 재시도 버튼 콜백 (선택)
 * @param {number} duration - 자동 닫힘 ms (0 = 수동 닫기)
 */
export function showToast(message, type = 'info', retryFn = null, duration = 4000) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;

    el.innerHTML = `
        <span class="toast-msg"></span>
        ${retryFn ? '<button class="toast-retry">↻ 재시도</button>' : ''}
        <button class="toast-close">×</button>`;
    el.querySelector('.toast-msg').textContent = message;

    const container = getContainer();
    container.appendChild(el);

    const close = () => {
        el.classList.add('toast-hide');
        setTimeout(() => el.remove(), 300);
    };

    el.querySelector('.toast-close').addEventListener('click', close);
    if (retryFn) {
        el.querySelector('.toast-retry').addEventListener('click', () => {
            close();
            retryFn();
        });
    }

    if (duration > 0) setTimeout(close, duration);
    return close;
}

export function showUndoToast(message, undoFn, duration = 5000) {
    const el = document.createElement('div');
    el.className = 'toast toast-undo';

    el.innerHTML = `
        <span class="toast-msg"></span>
        <button class="toast-undo-btn">↶ 되돌리기</button>
        <button class="toast-close">×</button>`;
    el.querySelector('.toast-msg').textContent = message;

    const container = getContainer();
    container.appendChild(el);

    let timer = null;
    const close = () => {
        if (timer) clearTimeout(timer);
        el.classList.add('toast-hide');
        setTimeout(() => el.remove(), 300);
    };

    el.querySelector('.toast-close').addEventListener('click', close);
    el.querySelector('.toast-undo-btn').addEventListener('click', () => {
        close();
        undoFn();
    });

    timer = setTimeout(close, duration);
    return close;
}
