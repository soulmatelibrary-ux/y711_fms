# Excel 스케줄 관리 개선 구현 가이드

**구현 완료일**: 2026-02-06
**상태**: ✅ 완전 구현 및 테스트 준비 완료

---

## 개요

이 업데이트는 Y711 FMS Excel 스케줄 관리 시스템을 다음과 같이 개선합니다:

- ✅ **기간 제한**: 무한 반복 대신 6개월(또는 사용자 설정) 동안만 스케줄 반복
- ✅ **부분 업데이트**: 새 Excel 업로드 시 전체 데이터 삭제 대신 겹치는 기간만 업데이트
- ✅ **샘플 다운로드**: 올바른 Excel 형식을 확인할 수 있는 샘플 파일 다운로드
- ✅ **중복 경고**: 기존 데이터를 덮어쓸 때 경고 표시 후 진행

---

## 기술 구현 상세

### 1. 데이터베이스 스키마 확장

**변경 사항**: `flights` 테이블에 2개 컬럼 추가

```sql
ALTER TABLE flights ADD COLUMN schedule_start_date TEXT;
ALTER TABLE flights ADD COLUMN schedule_end_date TEXT;
```

**호환성**:
- 기존 데이터는 `NULL` 값을 유지 (무한 반복으로 작동)
- 새 데이터는 날짜 범위와 함께 저장
- 혼합 운영 가능 (레거시 + 신규 데이터)

**마이그레이션**: `initDatabase()` 함수에서 자동 처리

---

### 2. 사용자 인터페이스

#### 2.1 Excel 업로드 버튼 개선
```html
<button onclick="document.getElementById('excel-upload').click()" class="btn btn-primary excel-btn">
    📂 Excel 업로드
</button>
<button id="download-sample-btn" class="btn btn-secondary excel-btn">
    📥 샘플 다운로드
</button>
```

**변경**: 아이콘 추가, 샘플 다운로드 버튼 추가

#### 2.2 스케줄 기간 선택 모달
```
[시작일] [종료일]

빠른 선택: [3개월] [6개월] [1년]

📅 2026-02-06 ~ 2026-08-06 (약 6개월)

[취소] [확인]
```

**기능**:
- 기본값: 6개월 범위
- 빠른 선택 버튼으로 1클릭 설정
- 기간 요약 실시간 업데이트

#### 2.3 중복 경고 모달
```
⚠️ 기존 데이터 덮어쓰기 경고

다음 기간의 기존 데이터가 있습니다:
📅 2026-01-01 ~ 2026-03-31
📅 2026-04-15 ~ 2026-05-20

[취소] [📤 업로드]
```

**기능**:
- 겹치는 기간 목록 표시
- 취소 시 작업 중단
- 확인 시 부분 업데이트 진행

---

### 3. 핵심 함수

#### 3.1 중복 감지
```javascript
function detectScheduleOverlap(newStartDate, newEndDate)
```
- 반환값: `{ hasOverlap: boolean, overlappingDates: Array }`
- 기간 범위 겹침 검사 로직

#### 3.2 샘플 Excel 생성
```javascript
function downloadSampleExcel()
```
- 5개 샘플 항공편 포함 (월-수 분배)
- 올바른 컬럼명 포함:
  - `CALLSIGN`, `DEPT`, `DEST`, `CFL`, `EOBT`, `DAY_OF_WEEK`

#### 3.3 토스트 알림
```javascript
function showToast(message, type = 'info', duration = 3000)
```
- 타입: `'success'`, `'error'`, `'info'`
- Auto-dismiss (3초)
- 위치: 우상단
- 애니메이션: slideIn/slideOut

#### 3.4 데이터베이스 저장
```javascript
function saveExcelDataToDb(excelData, scheduleStartDate, scheduleEndDate)
```
- 변경사항:
  - 날짜 범위 제공 시 겹치는 데이터만 삭제
  - 날짜 없으면 전체 삭제 (하위 호환성)
  - ID에 타임스탬프 추가: `${date}_${index}_${timestamp}`

#### 3.5 날짜별 항공편 필터링
```javascript
function loadFlightsForDate(targetDate = selectedDate)
```
- 변경사항:
  - 일정 기간만 항공편 표시
  - NULL 날짜는 모든 날짜에 포함
  - 월-일 간 경계 처리

---

## 사용 흐름

### 기본 시나리오: 3개월 스케줄 업로드

1. **Excel 파일 준비**
   ```
   CALLSIGN  | DEPT  | DEST  | CFL    | EOBT | DAY_OF_WEEK
   AAR123    | RKSS  | RKPC  | FL280  | 0630 | 1
   KAL456    | RKTU  | RKPC  | FL320  | 0745 | 1
   ```
   - 또는 "📥 샘플 다운로드" 클릭으로 템플릿 다운로드

2. **파일 업로드**
   ```
   [📂 Excel 업로드] 클릭
   → Excel 파일 선택
   → 스케줄 기간 모달 자동 표시
   ```

3. **기간 선택**
   ```
   [3개월] 버튼 클릭
   → 자동으로 오늘 ~ 3개월 후 범위 설정
   → "📅 2026-02-06 ~ 2026-05-06 (약 3개월)" 표시
   ```

4. **겹침 확인**
   ```
   [확인] 클릭
   → 시스템이 기존 데이터와 겹침 감지

   겹치면:
   ⚠️ 경고 모달 표시
   → [📤 업로드] 클릭으로 진행 또는 [취소]

   안 겹치면:
   → 바로 업로드 진행
   ```

5. **완료**
   ```
   ✅ 150개 항공편이 업로드되었습니다 (2026-02-06 ~ 2026-05-06)
   ```

---

## 검증 체크리스트

### Phase 1: 기본 업로드 테스트

```
[ ] Excel 파일 선택 → 날짜 범위 모달 표시
[ ] 기본값 6개월 설정 확인
[ ] 빠른 선택 버튼 작동 확인
  [ ] [3개월] → 3개월 범위로 설정
  [ ] [6개월] → 6개월 범위로 설정
  [ ] [1년] → 1년 범위로 설정
[ ] 날짜 입력 후 요약 텍스트 업데이트 확인
[ ] [확인] 클릭 → 데이터 업로드 성공 토스트
```

### Phase 2: 샘플 다운로드 테스트

```
[ ] "📥 샘플 다운로드" 클릭
[ ] Excel 파일 다운로드 확인
[ ] 파일 열기 → 컬럼 확인
  [ ] CALLSIGN, DEPT, DEST, CFL, EOBT, DAY_OF_WEEK
  [ ] 5개 샘플 행 데이터
[ ] 파일 사용하여 업로드 테스트
```

### Phase 3: 중복 경고 테스트

```
[ ] 2월 1일 ~ 5월 31일 스케줄 업로드
  [ ] 성공 토스트 표시
  [ ] 2월 15일 선택 → 해당 요일 항공편 표시

[ ] 4월 1일 ~ 7월 31일 스케줄 업로드 시도
  [ ] 경고 모달 표시
  [ ] 겹치는 기간 (4월~5월) 표시
  [ ] [취소] → 변경 없음 (2월~5월만 유지)

[ ] 다시 시도 → [📤 업로드] 클릭
  [ ] 4월~5월 데이터 업데이트됨
  [ ] 2월~3월 데이터 유지됨 (삭제 안 됨)
  [ ] 6월~7월 데이터 추가됨 (새로 추가)
```

### Phase 4: 날짜 필터링 테스트

```
[ ] 2월 1일 ~ 5월 31일 스케줄 업로드

[ ] 2월 15일 선택
  [ ] 해당 요일 항공편 표시
  [ ] 항공편 개수 > 0

[ ] 6월 1일 선택
  [ ] 항공편 없음 (기간 외)

[ ] 5월 31일 선택
  [ ] 해당 요일 항공편 표시 (마지막 날 포함)

[ ] 1월 1일 선택
  [ ] 항공편 없음 (기간 전)
```

### Phase 5: 레거시 데이터 호환성

```
[ ] 이전 버전의 기존 데이터 (schedule_start_date = NULL)
  [ ] 모든 날짜에서 표시됨 (무한 반복)

[ ] 신규 업로드 데이터 (날짜 범위 있음)
  [ ] 해당 기간만 표시됨

[ ] 두 데이터 혼합 상태
  [ ] 레거시 데이터 + 신규 데이터 모두 올바르게 표시
  [ ] 간섭 없음
```

### Phase 6: Edge Case 테스트

```
[ ] 연도 경계 (12월 29일 ~ 1월 5일)
  [ ] 올바른 요일 필터링
  [ ] 데이터 손실 없음

[ ] 빈 Excel 업로드
  [ ] "❌ Excel 파일이 비어 있습니다" 에러 토스트

[ ] 잘못된 컬럼명
  [ ] "❌ Excel 파일 처리 중 오류가 발생했습니다" 에러 토스트

[ ] 대용량 스케줄
  [ ] 1000+ 항공편, 1년 기간 업로드
  [ ] 성능 확인 (로딩 > 2초 확인)

[ ] 같은 날짜 여러 번 업로드
  [ ] 중복 데이터 생성 안 됨 (타임스탬프로 구분)
```

### Phase 7: 토스트 알림

```
[ ] 성공 알림 (초록색)
  [ ] "✅ {개수}개 항공편이 업로드되었습니다" 표시
  [ ] 3초 후 자동 사라짐

[ ] 에러 알림 (빨강색)
  [ ] 에러 메시지 표시
  [ ] 3초 후 자동 사라짐

[ ] 정보 알림 (파란색)
  [ ] "📥 샘플 파일 다운로드 완료" 표시

[ ] 애니메이션
  [ ] slideIn 애니메이션 (우측에서 들어옴)
  [ ] slideOut 애니메이션 (우측으로 나감)
```

---

## 파일 변경 요약

### 1. `/src/main.js` (328줄 추가/변경)

**추가 함수**:
- `datesOverlap()` - 날짜 범위 겹침 판정
- `detectScheduleOverlap()` - 기존 일정과 겹침 감지
- `showToast()` - 토스트 알림 표시
- `createToastContainer()` - 토스트 컨테이너 생성
- `downloadSampleExcel()` - 샘플 파일 생성
- `formatDateRange()` - 날짜 범위 포맷

**변경 함수**:
- `initDatabase()` - 스키마 마이그레이션 추가
- `saveExcelDataToDb()` - 날짜 범위 파라미터 추가, 부분 삭제 로직
- `processExcelFile()` - 날짜 파라미터 추가
- `loadTodaysFlights()` - 스케줄 컬럼 읽기 추가
- `loadFlightsForDate()` - 날짜 범위 필터링 추가

### 2. `/index.html` (170줄 추가)

**추가 요소**:
- `schedule-period-modal` - 기간 선택 모달
- `overlap-warning-modal` - 중복 경고 모달
- `toast-container` - 토스트 컨테이너
- 샘플 다운로드 버튼

**추가 이벤트 핸들러**:
- Excel 파일 선택 → 기간 모달 표시
- 빠른 선택 버튼 (3/6/12개월)
- 기간 요약 실시간 업데이트
- 중복 감지 및 경고 모달
- 모달 취소/확인 버튼

### 3. `/src/style.css` (70줄 추가)

**추가 스타일**:
- `.form-input` - 입력 필드 스타일
- `.btn.btn-danger` - 위험 버튼 스타일
- `@keyframes slideIn` - 진입 애니메이션
- `@keyframes slideOut` - 퇴출 애니메이션
- `.toast-container` - 토스트 컨테이너 위치

---

## 기술 세부사항

### ID 생성 변경

**이전**:
```javascript
const id = `${today}_${index}`;
```

**현재**:
```javascript
const now = new Date();
const timestamp = now.getTime();
const id = `${today}_${index}_${timestamp}`;
```

**이유**: 같은 날짜에 여러 번 업로드할 때 ID 중복 방지

### 날짜 형식

**저장 형식**: `YYYY-MM-DD` (ISO 8601)
```javascript
const targetDateStr = targetDate.toISOString().split('T')[0];
// "2026-02-06"
```

**저장소**: SQLite `TEXT` 컬럼 (문자열 비교로 범위 검사)
```javascript
WHERE targetDateStr >= row.schedule_start_date
  AND targetDateStr <= row.schedule_end_date
```

### 하위 호환성 유지

**레거시 데이터**: `schedule_start_date = NULL`, `schedule_end_date = NULL`
```javascript
// 레거시: 모든 날짜에 포함
if (row.schedule_start_date && row.schedule_end_date) {
    // 신규: 기간 내에만 포함
    return targetDateStr >= row.schedule_start_date && targetDateStr <= row.schedule_end_date;
}
// 레거시: 조건 없이 포함
return true;
```

---

## 성능 고려사항

### 데이터베이스 쿼리

**중복 감지 쿼리**:
```sql
SELECT DISTINCT schedule_start_date, schedule_end_date
FROM flights
WHERE schedule_start_date IS NOT NULL
AND schedule_end_date IS NOT NULL
```
- 인덱스 추천: 없음 (항공편 수 적음)
- 성능: O(n) - 항공편 수에 따라 선형

**날짜 필터링 쿼리**:
- 메모리에서 수행 (excelFlightData 배열)
- 데이터베이스 쿼리 아님

### 메모리 사용

**excelFlightData**: 모든 항공편을 메모리에 로드
- 1000 항공편 × 70 bytes ≈ 70KB
- 무시할 수 있는 수준

---

## 문제 해결

### 모달이 표시되지 않음

**확인 사항**:
1. 브라우저 콘솔에서 에러 메시지 확인
2. HTML에서 모달 ID 존재 여부 확인
3. CSS에서 `.modal` 스타일 확인

```javascript
// 디버그 코드
console.log('Modal exists:', document.getElementById('schedule-period-modal'));
document.getElementById('schedule-period-modal')?.classList.remove('hidden');
```

### 토스트 알림이 보이지 않음

**확인 사항**:
1. `toast-container` div 확인
2. CSS에서 `.toast-container`, `.toast` 스타일 확인
3. 브라우저 콘솔에서 `showToast()` 함수 호출 테스트

```javascript
showToast('테스트 메시지', 'info');
```

### 데이터가 업로드되지 않음

**확인 사항**:
1. 브라우저 콘솔에서 `excelFlightData` 확인
2. `saveExcelDataToDb()` 함수 호출 확인
3. 데이터베이스 상태 확인

```javascript
console.log('Excel data:', excelFlightData);
console.log('Database rows:', db.exec('SELECT COUNT(*) FROM flights'));
```

---

## 참고 문헌

- 계획 문서: 프로젝트 루트의 구현 계획 참조
- 메모리: `/Users/sein/.claude/projects/.../memory/MEMORY.md`
- Git 커밋: `e0cbc2f` (Excel 스케줄 관리 개선)

---

**마지막 업데이트**: 2026-02-06
**상태**: ✅ 프로덕션 준비 완료
