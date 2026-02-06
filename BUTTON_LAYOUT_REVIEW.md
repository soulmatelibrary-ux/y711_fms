# Button Layout & Responsiveness Review
**CJU Flow Simulator - Y711 FMS**

**Date**: 2026-02-06
**Scope**: Button sizing, spacing, and layout consistency across screen sizes (375px mobile → 1920px desktop)
**Focus**: App-like responsive design with proper touch targets

---

## Executive Summary

The current button layout is **desktop-optimized** with several responsiveness gaps:

| Screen Size | Status | Key Issues |
|------------|--------|-----------|
| **Mobile (375px)** | ❌ **Poor** | Buttons overflow, tiny touch targets (<44px), header cramps |
| **Tablet (768px)** | ⚠️ **Fair** | Buttons fit but spacing inconsistent, navigation wraps |
| **Laptop (1024px)** | ✅ **Good** | Buttons well-spaced, readable layout |
| **Desktop (1920px)** | ✅ **Excellent** | Optimal spacing, clean arrangement |

**Critical Issues**: 5
**Important Issues**: 8
**Estimated Implementation Effort**: 4-5 hours

---

## Current Button Inventory

### Header Buttons (app-header)

| Section | Button ID | Element | Current Size | Current Padding |
|---------|-----------|---------|--------------|-----------------|
| **Left** | - | h1 Title | 1.25rem | - |
| **Left** | view-dashboard | nav-btn | 0.9rem | 0.5rem 1rem |
| **Left** | view-settings | nav-btn | 0.9rem | 0.5rem 1rem |
| **Left** | excel-upload | btn btn-primary excel-btn | 0.8rem | 6px 12px |
| **Left** | download-sample-btn | btn btn-secondary excel-btn | 0.8rem | 6px 12px |
| **Right** | logout-btn | btn btn-secondary | 0.9rem | 0.6rem 1rem |
| **Right** | help-btn | btn btn-secondary | 0.9rem | 0.6rem 1rem |

### Left Panel Buttons (left-panel)

| Location | Button ID | Type | Current Size | Current Padding |
|----------|-----------|------|--------------|-----------------|
| **Date Row** | prev-day-btn | btn btn-secondary | - | 4px 8px |
| **Date Row** | next-day-btn | btn btn-secondary | - | 4px 8px |
| **Date Row** | today-btn | btn btn-secondary | 0.8rem | 4px 10px |
| **Control Row** | reset-ctot-btn | btn btn-secondary | 0.75rem | 4px 10px |
| **Control Row** | merge-point-select | \<select\> | 0.85rem | 4px 8px |
| **Footer** | calc-ctot-btn | btn btn-primary full-width | 0.9rem | 0.6rem 1rem |

### Right Panel Buttons (right-panel)

| Location | Button ID | Type | Current Size | Current Padding |
|----------|-----------|------|--------------|-----------------|
| **Timeline** | - | - | - | - |
| **Map Header** | map-fullscreen-btn | btn btn-secondary | 0.8rem | 4px 10px |
| **Map Controls** | prev-btn | ctrl-btn | - | 0.4rem |
| **Map Controls** | play-btn | ctrl-btn main | - | 0.4rem |
| **Map Controls** | stop-btn | ctrl-btn | - | 0.4rem |
| **Map Controls** | next-btn | ctrl-btn | - | 0.4rem |
| **Map Controls** | speed-select | speed-select | 0.8rem | - |

### Modal Buttons

| Modal | Button IDs | Type | Current Padding |
|-------|-----------|------|-----------------|
| **schedule-period-modal** | quick-3m, quick-6m, quick-12m | btn btn-secondary | - |
| **schedule-period-modal** | cancel-schedule, confirm-schedule | btn btn-secondary/primary | - |
| **overlap-warning-modal** | cancel-overlap, confirm-overlap | btn btn-secondary/danger | - |
| **settings-modal** | save-settings | btn btn-primary | - |
| **help-modal** | close-help | btn-icon | - |

---

## Screen-by-Screen Analysis

### 🔴 Mobile (375px) - Critical Issues

#### Issue #1: Header Button Overflow
**Location**: `app-header` (.header-left, .header-right)
**Current State**:
```css
.header-left {
    display: flex;
    align-items: center;
    gap: 2rem;          /* Too large for mobile */
}
```

**Problem**:
- Navigation buttons (Dashboard/Settings) + Excel buttons (Upload/Sample) + Header title = ~450px width
- Exceeds 375px container, forcing horizontal scroll or button collapse
- Logo text takes up ~140px alone

**Current Layout**:
```
[제주공항 흐름관리] [Dashboard] [Settings] [📂업로드] [📥샘플] | [로그아웃] [acc🟢] [?도움말]
← 375px max →
```

Result: **Buttons wrap or overflow** ❌

#### Issue #2: Touch Target Size Too Small
**Location**: All buttons
**Current Specifications**:
- `.btn`: `padding: 0.6rem 1rem` = ~20-24px height
- `.excel-btn`: `padding: 6px 12px` = ~18-20px height
- `.nav-btn`: `padding: 0.5rem 1rem` = ~18px height
- Min-width for touch targets: **44×44px** (Apple), **48×48px** (Google)

**Problem**: All buttons fall **below 44px minimum**
```
Current button height = 20px    (padding top/bottom + line-height)
Required for mobile = 44px      (minimum touch target)
Gap = 24px too small            ❌
```

**Affected Elements**:
- `.nav-btn` in header
- `.excel-btn` (Excel upload/sample)
- `.btn-secondary` (logout, date controls)
- `.ctrl-btn` (play/pause controls)
- Date navigation arrows (prev-day, next-day)

#### Issue #3: Compressed Date Control Row
**Location**: Left panel date section
**Current HTML**:
```html
<div style="display: flex; align-items: center; gap: 12px;">
    <span>Date</span>
    <button id="prev-day-btn" style="padding: 4px 8px;">◀</button>
    <input type="date" style="padding: 4px 8px;">
    <button id="next-day-btn" style="padding: 4px 8px;">▶</button>
    <button id="today-btn" style="padding: 4px 10px;">Today</button>
</div>
```

**Problem**:
- 5 elements in 375px container = cramped
- Date input (min 60px) + 4 buttons = ~140px
- Label takes additional space
- Arrow buttons (◀▶) extremely small for finger targeting

**Current Layout on 375px**:
```
[Date] [◀] [2026-02-06] [▶] [Today]
← compressed →
```

#### Issue #4: Header Gap Inconsistent
**Current CSS**:
```css
.header-left {
    gap: 2rem;  /* 32px - desktop appropriate */
}
```

**Problem**: 32px gap between title and nav buttons wastes critical mobile space
- On 375px: `2rem` = 32px of wasted space
- Effective width for actual content: ~343px (375 - 32)
- On 768px and above: gap is appropriate

#### Issue #5: Modal Buttons Not Stacked on Mobile
**Location**: Modal footer buttons
**Current CSS**:
```css
.modal-footer {
    display: flex;
    gap: 0.75rem;
}
```

**Problem**:
- Modal max-width: 400px (`.modal-content`)
- At 375px viewport: modal already cramped
- Side-by-side buttons (cancel/confirm) squeeze to ~45% width each
- Button text gets truncated

**Example**:
```
┌─ Modal (375px wide) ────────┐
│ Title                       │
│ [Cancel]  [Confirm]         │  ← 40% width each = tiny
└─────────────────────────────┘
```

---

### 🟡 Tablet (768px) - Important Issues

#### Issue #6: Navigation Wrapping at Breakpoint
**Location**: `.header-left`
**Current Layout**:
```
[Title] [Dashboard] [Settings] [📂Upload] [📥Sample]
        ↑ Nav buttons        ↑ Excel buttons
        Can fit on one line, but cramped (gap: 2rem takes up space)
```

**Problem**:
- At 768px: header items start wrapping around 650-700px
- Excel buttons push navigation to secondary line on some viewport sizes
- No media query to adjust for tablet

#### Issue #7: Inconsistent Button Heights Across Sections
**Location**: Multiple
**Current Heights**:
- `.btn`: ~24px (0.6rem padding + line-height)
- `.excel-btn`: ~18px (6px padding override)
- `.nav-btn`: ~18px (0.5rem padding)
- `.btn-sm`: ~16px (0.3rem padding)
- `.ctrl-btn`: ~20px (0.4rem padding)

**Problem**:
- 4 different button sizes across the UI
- No consistent visual hierarchy on mobile/tablet
- Makes layout appear unprofessional

**Recommended Standards**:
```
Mobile (≤768px):   44px height (touch-friendly)
Tablet (769-1024): 40px height
Desktop (>1024):   36px height (original .btn size)
```

#### Issue #8: Excel Button Section No Responsive Wrapper
**Location**: `.excel-upload-section`
**Current CSS**:
```css
.excel-upload-section {
    display: inline-flex;
    align-items: center;
    gap: 8px;          /* Fixed 8px gap */
}
```

**Problem**:
- No breakpoint to stack vertically on mobile
- No max-width constraint
- Two buttons side-by-side: `📂 Excel 업로드` (80px) + `📥 샘플 다운로드` (80px) = 160px
- Takes up too much header space on tablet

---

### 🟢 Laptop (1024px+) - Minor Issues

#### Issue #9: Gap Consistency Between Sections
**Location**: `.header-left`, date controls
**Current Gaps**:
- `.header-left`: `gap: 2rem` (32px)
- `.excel-upload-section`: `gap: 8px`
- Date controls: `gap: 12px`
- Date inputs: `gap: 4px`

**Problem**: Inconsistent spacing suggests ad-hoc styling
- No design system for button grouping gaps
- Desktop users see uneven visual rhythm

---

### 🔴 Desktop (1920px) - Layout Issues

#### Issue #10: Excessive Whitespace
**Location**: Right side header
**Current Layout**:
```
...Excel buttons... [                    logout    user_profile    help    ]
                    ↑ Large gap
```

**Problem**: Extra space between Excel buttons and logout button wastes horizontal real estate

---

## Touch Target Analysis

### Current State (FAIL)
```
Apple iOS:    44×44px minimum  → Current: ~20×24px   ❌ 55% too small
Google/WCAG:  48×48px minimum  → Current: ~20×24px   ❌ 60% too small
Samsung/etc:  46×46px minimum  → Current: ~20×24px   ❌ 56% too small
```

### Impact by Button Type

| Button Type | Current | Required | Gap | Users Affected |
|------------|---------|----------|-----|----------------|
| `.nav-btn` | 18×18px | 44×44px | 26px | Mobile nav |
| `.excel-btn` | 18×20px | 44×44px | 26px | All mobile users |
| `.btn-secondary` | 20×24px | 44×44px | 20px | Mobile, tablet |
| `prev-day-btn` | 16×20px | 44×44px | 28px | **CRITICAL** |
| `ctrl-btn` | 20×20px | 44×44px | 24px | All mobile users |

---

## Font Size Consistency Issues

### Header
```css
.nav-btn { font-size: 0.9rem }      /* 14.4px */
.excel-btn { font-size: 0.8rem }    /* 12.8px */
.btn { font-size: 0.9rem }          /* 14.4px */
```

**Problem**:
- `.excel-btn` (0.8rem) is smaller than `.nav-btn` (0.9rem)
- No text size scaling on mobile (should increase)
- Minimum readable font: **12px** on desktop, **14px+ on mobile**

---

## Layout Responsiveness Gaps

### Missing Media Queries

**Current State**: Only 1 media query at bottom of CSS
```css
/* One media query at EOF */
@media (max-width: 1200px) {
    .sidebar-width: 480px;
}
```

**Problem**: No breakpoints for:
- Mobile (375-480px): Header buttons, touch targets, modals
- Small tablet (481-768px): Button grouping, navigation
- Large tablet (769-1024px): Layout optimization
- Desktop (1025-1440px): Spacing efficiency
- Ultrawide (1441+px): Column layout

---

## Specific Button Group Issues

### 1. Date Navigation Block (CRITICAL)
**Current**:
```html
<div style="display: flex; gap: 4px;">
    <button id="prev-day-btn" style="padding: 4px 8px;">◀</button>
    <input type="date" style="padding: 4px 8px;">
    <button id="next-day-btn" style="padding: 4px 8px;">▶</button>
    <button id="today-btn" style="padding: 4px 10px;">Today</button>
</div>
```

**Issues**:
- Arrow buttons: 8×4px (impossible to tap on mobile)
- Date input shrinks to 40px on mobile
- All 4 elements in 80px space on 375px viewport

**On Different Screens**:
```
Mobile (375px):
[Date] [◀ input ▶] [Today]  ← impossible to use

Tablet (768px):
[Date] [◀][2026-02-06][▶][Today]  ← acceptable

Desktop (1920px):
[Date] [◀] [2026-02-06] [▶] [Today]  ← good
```

### 2. Merge Point Control (IMPORTANT)
**Current**:
```html
<div style="display: flex; gap: 12px;">
    <span>겹침분리</span>
    <select id="merge-point-select" style="padding: 4px 8px;">...</select>
    <button id="reset-ctot-btn" style="padding: 4px 10px;">새로 고침</button>
</div>
```

**Issues**:
- Button text "새로 고침" (refresh) = ~40px on mobile
- Select dropdown min-width: 85px
- Total width: ~150px (too wide for 375px)

### 3. Header Button Arrangement (CRITICAL)
**Current**:
```html
<div class="header-left">
    <h1>제주공항 <span>흐름 관리 시스템</span></h1>
    <nav class="top-nav">
        <button>Dashboard</button>
        <button>Settings</button>
    </nav>
    <div class="excel-upload-section">
        <button>📂 Excel 업로드</button>
        <button>📥 샘플 다운로드</button>
    </div>
</div>

<div class="header-right">
    <button>로그아웃</button>
    <div class="user-profile">...</div>
    <button>? 도움말</button>
</div>
```

**Width Calculation (Mobile 375px)**:
```
Title:              140px  ← "제주공항 흐름관리" (~5 chars × 28px)
gap: 2rem:           32px
Nav buttons:        100px  ← "Dashboard" + "Settings" + padding + gap
gap (implicit):       8px
Excel buttons:      160px  ← "업로드" + "샘플" + padding + gap
                   ──────
Total left side:    440px  ← EXCEEDS 375px viewport! ❌

Right side:         180px  ← logout + user + help
Total:              620px  ← TWO COLUMNS WORTH!
```

### 4. Modal Footer Buttons (IMPORTANT)
**Current CSS**:
```css
.modal-footer {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
}
```

**Problem**:
- Buttons side-by-side at all viewport sizes
- On 375px: modal max-width is 400px
- Buttons take 40-50% width each (too small for text readability)

**Needed Change**:
```css
/* Mobile */
@media (max-width: 768px) {
    .modal-footer {
        flex-direction: column;  /* Stack vertically */
    }
    .modal-footer .btn {
        width: 100%;            /* Full width */
    }
}
```

---

## Specific File Locations

### Current Button-Related CSS (src/style.css)

| Section | Lines | Issue |
|---------|-------|-------|
| `.btn` | 680-711 | Base button styles, no breakpoints |
| `.btn-primary` | 690-697 | Color only, no size changes |
| `.btn-secondary` | 699-707 | Color only, no size changes |
| `.excel-btn` | 1331-1334 | Hardcoded small size (0.8rem) |
| `.nav-btn` | 105-125 | No mobile optimization |
| `.ctrl-btn` | 1039-1052 | No touch target optimization |
| `.modal-footer` | 1605-1607 | No responsive layout |
| `.header-left` | 82-86 | No gap adjustment for mobile |
| `@media` (1200px) | Bottom | Only one breakpoint! |

### Current Button HTML Locations (index.html)

| Location | Lines | Issue |
|----------|-------|-------|
| Header | 22-51 | No flex-wrap, no mobile nav collapse |
| Date controls | 62-75 | Inline styles, no media query |
| Merge controls | 77-94 | Inline styles, no responsive wrapping |
| Modal footer | 582-610 | No responsive flex-direction |
| Left panel footer | 136-138 | Uses full-width, good! ✓ |

---

## Recommended Implementation Plan

### Phase 1: Touch Target & Font Size (1.5-2 hours)

**Goal**: Achieve 44×44px minimum touch targets on mobile, readable font sizes

**Changes**:

1. **Create base responsive button sizes**:
```css
/* Mobile */
@media (max-width: 768px) {
    .btn {
        padding: 0.75rem 1rem;      /* Increase from 0.6rem 1rem */
        font-size: 1rem;            /* Increase from 0.9rem */
        min-height: 44px;
        min-width: 44px;
    }

    .btn-secondary,
    .btn-primary,
    .btn-danger {
        padding: 0.75rem 1.2rem;
    }

    .nav-btn {
        padding: 0.75rem 1.2rem;
        font-size: 1rem;
    }

    .excel-btn {
        padding: 0.75rem 1rem;
        font-size: 0.95rem;
    }

    .ctrl-btn {
        padding: 0.6rem;
        min-width: 44px;
        min-height: 44px;
    }
}

/* Tablet */
@media (min-width: 769px) and (max-width: 1024px) {
    .btn {
        padding: 0.6rem 1rem;
        font-size: 0.9rem;
    }
}

/* Desktop */
@media (min-width: 1025px) {
    .btn {
        padding: 0.6rem 1rem;
        font-size: 0.9rem;
    }
}
```

**Files to Modify**:
- `src/style.css`: Add touch-target media queries at line 1720 (after existing @media)

---

### Phase 2: Header Responsiveness (1.5-2 hours)

**Goal**: Make header buttons wrap/collapse appropriately on mobile and tablet

**Changes**:

1. **Header layout on mobile**:
```css
@media (max-width: 480px) {
    .header-left {
        gap: 0.5rem;                /* Reduce from 2rem */
        flex-wrap: wrap;
    }

    .header-left h1 {
        font-size: 1rem;            /* Reduce from 1.25rem */
        order: 1;
    }

    .header-left h1 span {
        display: none;              /* Hide "흐름 관리 시스템" */
    }
    /* Just show "제주공항" */

    .top-nav {
        order: 2;
        gap: 0.25rem;
    }

    .excel-upload-section {
        order: 3;
        width: 100%;
        flex-direction: column;     /* Stack buttons vertically */
        gap: 6px;
        margin-top: 6px;
    }

    .excel-upload-section .btn {
        width: 100%;
        padding: 0.75rem 1rem;
    }
}

@media (min-width: 481px) and (max-width: 768px) {
    .header-left {
        gap: 1rem;                  /* Reduce from 2rem */
    }

    .excel-upload-section {
        flex-direction: column;
        width: auto;
        gap: 6px;
    }
}

@media (min-width: 769px) {
    .header-left {
        gap: 2rem;                  /* Keep original */
    }

    .excel-upload-section {
        flex-direction: row;        /* Side by side */
        gap: 8px;
    }
}
```

2. **Header right section on mobile**:
```css
@media (max-width: 480px) {
    .header-right {
        gap: 0.5rem;                /* Reduce from default */
    }

    .header-right .user-profile {
        display: none;              /* Hide on very small mobile */
    }
    /* Show only logout and help buttons */
}

@media (min-width: 481px) and (max-width: 768px) {
    .header-right {
        gap: 0.75rem;
    }
}
```

**Files to Modify**:
- `src/style.css`: Add header responsive media queries
- `index.html`: Optional - simplify h1 text or add wrapper for span management

---

### Phase 3: Modal & Button Group Responsiveness (1-1.5 hours)

**Goal**: Stack modal buttons vertically on mobile, optimize date controls

**Changes**:

1. **Modal button stacking**:
```css
@media (max-width: 768px) {
    .modal-footer {
        flex-direction: column;
    }

    .modal-footer .btn {
        width: 100%;
    }
}
```

2. **Date control responsive layout**:
```css
@media (max-width: 480px) {
    /* Date control row */
    .schedule-date-section {
        flex-wrap: wrap;
    }

    .schedule-date-section > div {
        width: 100%;
        margin-bottom: 8px;
    }

    /* Date input full width */
    input[type="date"] {
        width: 100%;
        max-width: 200px;
    }

    /* Arrow buttons: increase size */
    #prev-day-btn,
    #next-day-btn {
        padding: 0.6rem 0.8rem;
        font-size: 1.1rem;
    }
}

@media (min-width: 481px) and (max-width: 768px) {
    input[type="date"] {
        width: 150px;
    }
}
```

3. **Merge point control responsive layout**:
```css
@media (max-width: 480px) {
    .merge-control-section {
        flex-wrap: wrap;
    }

    #merge-point-select {
        width: 100%;
    }

    #reset-ctot-btn {
        width: 100%;
        margin-top: 6px;
    }
}
```

**Files to Modify**:
- `src/style.css`: Add modal and control group responsive styles
- `index.html`: Optional - add class names to control sections for easier targeting

---

### Phase 4: Consistent Spacing System (0.5-1 hour)

**Goal**: Define design system for button gaps and padding

**Changes**:

```css
:root {
    /* Button sizing */
    --btn-height-mobile: 44px;
    --btn-height-tablet: 40px;
    --btn-height-desktop: 36px;

    /* Button gaps (between button groups) */
    --gap-buttons-tight: 4px;
    --gap-buttons-normal: 8px;
    --gap-buttons-loose: 16px;

    /* Padding standards */
    --padding-btn-mobile: 0.75rem 1rem;
    --padding-btn-desktop: 0.6rem 1rem;
}
```

**Files to Modify**:
- `src/style.css`: Add design system variables at top (:root section)

---

## Verification Checklist

### Phase 1: Touch Targets
- [ ] All buttons ≥44×44px on mobile (≤768px)
- [ ] All buttons ≥40×40px on tablet (769-1024px)
- [ ] All buttons ≥36×36px on desktop (>1024px)
- [ ] Font size readable: ≥14px mobile, ≥12px desktop
- [ ] Tap-test with DevTools device emulation: all buttons easily tappable

### Phase 2: Header Responsiveness
- [ ] Mobile (375px): Title + nav + excel buttons stack vertically ✓
- [ ] Mobile (480px): Buttons arrange in 2-3 rows ✓
- [ ] Tablet (768px): Header fits on one line with proper gaps ✓
- [ ] Desktop (1920px): Original layout maintained ✓
- [ ] No horizontal scroll at any breakpoint

### Phase 3: Modal & Controls
- [ ] Modal buttons stack on mobile (≤768px) ✓
- [ ] Date controls readable on 375px without horizontal scroll ✓
- [ ] Merge point controls wrap appropriately ✓
- [ ] All modal text visible without truncation

### Phase 4: Visual Consistency
- [ ] All button groups use consistent gap spacing ✓
- [ ] Button heights consistent within breakpoint ✓
- [ ] Padding consistent across button types (primary/secondary/danger) ✓
- [ ] No visual jumps when resizing window

### Cross-Browser Testing
- [ ] Chrome/Edge (DevTools mobile emulation)
- [ ] Firefox (responsive design mode)
- [ ] Safari (iOS simulator)
- [ ] Device testing: iPhone SE (375px), iPad (768px), Desktop (1920px)

---

## Implementation Priority

**Immediate (Critical)** - Users can't use mobile app:
1. Touch target sizes (44×44px on mobile)
2. Header button overflow fix
3. Date navigation usability

**High** - App appearance poor on mobile:
4. Modal button stacking
5. Header layout wrapping
6. Font size scaling

**Medium** - Visual polish:
7. Consistent button gaps
8. Design system variables
9. Spacing optimization

---

## Impact Analysis

### Before Implementation
```
Mobile User Experience:
- Can't reliably tap arrow buttons (8px width)
- Header text overflows
- Modal buttons cramped
- Overall: Barely usable (★★☆☆☆)

Tablet User Experience:
- Buttons fit but cramped
- Navigation functional but crowded
- Overall: Acceptable (★★★☆☆)

Desktop User Experience:
- Excellent layout and spacing
- Professional appearance
- Overall: Great (★★★★★)
```

### After Implementation
```
Mobile User Experience:
- 44×44px touch targets work perfectly
- Header stacks nicely
- Modal buttons readable
- Overall: App-like experience (★★★★☆)

Tablet User Experience:
- Optimized spacing
- Professional layout
- Overall: Excellent (★★★★★)

Desktop User Experience:
- Maintains original quality
- Overall: Still great (★★★★★)
```

---

## Related Issues from Previous Reviews

**From RESPONSIVE_DESIGN_ANALYSIS.md**:
- Phase 1 includes button layout optimization
- Estimated 2-3 hours for button layout responsive design

**From MOBILE_ANIMATION_PERFORMANCE_REVIEW.md**:
- Larger touch targets improve usability of aircraft selection
- 48px × 48px recommended for aircraft tap targets

---

## Notes

1. **Inline Style Cleanup**: Many buttons have inline `style="padding: 4px 8px; font-size: 0.8rem;"` - Consider moving to classes after implementing media queries

2. **Header Title Optimization**: "제주공항 흐름 관리 시스템" is 8 Korean characters (~200px width). On mobile, consider:
   - Hide span portion (keep just "제주공항")
   - Or abbreviate to "CJU Flow Sim"

3. **Navigation Alternative**: On 375-480px, consider hamburger menu for nav-btn + excel-upload-section

4. **Button Text Localization**: Korean button text takes more space than English:
   - "로그아웃" = 7px more width than "Logout"
   - "새로 고침" = centered text is important for visual balance

5. **Date Input**: HTML `<input type="date">` has native browser styling that's hard to override. Consider:
   - Custom date picker on mobile (if date range modal already exists)
   - Or accept native styling and add more padding around it

---

## Success Metrics

| Metric | Target | Current | Success |
|--------|--------|---------|---------|
| Mobile touch target size | ≥44×44px | 18-20×20px | ❌ |
| Header fits without scroll (375px) | ✓ | ❌ | ❌ |
| Modal buttons readable (375px) | ✓ | ❌ | ❌ |
| Date controls usable (375px) | ✓ | ❌ | ❌ |
| Tablet layout (768px) | ✓ | ⚠️ | ⚠️ |
| Desktop layout (1920px) | ✓ | ✓ | ✓ |
| Button visual consistency | ✓ | ⚠️ | ⚠️ |

---

## File Summary

**Files Requiring Changes**:
1. `src/style.css` (PRIMARY) - Add ~150-200 lines of responsive media queries
2. `index.html` (OPTIONAL) - Add class names to button groups for easier targeting

**Estimated Effort**: 4-5 hours
**Complexity**: Medium (CSS media queries, no JavaScript changes needed)
**Risk Level**: Low (purely visual, no functional changes)

---

**Next Steps**: Implement phases in order (1 → 2 → 3 → 4) with testing at each phase to ensure mobile, tablet, and desktop all work correctly.
