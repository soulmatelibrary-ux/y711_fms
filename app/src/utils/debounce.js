/**
 * 함수 호출을 지정 시간만큼 지연시키는 debounce 유틸리티
 * @param {Function} fn
 * @param {number} ms
 */
export function debounce(fn, ms) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}
