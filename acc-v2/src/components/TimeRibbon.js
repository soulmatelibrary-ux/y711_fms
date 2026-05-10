/**
 * TimeRibbon — Canvas 기반 시간축 렌더러
 * 8개 레인: RKSS/RKTU/RKJK/RKJJ (출발) + MEKIL/MANGI/DALSU (합류점) + RKPC (도착)
 */
import { timeToSec, secToTime, nowUtcSec } from '../utils/timeUtils.js';
import { showUndoToast } from '../utils/toast.js';

const LANE_H = 72;
const SECTION_H = 28;
const LABEL_W = 88;
const PX_PER_MIN_DEFAULT = 8;
const NOW_RATIO = 0.38; // NOW 라인 위치 (화면 왼쪽에서 38%)

const SECTIONS = [
    { label: 'DEPARTURE', lanes: ['RKSS', 'RKTU', 'RKJK', 'RKJJ'] },
    { label: 'CONVERGENCE', lanes: ['MEKIL', 'MANGI', 'DALSU'] },
    { label: 'ARRIVAL', lanes: ['RKPC'] },
];

// 목업 기준 공항별 고유 색상 (4개 공항 완전 구분)
const AIRPORT_COLOR = {
    RKSS: '#58a6ff',  // 파랑
    RKTU: '#bc8cff',  // 보라
    RKJK: '#39c5bb',  // 청록
    RKJJ: '#d29922',  // 황금
};
const AIRPORT_BG = {
    RKSS: 'rgba(88,166,255,0.22)',
    RKTU: 'rgba(188,140,255,0.22)',
    RKJK: 'rgba(57,197,187,0.22)',
    RKJJ: 'rgba(210,153,34,0.22)',
};
const AIRPORT_TEXT = {
    RKSS: '#d3e9ff',
    RKTU: '#eadcff',
    RKJK: '#c4f2ee',
    RKJJ: '#f0d8ab',
};

const LANE_META = {
    RKSS:  { label: 'RKSS 김포', color: AIRPORT_COLOR.RKSS, type: 'dep' },
    RKTU:  { label: 'RKTU 청주', color: AIRPORT_COLOR.RKTU, type: 'dep' },
    RKJK:  { label: 'RKJK 군산', color: AIRPORT_COLOR.RKJK, type: 'dep' },
    RKJJ:  { label: 'RKJJ 광주', color: AIRPORT_COLOR.RKJJ, type: 'dep' },
    MEKIL: { label: 'MEKIL',     color: '#6f84ad',           type: 'conv' },
    MANGI: { label: 'MANGI',     color: '#6f84ad',           type: 'conv' },
    DALSU: { label: 'DALSU',     color: '#6f84ad',           type: 'conv' },
    RKPC:  { label: 'RKPC 제주', color: '#34c759',           type: 'arr' },
};

// 공항 → 합류 웨이포인트 매핑
const AIRPORT_CONV = { RKSS: 'MEKIL', RKTU: 'MEKIL', RKJK: 'MANGI', RKJJ: 'DALSU' };

export class TimeRibbon {
    constructor(canvas, { onFlightSelect, onFlightDblClick, onAtdDrop, onConflictClick, onUndoRequested } = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.pxPerMin = PX_PER_MIN_DEFAULT;
        this.flights = [];
        this.conflicts = [];
        this.selectedId = null;
        this.whatifMode = false;
        this.whatifFlights = [];
        this.onFlightSelect = onFlightSelect || (() => {});
        this.onFlightDblClick = onFlightDblClick || (() => {});
        this.onAtdDrop = onAtdDrop || (() => {});
        this.onConflictClick = onConflictClick || (() => {});
        this.onUndoRequested = onUndoRequested || (() => {});

        // 시뮬레이션 시각 (null = 실시간)
        this._simTimeSec = null;

        // 드래그 상태
        this._drag = null;
        this._pan = null;
        this._viewOffsetSec = 0;
        this._suppressClickUntil = 0;
        this._callsignHitboxes = [];

        // 레인 순서 (flat)
        this.laneOrder = SECTIONS.flatMap(s => s.lanes);

        this._buildLayout();
        this._attachEvents();
        this._raf = null;
        this._loop();
    }

    _buildLayout() {
        let y = 0;
        this._sections = [];
        this._laneY = {};
        SECTIONS.forEach(sec => {
            this._sections.push({ label: sec.label, y, lanesY: {} });
            y += SECTION_H;
            sec.lanes.forEach(laneId => {
                this._laneY[laneId] = y;
                this._sections[this._sections.length - 1].lanesY[laneId] = y;
                y += LANE_H;
            });
        });
        this.totalH = y;
    }

    setFlights(flights) { this.flights = flights || []; }
    setConflicts(conflicts) { this.conflicts = conflicts || []; }
    setSelected(id) { this.selectedId = id; }
    setSimTime(sec) { this._simTimeSec = sec; }
    clearSimTime() { this._simTimeSec = null; }
    setWhatif(active, whatifFlights = []) {
        this.whatifMode = active;
        this.whatifFlights = whatifFlights;
    }
    setZoom(pxPerMin) { this.pxPerMin = Math.max(2, Math.min(30, pxPerMin)); }
    resetViewOffset() { this._viewOffsetSec = 0; }

    _nowSec() { return (this._simTimeSec ?? nowUtcSec()) + this._viewOffsetSec; }

    // 시간(초) → 캔버스 X
    _tx(timeSec) {
        const nowSec = this._nowSec();
        const nowX = this.canvas.width * NOW_RATIO;
        return LABEL_W + nowX + (timeSec - nowSec) / 60 * this.pxPerMin;
    }

    _loop() {
        this.draw();
        this._raf = requestAnimationFrame(() => this._loop());
    }

    destroy() {
        if (this._raf) cancelAnimationFrame(this._raf);
    }

    draw() {
        const c = this.ctx;
        const W = this.canvas.width;
        const H = this.canvas.height;
        c.clearRect(0, 0, W, H);

        // 배경
        c.fillStyle = '#0d1117';
        c.fillRect(0, 0, W, H);

        this._drawGrid(W, H);
        this._drawDepartureWindow(H);
        this._drawSections(W);
        this._drawLaneLines(W);
        this._drawLabels();
        // 프레임마다 콜사인 텍스트 히트 영역을 갱신
        this._callsignHitboxes = [];
        this._drawFlights();
        this._drawConvDiamonds();
        this._drawConflictOverlays();
        this._drawNowLine(H);

        if (this.whatifMode) {
            this._drawWhatifOverlay(W, H);
        }

        if (this._drag?.previewTime) {
            this._drawDragGuide(H);
        }
    }

    _drawGrid(W, H) {
        const c = this.ctx;
        const nowSec = this._nowSec();
        const startMin = Math.floor(-this.canvas.width * NOW_RATIO / this.pxPerMin) - 5;
        const endMin = Math.ceil((W - LABEL_W) / this.pxPerMin) + 5;

        for (let m = startMin; m <= endMin; m++) {
            const timeSec = nowSec + m * 60;
            const x = this._tx(timeSec);
            if (x < LABEL_W || x > W) continue;

            const isMajor = (Math.floor(timeSec / 60) % 10 === 0);
            if (!isMajor && m % 5 !== 0) continue;

            c.strokeStyle = isMajor ? '#1e2a3a' : '#151d28';
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(x, 0);
            c.lineTo(x, H);
            c.stroke();

            if (isMajor) {
                const h = Math.floor(((timeSec % 86400) + 86400) % 86400 / 3600);
                const mm = Math.floor((timeSec % 3600) / 60);
                const label = `${String(h).padStart(2, '0')}${String(mm).padStart(2, '0')}`;
                c.fillStyle = '#88a0bf';
                c.font = '12px "Courier New", monospace';
                c.fillText(label, x - 14, 14);
            }
        }
    }

    _drawDepartureWindow(H) {
        const c = this.ctx;
        const nowSec = this._nowSec();
        const x1 = this._tx(nowSec - 15 * 60);
        const x2 = this._tx(nowSec + 15 * 60);
        c.fillStyle = 'rgba(255,149,0,0.04)';
        c.fillRect(Math.max(LABEL_W, x1), 0, Math.min(x2, this.canvas.width) - Math.max(LABEL_W, x1), H);
    }

    _drawSections(W) {
        const c = this.ctx;
        this._sections.forEach(sec => {
            c.fillStyle = '#10192a';
            c.fillRect(0, sec.y, W, SECTION_H);
            c.fillStyle = '#5f79a6';
            c.font = 'bold 13px sans-serif';
            c.fillText(`— ${sec.label} ——`, LABEL_W + 8, sec.y + 18);
        });
    }

    _drawLaneLines(W) {
        const c = this.ctx;
        this.laneOrder.forEach(laneId => {
            const y = this._laneY[laneId];
            c.strokeStyle = '#141e2e';
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(0, y + LANE_H);
            c.lineTo(W, y + LANE_H);
            c.stroke();
        });
    }

    _drawLabels() {
        const c = this.ctx;
        c.fillStyle = '#0f1727';
        c.fillRect(0, 0, LABEL_W, this.totalH + 60);

        this.laneOrder.forEach(laneId => {
            const meta = LANE_META[laneId];
            const y = this._laneY[laneId];

            // 공항 레인: 왼쪽 3px 컬러 스트라이프
            if (meta.type === 'dep') {
                c.fillStyle = meta.color;
                c.fillRect(0, y, 3, LANE_H);
                // 레인 배경 미세 틴트
                const airportBg = AIRPORT_BG[laneId];
                if (airportBg) {
                    c.fillStyle = airportBg;
                    c.fillRect(3, y, LABEL_W - 3, LANE_H);
                }
            }

            // 텍스트
            const textColor = AIRPORT_TEXT[laneId] || meta.color;
            c.fillStyle = textColor;
            c.font = 'bold 14px sans-serif';
            c.fillText(meta.label, 7, y + LANE_H / 2 + 4);
        });
    }

    _drawFlights() {
        const c = this.ctx;
        const drawList = this.whatifMode
            ? [
                ...this.flights.map(f => ({ ...f, _isBase: true })),
                ...this.whatifFlights.map(f => ({ ...f, _isWhatif: true }))
              ]
            : this.flights;

        drawList.forEach(f => this._drawFlightBar(f, f._isBase, f._isWhatif));
    }

    _drawFlightBar(f, isBase = false, isWhatif = false) {
        const c = this.ctx;
        const laneId = f.dept || 'RKSS';
        const laneY = this._laneY[laneId];
        if (laneY === undefined) return;

        const ctotSec = timeToSec(f.atd || f.ctot || f.eobt);
        // 도착 추정: ctot + 총 비행시간 (최대 60분 표시)
        const endSec = ctotSec + 50 * 60;

        const x1 = this._tx(ctotSec);
        const x2 = this._tx(endSec);
        const barH = 42;
        const barY = laneY + (LANE_H - barH) / 2;

        const W = this.canvas.width;
        if (x2 < LABEL_W || x1 > W) return;

        const clampX1 = Math.max(LABEL_W, x1);
        const clampX2 = Math.min(W, x2);
        const barW = Math.max(clampX2 - clampX1, 2);

        const isSelected = f.id === this.selectedId;
        const hasConflict = this.conflicts.some(cf => cf.f1.id === f.id || cf.f2.id === f.id);

        if (isBase) {
            c.globalAlpha = 0.25;
        }

        // 바 배경 — 공항별 고유 색상 우선, 상태 오버라이드
        const airportBg = AIRPORT_BG[laneId] || 'rgba(88,166,255,0.22)';
        let barColor = airportBg;
        if (f.status === 'DEP') barColor = 'rgba(52,199,89,0.2)';
        else if (hasConflict) barColor = 'rgba(255,59,48,0.22)';
        if (isWhatif) barColor = 'rgba(255,193,7,0.15)';

        c.fillStyle = barColor;
        c.beginPath();
        this._roundRect(c, clampX1, barY, barW, barH, 4);
        c.fill();

        // 테두리 — 공항 고유색 기반
        const airportColor = AIRPORT_COLOR[laneId] || LANE_META[laneId].color;
        let borderColor = airportColor;
        if (hasConflict) borderColor = '#ff3b30';
        if (isSelected) borderColor = '#ffd700';
        if (isWhatif) borderColor = '#ffc107';

        c.strokeStyle = borderColor;
        c.lineWidth = isSelected ? 2.5 : 1.5;
        if (isWhatif) c.setLineDash([4, 3]);
        c.beginPath();
        this._roundRect(c, clampX1, barY, barW, barH, 4);
        c.stroke();
        c.setLineDash([]);

        // Callsign 텍스트 — 공항별 텍스트 색
        const airportText = AIRPORT_TEXT[laneId] || '#e8ecf0';
        c.fillStyle = f.status === 'DEP' ? '#4caf50' : (hasConflict ? '#ff6b6b' : airportText);
        c.font = `bold 14px "Courier New", monospace`;
        const callsignText = f.callsign || '???';
        const eobtInlineText = f.eobt || '----';
        const textX = clampX1 + 5;
        const textY = barY + 17;
        const textW = c.measureText(callsignText).width;
        const eobtX = textX + textW + 8;
        c.save();
        c.rect(clampX1 + 2, barY, barW - 4, barH);
        c.clip();
        c.fillText(callsignText, textX, textY);
        c.fillStyle = '#9fb0c2';
        c.font = '12px "Courier New", monospace';
        c.fillText(eobtInlineText, eobtX, textY);
        c.restore();

        // 더블클릭 정확도 향상을 위해 콜사인 텍스트 영역만 별도 히트테스트 대상에 등록
        if (!isBase) {
            const clipLeft = clampX1 + 2;
            const clipRight = clampX1 + Math.max(barW - 2, 2);
            const hitLeft = Math.max(textX, clipLeft);
            const hitRight = Math.min(textX + textW, clipRight);
            if (hitRight - hitLeft > 2) {
                this._callsignHitboxes.push({
                    flight: f,
                    left: hitLeft,
                    right: hitRight,
                    top: barY + 4,
                    bottom: barY + 20,
                });
            }
        }

        // 시간 표시: CTOT만 노출
        const ctotTxt = f.ctot || f.eobt || '----';
        const timeLabel = `CTOT ${ctotTxt}`;
        c.fillStyle = '#b0bed1';
        c.font = '11px monospace';
        c.save();
        c.rect(clampX1 + 2, barY, barW - 4, barH);
        c.clip();
        c.fillText(timeLabel, clampX1 + 5, barY + 33);
        c.restore();

        // ATD 마커
        if (f.atd) {
            const atdX = this._tx(timeToSec(f.atd));
            if (atdX >= LABEL_W && atdX <= W) {
                c.fillStyle = '#4caf50';
                c.beginPath();
                c.moveTo(atdX, barY);
                c.lineTo(atdX + 6, barY - 8);
                c.lineTo(atdX - 6, barY - 8);
                c.closePath();
                c.fill();
            }
        }

        if (isBase) c.globalAlpha = 1;

        // 펄스 애니메이션 (최근 변경)
        if (f._pulse && Date.now() - f._pulse < 600) {
            const t = (Date.now() - f._pulse) / 600;
            c.globalAlpha = (1 - t) * 0.5;
            c.fillStyle = '#ffd700';
            c.beginPath();
            this._roundRect(c, clampX1, barY, barW, barH, 4);
            c.fill();
            c.globalAlpha = 1;
        }

        // diff 라벨 (CTOT 변경)
        if (f._ctotDelta && Date.now() - f._ctotDelta.ts < 3000) {
            const sign = f._ctotDelta.mins > 0 ? '+' : '';
            c.fillStyle = f._ctotDelta.mins > 0 ? '#ff9800' : '#4caf50';
            c.font = 'bold 12px sans-serif';
            c.fillText(`${sign}${f._ctotDelta.mins}m`, clampX1 + barW / 2 - 10, barY - 5);
        }
    }

    _drawConvDiamonds() {
        const c = this.ctx;
        const flights = this.whatifMode ? this.whatifFlights : this.flights;

        flights.forEach(f => {
            const wps = f.routeWaypoints || [];
            const hasConflict = this.conflicts.some(cf => cf.f1.id === f.id || cf.f2.id === f.id);
            const convWp = AIRPORT_CONV[f.dept];

            wps.forEach(wp => {
                if (!this._laneY[wp.name]) return;
                const x = this._tx(wp.timeSec);
                const y = this._laneY[wp.name] + LANE_H / 2;
                if (x < LABEL_W || x > this.canvas.width) return;

                const isConvict = hasConflict && wp.name === convWp;
                const sz = 8;
                const deptColor = AIRPORT_COLOR[f.dept] || '#ce93d8';
                c.fillStyle = isConvict ? '#ff3b30' : deptColor;
                c.strokeStyle = isConvict ? '#ff6b6b' : deptColor;
                c.lineWidth = 1.5;
                c.beginPath();
                c.moveTo(x, y - sz);
                c.lineTo(x + sz, y);
                c.lineTo(x, y + sz);
                c.lineTo(x - sz, y);
                c.closePath();
                c.fill();
                c.stroke();

                // 충돌 시 빨간 glow
                if (isConvict) {
                    c.shadowColor = '#ff3b30';
                    c.shadowBlur = 8;
                    c.fill();
                    c.shadowBlur = 0;
                }
            });
        });
    }

    _drawConflictOverlays() {
        const c = this.ctx;
        this.conflicts.forEach(cf => {
            const laneY = this._laneY[cf.zone];
            if (laneY === undefined) return;
            const x1 = this._tx(cf.f1TimeSec) - 4;
            const x2 = this._tx(cf.f2TimeSec) + 4;
            const y = laneY;
            const H = LANE_H;
            const isCrit = cf.severity === 'critical';

            c.fillStyle = isCrit
                ? `rgba(255,59,48,${0.15 + 0.1 * Math.sin(Date.now() / 200)})`
                : 'rgba(255,149,0,0.12)';
            c.fillRect(Math.min(x1, x2), y, Math.abs(x2 - x1), H);

            c.strokeStyle = isCrit ? '#ff3b30' : '#ff9500';
            c.lineWidth = 1;
            c.setLineDash([4, 2]);
            c.strokeRect(Math.min(x1, x2), y, Math.abs(x2 - x1), H);
            c.setLineDash([]);

            // 분리 텍스트
            const midX = (x1 + x2) / 2;
            const diffStr = `${Math.floor(cf.timeDiffSec / 60)}:${String(cf.timeDiffSec % 60).padStart(2, '0')}`;
            c.fillStyle = isCrit ? '#ff3b30' : '#ff9500';
            c.font = 'bold 12px monospace';
            c.fillText(`⚠ ${diffStr}`, midX - 20, y + LANE_H / 2 + 4);
        });
    }

    _drawNowLine(H) {
        const c = this.ctx;
        const nowX = LABEL_W + this.canvas.width * NOW_RATIO;
        const isSim = this._simTimeSec !== null;
        const lineColor = isSim ? '#4fc3f7' : '#ff3b30';
        const glowColor = isSim ? 'rgba(79,195,247,0.5)' : 'rgba(255,59,48,0.6)';

        c.shadowColor = glowColor;
        c.shadowBlur = 8;
        c.strokeStyle = lineColor;
        c.lineWidth = isSim ? 1.5 : 2;
        c.setLineDash(isSim ? [4, 3] : []);
        c.beginPath();
        c.moveTo(nowX, 0);
        c.lineTo(nowX, H);
        c.stroke();
        c.setLineDash([]);
        c.shadowBlur = 0;

        c.fillStyle = lineColor;
        c.font = 'bold 12px monospace';
        if (isSim) {
            const s = ((this._simTimeSec % 86400) + 86400) % 86400;
            const hh = String(Math.floor(s / 3600)).padStart(2, '0');
            const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
            c.fillText(`SIM ${hh}${mm}`, nowX - 24, 12);
        } else {
            c.fillText('NOW', nowX - 15, 12);
        }
    }

    _drawDragGuide(H) {
        const c = this.ctx;
        const { flight, origCtotSec, previewTime } = this._drag;
        const newSec = timeToSec(previewTime);
        const guideX = this._tx(newSec);

        // 수직 가이드 점선
        c.save();
        c.setLineDash([5, 4]);
        c.strokeStyle = 'rgba(255,215,0,0.8)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(guideX, 0);
        c.lineTo(guideX, H);
        c.stroke();
        c.setLineDash([]);
        c.restore();

        // ±Nm 라벨
        const deltaMin = Math.round((newSec - origCtotSec) / 60);
        const sign = deltaMin >= 0 ? '+' : '';
        const label = `${sign}${deltaMin}m`;
        const laneY = this._laneY[flight.dept] || 60;
        c.fillStyle = '#ffd700';
        c.font = 'bold 13px monospace';
        c.fillText(label, guideX + 6, laneY + 20);
    }

    _drawWhatifOverlay(W, H) {
        const c = this.ctx;
        c.strokeStyle = 'rgba(255,193,7,0.4)';
        c.lineWidth = 3;
        c.strokeRect(0, 0, W, H);

        c.fillStyle = 'rgba(255,193,7,0.06)';
        c.font = 'bold 48px sans-serif';
        c.save();
        c.globalAlpha = 0.08;
        c.fillStyle = '#ffc107';
        c.translate(W / 2, H / 2);
        c.rotate(-0.3);
        c.fillText('WHAT-IF', -100, 0);
        c.restore();
    }

    _roundRect(c, x, y, w, h, r) {
        c.moveTo(x + r, y);
        c.lineTo(x + w - r, y);
        c.quadraticCurveTo(x + w, y, x + w, y + r);
        c.lineTo(x + w, y + h - r);
        c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        c.lineTo(x + r, y + h);
        c.quadraticCurveTo(x, y + h, x, y + h - r);
        c.lineTo(x, y + r);
        c.quadraticCurveTo(x, y, x + r, y);
    }

    // 지점 히트 테스트
    _hitTest(mx, my) {
        const W = this.canvas.width;
        for (const f of this.flights) {
            const laneY = this._laneY[f.dept];
            if (laneY === undefined) continue;
            const ctotSec = timeToSec(f.atd || f.ctot || f.eobt);
            const endSec = ctotSec + 50 * 60;
            const x1 = this._tx(ctotSec);
            const x2 = this._tx(endSec);
            if (x2 < LABEL_W || x1 > W) continue;
            const left = Math.max(LABEL_W, Math.min(x1, x2));
            const right = Math.min(W, Math.max(x1, x2));
            if (right - left < 2) continue;
            const barH = 42;
            const barY = laneY + (LANE_H - barH) / 2;
            if (mx >= left && mx <= right && my >= barY && my <= barY + barH) {
                return f;
            }
        }
        return null;
    }

    _hitTestConflict(mx, my) {
        for (const cf of this.conflicts) {
            const laneY = this._laneY[cf.zone];
            if (laneY === undefined) continue;
            const x1 = this._tx(cf.f1TimeSec) - 4;
            const x2 = this._tx(cf.f2TimeSec) + 4;
            const left = Math.min(x1, x2);
            const width = Math.abs(x2 - x1);
            if (mx >= left && mx <= left + width && my >= laneY && my <= laneY + LANE_H) {
                return cf;
            }
        }
        return null;
    }

    _hitTestCallsign(mx, my) {
        for (let i = this._callsignHitboxes.length - 1; i >= 0; i--) {
            const b = this._callsignHitboxes[i];
            if (mx >= b.left && mx <= b.right && my >= b.top && my <= b.bottom) {
                return b.flight;
            }
        }
        return null;
    }

    _attachEvents() {
        const canvas = this.canvas;

        // 클릭 → 선택
        canvas.addEventListener('click', (e) => {
            if (Date.now() < this._suppressClickUntil) return;
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const cf = this._hitTestConflict(mx, my);
            if (cf) {
                this.onConflictClick(
                    cf.zone,
                    [cf.f1?.id, cf.f2?.id].filter(Boolean),
                    { x: e.clientX, y: e.clientY }
                );
                return;
            }
            const f = this._hitTest(mx, my);
            if (f) {
                this.selectedId = f.id;
                this.onFlightSelect(f);
            }
        });

        // 더블클릭 → Inspector 팝업
        canvas.addEventListener('dblclick', (e) => {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const f = this._hitTestCallsign(mx, my) || this._hitTest(mx, my);
            if (f) this.onFlightDblClick(f, e);
        });

        // hover cursor
        canvas.addEventListener('mousemove', (e) => {
            if (this._pan) {
                const rect = canvas.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const dxPx = mx - this._pan.startX;
                const dxSec = Math.round((dxPx / this.pxPerMin) * 60);
                this._viewOffsetSec = this._pan.startOffsetSec - dxSec;
                if (Math.abs(dxPx) > 2) this._pan.moved = true;
                canvas.style.cursor = 'grabbing';
                return;
            }
            if (this._drag) {
                const rect = canvas.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const dxPx = mx - this._drag.startX;
                const dxMin = Math.round(dxPx / this.pxPerMin);
                const newSec = this._drag.origCtotSec + dxMin * 60;
                this._drag.previewTime = secToTime(newSec);
                canvas.style.cursor = 'ew-resize';
                return;
            }
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const cf = this._hitTestConflict(mx, my);
            const f = this._hitTest(mx, my);
            canvas.style.cursor = cf ? 'pointer' : (f ? 'grab' : (e.ctrlKey ? 'grab' : ''));
        });

        // 드래그
        canvas.addEventListener('mousedown', (e) => {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const cf = this._hitTestConflict(mx, my);
            const f = this._hitTest(mx, my);

            // Windows 사용 기준: Ctrl + 빈 영역 드래그로 시간축 좌우 이동
            if (e.ctrlKey && !f && !cf) {
                this._pan = { startX: mx, startOffsetSec: this._viewOffsetSec, moved: false };
                canvas.style.cursor = 'grabbing';
                e.preventDefault();
                return;
            }

            if (f) {
                this._drag = { flight: f, startX: mx, origCtotSec: timeToSec(f.atd || f.ctot || f.eobt) };
            }
        });

        canvas.addEventListener('mouseup', (e) => {
            if (this._pan) {
                if (this._pan.moved) this._suppressClickUntil = Date.now() + 120;
                this._pan = null;
                canvas.style.cursor = '';
                return;
            }

            if (!this._drag) return;
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const dxPx = mx - this._drag.startX;
            const dragInfo = this._drag;
            this._drag = null;
            canvas.style.cursor = '';

            if (Math.abs(dxPx) > 5) {
                const dxMin = Math.round(dxPx / this.pxPerMin);
                const newSec = dragInfo.origCtotSec + dxMin * 60;
                const newTime = secToTime(newSec);
                this.onAtdDrop(dragInfo.flight.id, newTime);

                // 드롭 후 Undo 토스트
                showUndoToast(
                    `${dragInfo.flight.callsign} ATD → ${newTime}Z`,
                    () => this.onUndoRequested && this.onUndoRequested()
                );
            }
        });

        // 줌
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -1 : 1;
            this.setZoom(this.pxPerMin + delta);
        }, { passive: false });
    }

    // 외부에서 펄스 트리거
    pulseFlight(flightId) {
        const f = this.flights.find(fl => fl.id === flightId);
        if (f) f._pulse = Date.now();
    }

    setCtotDelta(flightId, mins) {
        const f = this.flights.find(fl => fl.id === flightId);
        if (f) f._ctotDelta = { mins, ts: Date.now() };
    }

    resize() {
        const parent = this.canvas.parentElement;
        if (parent) {
            this.canvas.width = parent.clientWidth;
            this.canvas.height = this.totalH + 20;
        }
    }
}
