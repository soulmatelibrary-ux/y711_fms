# Y711 FMS 최종 테스트 계획

**테스트 대상**: 다중 사용자 격리 시스템 (Multi-User Isolation)
**테스트 날짜**: 2026-02-07
**상태**: ✅ 빌드 성공 (Build passed: 0 errors)

---

## 📋 사전 준비

### 환경 설정
- 개발 서버 실행 중: `npm run dev` → `http://localhost:7300`
- 브라우저 콘솔 열기: F12 또는 우클릭 → 개발자 도구
- 3개의 브라우저 탭 또는 시크릿 윈도우 준비 (사용자 1, 2, 3 시뮬레이션용)

### 테스트 사용자
```
사용자 1: acc / katc0012#$
사용자 2: acc / katc0012#$ (같은 계정, 다른 세션)
사용자 3: acc / katc0012#$ (같은 계정, 다른 세션)
```

> **참고**: 현재 단일 사용자 계정(acc) 사용. 향후 다중 계정 시스템 구현 예정.

---

## 🧪 테스트 시나리오

### 테스트 1: 기본 로그인 및 세션 격리

**목표**: 각 사용자의 세션이 독립적으로 관리되는지 확인

**절차**:
1. 탭 1에서 로그인: `acc / katc0012#$`
2. 탭 1의 브라우저 콘솔에서 실행:
   ```javascript
   console.log('User 1 Session:', {
       user: localStorage.getItem('y711_user'),
       userId: localStorage.getItem('y711_user_id'),
       session: localStorage.getItem('y711_session').substring(0, 8) + '...',
       loginTime: localStorage.getItem('y711_login_time')
   });
   ```
3. 탭 2에서 로그인: `acc / katc0012#$` (새 세션)
4. 탭 2의 브라우저 콘솔에서 실행:
   ```javascript
   console.log('User 2 Session:', {
       user: localStorage.getItem('y711_user'),
       userId: localStorage.getItem('y711_user_id'),
       session: localStorage.getItem('y711_session').substring(0, 8) + '...',
       loginTime: localStorage.getItem('y711_login_time')
   });
   ```

**예상 결과**:
- ✅ User 1 session과 User 2 session이 다른 토큰을 가짐
- ✅ 두 로그인 시간이 다름
- ✅ 각 탭의 y711_user_id 동일 (같은 계정)

---

### 테스트 2: 사용자별 Excel 데이터 격리

**목표**: 각 사용자가 자신의 Excel 데이터만 보는지 확인

**절차**:

#### 사용자 1 - Excel 업로드
1. 탭 1에서 "📂 Excel 업로드" 클릭
2. 샘플 파일 사용 또는 생성:
   ```
   CALLSIGN | DEPT | DEST | CFL   | EOBT | DAY_OF_WEEK
   AAR123  | RKSS | RKPC | FL280 | 0630 | 1
   AAL456  | RKTU | RKPC | FL320 | 0745 | 1
   KAL789  | RKJK | RKPC | FL290 | 0830 | 2
   ```
3. 날짜 범위 선택:
   - 시작: 2026-02-01
   - 종료: 2026-08-31 (6개월)
4. 확인 및 업로드
5. Toast 메시지 확인: "✅ 3개 항공편이 업로드되었습니다"
6. 지도에 3개 항공편 표시 확인

#### 사용자 2 - 데이터 격리 확인
1. 탭 2에서 지도 확인
2. **예상**: 아무 항공편도 보이지 않음 (사용자 1의 데이터는 안 보임)
3. 콘솔에서:
   ```javascript
   const db = window.fmsDebug.db;
   db.exec('SELECT COUNT(*) as count FROM flights WHERE user_id = ?',
           [localStorage.getItem('y711_user_id')]).forEach(row => {
       console.log('User 2 flights count:', row.values);
   });
   ```
4. **예상**: 0개 (또는 null)

#### 사용자 1 - 데이터 확인
1. 탭 1에서 콘솔:
   ```javascript
   const db = window.fmsDebug.db;
   db.exec('SELECT * FROM flights').forEach(row => {
       console.log('All flights in DB:', row.values);
   });
   db.exec('SELECT * FROM flights WHERE user_id = ?',
           [localStorage.getItem('y711_user_id')]).forEach(row => {
       console.log('User 1 flights:', row.values);
   });
   ```
2. **예상**: 3개 항공편 표시

**예상 결과**:
- ✅ 사용자 1: 자신이 업로드한 3개 항공편 표시
- ✅ 사용자 2: 항공편 안 보임 (0개)
- ✅ 데이터베이스에서 user_id 필터링 작동

---

### 테스트 3: 사용자별 CTOT 계산 격리

**목표**: 각 사용자의 CTOT 계산이 독립적으로 작동하는지 확인

**절차**:

#### 사용자 1 - CTOT 계산
1. 탭 1에서 지도의 첫 번째 항공편 클릭
2. CTOT 계산 확인 (예: AAR123 → CTOT: 0730)
3. 콘솔에서:
   ```javascript
   const db = window.fmsDebug.db;
   db.exec('SELECT * FROM ctot_calculations WHERE user_id = ?',
           [localStorage.getItem('y711_user_id')]).forEach(row => {
       console.log('User 1 CTOT calculations:', row.values);
   });
   ```

#### 사용자 2 - CTOT 독립 계산
1. 탭 2에서 (여전히 항공편이 안 보이므로) 콘솔 사용
2. 동일한 콘솔 명령 실행
3. **예상**: 0개 또는 다른 데이터

#### 사용자 1 - CTOT 수정
1. 탭 1에서 CTOT 값 변경 (예: 0730 → 0740)
2. 콘솔에서 ctot_calculations 테이블 확인
3. **예상**: 변경된 CTOT 값 저장됨

#### 사용자 2 - CTOT 값 영향 없음
1. 탭 2에서 콘솔
2. ctot_calculations 테이블 확인
3. **예상**: 사용자 1의 변경 사항이 반영되지 않음

**예상 결과**:
- ✅ 사용자 1: CTOT 계산 및 수정 성공
- ✅ 사용자 2: CTOT 계산 데이터 없음
- ✅ 각 사용자의 CTOT 독립적 관리

---

### 테스트 4: 사용자별 항공편 수정/삭제 권한

**목표**: 사용자가 자신의 데이터만 수정/삭제할 수 있는지 확인

**절차**:

#### 사용자 1 - 항공편 수정
1. 탭 1의 항공편 목록에서 "편집" 버튼 클릭
2. 항공편 정보 수정 (예: CALLSIGN: AAR123 → AAR124)
3. 저장 클릭
4. **예상**: 수정 성공, 지도 업데이트

#### 사용자 2 - 권한 확인 (콘솔 테스트)
1. 탭 2에서 콘솔:
   ```javascript
   // 사용자 1의 항공편 ID 가져오기
   const db = window.fmsDebug.db;
   db.exec('SELECT id FROM flights WHERE user_id != ?',
           [localStorage.getItem('y711_user_id')]).forEach(row => {
       console.log('User 1 flight ID:', row.values[0][0]);
   });
   ```
2. 해당 ID로 editFlightRecord() 호출 시도
3. **예상**: 거부되거나 권한 에러

#### 사용자 1 - 항공편 삭제
1. 탭 1에서 항공편의 "삭제" 버튼 클릭
2. 확인 창에서 "삭제" 클릭
3. **예상**: 항공편 삭제 성공, 지도에서 제거

#### 데이터베이스 확인
1. 탭 1 콘솔:
   ```javascript
   const db = window.fmsDebug.db;
   db.exec('SELECT COUNT(*) as count FROM flights WHERE user_id = ?',
           [localStorage.getItem('y711_user_id')]).forEach(row => {
       console.log('User 1 flights after deletion:', row.values);
   });
   ```
2. **예상**: 2개 (3개 중 1개 삭제)

**예상 결과**:
- ✅ 사용자 1: 자신의 항공편 수정/삭제 가능
- ✅ 사용자 2: 다른 사용자의 항공편 수정/삭제 불가
- ✅ 권한 체크 로직 작동

---

### 테스트 5: 세션 타임아웃

**목표**: 30분 비활동 시 자동 로그아웃 되는지 확인

**절차**:

#### 일반 테스트 (테스트 환경용)
1. 탭 1에서 로그인
2. 콘솔에서:
   ```javascript
   const sessionInfo = window.auth?.getSessionInfo?.();
   console.log('Session Info:', sessionInfo);
   ```
3. 세션 만료 시간 확인
4. 개발자 도구에서 localStorage 확인:
   - `y711_session_expires_at` 확인

#### 빠른 타임아웃 테스트 (선택사항)
1. auth.js의 SESSION_TIMEOUT_MINUTES를 1분으로 임시 변경
2. 1분 30초 대기
3. 페이지 상호작용 (마우스 움직임)
4. **예상**: 자동 로그아웃 및 로그인 페이지 리다이렉트

**예상 결과**:
- ✅ 세션 만료 시간 설정됨
- ✅ 1분마다 세션 확인 로직 작동
- ✅ 만료 시 자동 로그아웃

---

### 테스트 6: 브라우저 콘솔 에러 확인

**목표**: 런타임 에러가 없는지 확인

**절차**:
1. 각 탭에서 F12로 개발자 도구 열기
2. Console 탭 확인
3. **확인 사항**:
   - ❌ "processExcelFile is not defined" → 없어야 함
   - ❌ "process is not defined" → 없어야 함
   - ❌ "formatDateRange is not defined" → 없어야 함
   - ❌ 기타 ReferenceError → 없어야 함

**예상 결과**:
- ✅ 콘솔에 에러 메시지 없음
- ✅ 경고(warning) 수 최소화
- ✅ "App initialization complete" 메시지 표시

---

### 테스트 7: 사용자 1, 2, 3 동시 테스트

**목표**: 3개 세션이 동시에 작동하는지 확인

**절차**:

#### 3개 탭 준비
1. 탭 1: 로그인 상태 (사용자 1의 데이터 표시)
2. 탭 2: 로그인 상태 (사용자 2 - 데이터 없음)
3. 탭 3: 로그인 상태 (사용자 3 - 데이터 없음)

#### 동시 작업 수행
1. 탭 1: 지도에서 항공편 선택
2. 탭 2: 콘솔에서 데이터 확인
3. 탭 3: CTOT 계산 영역 확인 (데이터 없으므로 빈 상태)

#### 탭 1에서 Excel 업로드
1. 다른 데이터로 새 Excel 업로드 (4개 항공편)
2. 날짜 범위: 2026-02-08 ~ 2026-05-08
3. 탭 2, 3에서는 여전히 데이터 안 보임

#### 각 탭의 데이터베이스 상태 확인
```javascript
// 각 탭 콘솔에서 실행
const db = window.fmsDebug.db;
const userId = localStorage.getItem('y711_user_id');
db.exec(`SELECT COUNT(*) as count FROM flights WHERE user_id = ?`, [userId])
  .forEach(row => console.log('My flights:', row.values));
db.exec('SELECT COUNT(*) as total FROM flights')
  .forEach(row => console.log('Total flights in DB:', row.values));
```

**예상 결과**:
- ✅ 탭 1: 4개 항공편 표시
- ✅ 탭 2: 0개 (또는 이전 데이터)
- ✅ 탭 3: 0개 (또는 이전 데이터)
- ✅ 전체 데이터베이스: 모든 항공편 합 (7개)
- ✅ 각 사용자의 데이터는 독립적

---

## 📊 테스트 체크리스트

| # | 테스트 항목 | 상태 | 결과 |
|---|-----------|------|------|
| 1 | 기본 로그인 및 세션 격리 | ⬜ | |
| 2 | 사용자별 Excel 데이터 격리 | ⬜ | |
| 3 | 사용자별 CTOT 계산 격리 | ⬜ | |
| 4 | 사용자별 항공편 수정/삭제 권한 | ⬜ | |
| 5 | 세션 타임아웃 | ⬜ | |
| 6 | 브라우저 콘솔 에러 확인 | ⬜ | |
| 7 | 사용자 1, 2, 3 동시 테스트 | ⬜ | |

---

## 📝 테스트 결과 기록

각 테스트 완료 후 다음 정보를 기록하세요:

```
테스트 1: 기본 로그인 및 세션 격리
시간: ___________
결과: ✅ 성공 / ❌ 실패
에러 메시지:
추가 사항:

---
```

---

## 🔍 디버깅 팁

**세션 정보 확인**:
```javascript
const userId = localStorage.getItem('y711_user_id');
const sessionInfo = {
    user: localStorage.getItem('y711_user'),
    userId: userId,
    session: localStorage.getItem('y711_session')?.substring(0, 8),
    expiresAt: localStorage.getItem('y711_session_expires_at'),
    loginTime: localStorage.getItem('y711_login_time')
};
console.log('Session Info:', sessionInfo);
```

**사용자별 항공편 확인**:
```javascript
const db = window.fmsDebug.db;
const userId = localStorage.getItem('y711_user_id');

// 내 항공편
db.exec('SELECT id, callsign, dept, dest, user_id FROM flights WHERE user_id = ?', [userId])
  .forEach(row => console.log('My Flights:', row.values));

// 모든 항공편
db.exec('SELECT id, callsign, dept, dest, user_id FROM flights')
  .forEach(row => console.log('All Flights:', row.values));
```

**CTOT 계산 확인**:
```javascript
const db = window.fmsDebug.db;
const userId = localStorage.getItem('y711_user_id');

db.exec('SELECT * FROM ctot_calculations WHERE user_id = ?', [userId])
  .forEach(row => console.log('My CTOT Calculations:', row.values));
```

---

## ✅ 빌드 및 준비 상태

- ✅ Build successful (0 errors, 0 warnings)
- ✅ Dev server running: `http://localhost:7300`
- ✅ 모든 런타임 에러 해결:
  - ✅ `process is not defined` 해결
  - ✅ `formatDateRange is not defined` 해결
  - ✅ `sessionTimeoutCheckInterval` 초기화 순서 수정
  - ✅ `processExcelFile is not defined` 해결 (window 객체 노출)
- ✅ HTML 인라인 스크립트에서 함수 호출 가능
- ✅ 데이터베이스 스키마 마이그레이션 완료
- ✅ 사용자 격리 로직 구현 완료

---

## 🎯 최종 테스트 실행 명령어

```bash
# 개발 서버 시작
npm run dev

# 브라우저에서 열기
open http://localhost:7300/login.html

# 또는 수동으로 브라우저 주소창에 입력
http://localhost:7300/login.html
```

**테스트 시작**: 위의 테스트 시나리오 1번부터 순서대로 진행하세요.

---

**테스트 계획 작성일**: 2026-02-07
**예상 소요 시간**: 30-45분
**보고 연락처**: 테스트 완료 후 결과 보고
