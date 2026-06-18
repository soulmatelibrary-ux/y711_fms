/**
 * UI 문자열 상수 — 한국어 기본값
 * 향후 다국어 지원 시 이 파일만 교체하거나 locale별 파일로 분리한다.
 * 현재 미사용 (ROADMAP P3-8): 컴포넌트에서 직접 문자열 사용 중.
 * 연결 시 각 컴포넌트에서 `import { T } from '../utils/i18n.js'` 추가 필요.
 */
export const T = {
    // 헤더
    TITLE:            '✈ ACC ATD v2',
    BADGE_CONFLICTS:  (n) => `충돌 ${n}`,
    BADGE_ADV:        (n) => `권고 ${n}`,
    BTN_WHATIF:       'WHAT-IF',
    BTN_UNDO:         '↶',
    BTN_BULK_DELAY:   '일괄지연',
    BTN_SCHEDULE:     '↗ 스케줄',
    BTN_HELP:         '?',
    BTN_LOGOUT:       '로그아웃',

    // What-if 띠
    WHATIF_BANNER:    'WHAT-IF 시나리오 모드 — 변경은 저장되지 않습니다',
    WHATIF_APPLY:     '적용',
    WHATIF_CANCEL:    '취소',
    WHATIF_CONFIRM:   'What-if 변경 사항을 실제 스케줄에 적용하시겠습니까?\n(이 작업은 Undo가 불가능합니다)',
    WHATIF_TOAST_OK:  'What-if 변경 사항이 적용되었습니다',

    // Inspector
    INSP_EMPTY_TITLE: '항공편 미선택',
    INSP_EMPTY_HINT:  '좌측 큐에서 카드를 클릭하거나\n캔버스에서 항공편 바를 클릭하세요',
    INSP_HHMM_ERR:    '형식 오류 — HH:MM 또는 HHMM 입력',
    INSP_HHMM_INVALID:'유효하지 않은 시각',

    // Departure Queue
    QUEUE_EMPTY_TITLE:'NOW±30분 내 출발편 없음',
    QUEUE_EMPTY_HINT: '10분 후 자동 새로고침됩니다.',
    QUEUE_REFRESH:    '지금 새로고침',

    // Alert Bar
    ALERT_RESOLVE:    'Resolve',

    // Conflict Wizard
    WIZ_PREVIEW_HINT: '옵션에 마우스를 올리면 영향 미리보기가 표시됩니다',
    WIZ_PREVIEW_TITLE:(opt) => `영향 미리보기 — 옵션 ${opt}`,
    WIZ_CONFLICTS:    (n) => `잔여 충돌: ${n}건`,

    // Toast
    TOAST_ATD_FAIL:   (cs) => `ATD 저장 실패 — ${cs}`,
    TOAST_ADV_FAIL:   (cs) => `권고 전송 실패 — ${cs}`,
    TOAST_BULK_APPLY: (icao, n, m) => `${icao} ${n}편 +${m}분 적용 (What-if 모드)`,

    // Audit
    AUDIT_CSV_BTN:    '↓ CSV',
    AUDIT_USER:       (u) => `@${u}`,

    // 로그인
    LOGIN_CONTACT:    '계정 정보는 관리자에게 문의하세요',
};
