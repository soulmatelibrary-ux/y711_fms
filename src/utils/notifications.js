/**
 * 토스트 알림 시스템
 */

let toastContainer = null;

export function initToastContainer() {
    if (!toastContainer) {
        toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.className = 'toast-container';
            document.body.appendChild(toastContainer);
        }
    }
    return toastContainer;
}

export function showToast(message, type = 'info', duration = 3000) {
    const container = initToastContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} slideIn`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('slideIn');
        toast.classList.add('slideOut');

        setTimeout(() => {
            toast.remove();
        }, 300);
    }, duration);
}

export function showSuccessToast(message, duration = 3000) {
    showToast(message, 'success', duration);
}

export function showErrorToast(message, duration = 3000) {
    showToast(message, 'error', duration);
}

export function showInfoToast(message, duration = 3000) {
    showToast(message, 'info', duration);
}

export function showWarningToast(message, duration = 3000) {
    showToast(message, 'warning', duration);
}
