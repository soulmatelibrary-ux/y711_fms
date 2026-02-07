# 3D 지도 서비스 통합 가이드

다른 프로젝트에 3D 지도 서비스를 통합하는 단계별 가이드입니다.

---

## 📋 체크리스트

- [ ] 파일 복사
- [ ] 데이터베이스 스키마 생성
- [ ] 데이터 마이그레이션
- [ ] 백엔드 API 등록
- [ ] 프론트엔드 통합
- [ ] 스타일링 조정
- [ ] 테스트 및 검증

---

## Step 1: 파일 복사

### 1.1 디렉토리 생성
```bash
mkdir -p your-project/map
cd your-project
```

### 1.2 파일 복사
```bash
# 이 폴더의 전체 내용 복사
cp -r similarity_detector/map/* your-project/map/
```

### 1.3 폴더 구조 확인
```bash
tree map/
# map/
# ├── backend/
# │   ├── map_api.py
# │   └── db_manager.py
# ├── database/
# │   ├── schema.sql
# │   ├── migrate_geojson.py
# │   └── db_manager.py
# ├── frontend/
# │   ├── index.html
# │   ├── style.css
# │   ├── main.js
# │   └── js/renderers/
# │       ├── coordinate-transformer.js
# │       └── map-renderer.js
# ├── docs/
# │   └── INTEGRATION_GUIDE.md (이 파일)
# └── README.md
```

---

## Step 2: 데이터베이스 설정

### 2.1 스키마 생성

```bash
sqlite3 your_database.db < map/database/schema.sql
```

확인:
```bash
sqlite3 your_database.db ".tables"
# 출력: geo_coastlines  geo_sectors  geo_fixpoints  geo_routes
```

### 2.2 데이터 마이그레이션

GeoJSON 데이터 파일을 준비합니다:

```
Tmp/airspace/data/
├── korea-provinces.geojson
├── japan-coastline.geojson
├── china-provinces.geojson
├── northkorea-provinces.geojson
├── coastline.geojson
├── sector.csv
├── aip_fixpoints.geojson
└── aip_routes.geojson
```

마이그레이션 실행:
```bash
# map/database/migrate_geojson.py의 경로 수정
# AIRSPACE_DATA_DIR = Path('Tmp/airspace/data')  # 또는 실제 경로

python3 map/database/migrate_geojson.py
```

출력 예시:
```
🗺️  지도 서비스 지리정보 마이그레이션 시작
📂 소스 디렉토리: Tmp/airspace/data

✅ 해안선 마이그레이션 완료!
  • korea          - 2816 features, 14.7MB
  • japan          - 47 features, 12.7MB
  ...

✅ 마이그레이션 완료!
📊 결과 요약:
  • 해안선 레코드: 2816
  • 섹터 레코드: 14
  • 지점 레코드: 309
  • 항로 레코드: 101
```

---

## Step 3: 백엔드 통합

### 3.1 DatabaseManager 확인

`db_manager.py`가 다음 메서드를 포함하는지 확인:
```python
class DatabaseManager:
    def get_connection(self):
        """SQLite 연결 반환"""
        return sqlite3.connect(...)
```

### 3.2 Flask 앱에 API 등록

```python
# your_app.py 또는 main.py

from flask import Flask
from map.backend.map_api import create_map_routes
from database.db_manager import DatabaseManager

app = Flask(__name__)

# 데이터베이스 매니저 초기화
db_manager = DatabaseManager('your_database.db')

# 지도 API 라우트 생성 및 등록
map_api_blueprint = create_map_routes(db_manager)
app.register_blueprint(map_api_blueprint)

# 결과:
# GET /api/map/geo/coastlines
# GET /api/map/geo/sectors
# GET /api/map/geo/fixpoints
# GET /api/map/geo/routes
```

### 3.3 로거 설정 (선택사항)

```python
import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# 핸들러 추가...
```

---

## Step 4: 프론트엔드 통합

### 4.1 메인 페이지에 뷰 추가

```html
<!-- your_page.html -->

<!-- 탭 네비게이션 -->
<nav class="nav-tabs">
    <button class="nav-tab active" data-target="dashboard-view">
        대시보드
    </button>
    <button class="nav-tab" data-target="map-service-view">
        <i class="fas fa-map"></i> 3D 지도
    </button>
</nav>

<!-- 메인 콘텐츠 -->
<main class="main-content">
    <div id="dashboard-view" class="view-section active">
        <!-- 기존 대시보드 내용 -->
    </div>

    <!-- 3D 지도 뷰 (iframe으로 로드) -->
    <div id="map-service-view" class="view-section">
        <iframe src="map/frontend/index.html"
                style="width: 100%; height: 100%; border: none;">
        </iframe>
    </div>
</main>
```

### 4.2 CSS 스타일 추가

```css
/* 필수 스타일 */
.view-section {
    display: none;
    width: 100%;
}

.view-section.active {
    display: flex;
    flex-direction: column;
    flex: 1 0 auto;
    min-height: calc(100vh - 180px);
    overflow: visible;
}

/* 3D 지도 뷰 높이 설정 */
.view-section#map-service-view.active {
    height: calc(100vh - 220px);
    overflow: hidden;
}
```

### 4.3 JavaScript 탭 처리

```javascript
// your_ui.js 또는 tab_handler.js

const tabs = document.querySelectorAll('.nav-tab');
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        // 탭 활성화
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // 뷰 전환
        const targetId = tab.dataset.target;
        document.querySelectorAll('.view-section').forEach(view => {
            view.classList.remove('active');
            view.style.display = 'none';
        });

        const targetView = document.getElementById(targetId);
        targetView.classList.add('active');

        // 뷰별 display 설정
        if (targetId === 'map-service-view') {
            targetView.style.display = 'flex';
            console.log('🗺️ 3D 지도 탭 활성화');
        } else {
            targetView.style.display = 'flex';
        }
    });
});
```

---

## Step 5: 스타일링 조정

### 5.1 메뉴 너비 커스터마이징

`map/frontend/style.css`:
```css
.control-panel {
    width: 160px;  /* 변경 가능 */
    padding: 15px;
}
```

### 5.2 색상 커스터마이징

`map/frontend/style.css`:
```css
:root {
    --primary-color: #667eea;      /* 메뉴 버튼 색상 */
    --secondary-color: #764ba2;    /* 호버 색상 */
    --bg-dark: #1a1a2e;           /* 어두운 배경 */
    --bg-light: #f5f5f5;          /* 밝은 배경 */
}
```

### 5.3 해안선 색상

`map/frontend/main.js`:
```javascript
// 테마별 해안선 색상 결정
if (this.currentTheme === 'dark') {
    coastlineColor = 0xcccccc;  // 밝은 회색
} else {
    coastlineColor = 0x2a2a2a;  // 어두운 회색
}
```

---

## Step 6: 테스트 및 검증

### 6.1 데이터 확인

```bash
sqlite3 your_database.db << 'EOF'
SELECT COUNT(*) as coastlines FROM geo_coastlines;
SELECT COUNT(*) as sectors FROM geo_sectors;
SELECT COUNT(*) as fixpoints FROM geo_fixpoints;
SELECT COUNT(*) as routes FROM geo_routes;
EOF
```

예상 결과:
```
coastlines|5
sectors|14
fixpoints|309
routes|101
```

### 6.2 API 테스트

```bash
# 해안선 API
curl http://localhost:7400/api/map/geo/coastlines | python -m json.tool | head -20

# 섹터 API
curl http://localhost:7400/api/map/geo/sectors | python -m json.tool | head -20

# 지점 API
curl http://localhost:7400/api/map/geo/fixpoints?limit=5 | python -m json.tool

# 항로 API
curl http://localhost:7400/api/map/geo/routes?limit=5 | python -m json.tool
```

### 6.3 UI 테스트

브라우저에서:
1. 페이지 로드
2. "3D 지도" 탭 클릭
3. 지도가 로드되고 다음이 보이는지 확인:
   - ✅ 해안선 (회색)
   - ✅ 14개 섹터 (노란색 라인)
   - ✅ 309개 지점 (주황색 구체)
   - ✅ 101개 항로 (파란색 점선)

### 6.4 브라우저 콘솔 확인

F12 → Console 탭에서:
```
✅ CoordinateTransformer 초기화 완료
✅ MapRenderer 초기화 완료
✅ 2816 해안선 로드 완료
✅ 14 섹터 로드 완료
✅ 309 지점 로드 완료
✅ 101 항로 로드 완료
✅ Map Service 초기화 완료!
✅ 이벤트 리스너 설정 완료
```

---

## 🔧 고급 설정

### 다중 좌표계 지원

`coordinate-transformer.js`에서:
```javascript
// 기본: Mercator 투영법
const projection = 'mercator';

// 또는: Simple (등거리) 투영법
const projection = 'simple';
```

### 커스텀 색상 스킴

`main.js`에서 색상 변경:
```javascript
// 섹터 색상
const material = new THREE.LineBasicMaterial({
    color: 0xffff00,  // 노란색 → 커스텀 색상으로 변경
});

// 해안선 색상
coastlineColor = 0xcccccc;  // 밝은 회색 → 커스텀 색상으로 변경
```

### 카메라 초기 위치

`coordinate-transformer.js`에서:
```javascript
// 초기 카메라 위치 조정
this.cameraDistance = 1200;  // 기본값 변경
this.centerLat = 36.5;       // 중심 위도
this.centerLon = 127.5;      // 중심 경도
```

---

## 📞 문제 해결

### iframe이 로드되지 않음
```html
<!-- 절대 경로 사용 -->
<iframe src="/map/frontend/index.html"></iframe>
```

### API 404 에러
→ Blueprint 등록 확인:
```python
app.register_blueprint(map_api_blueprint)
```

### 데이터베이스 연결 오류
```python
# db_manager.py 경로 확인
db_manager = DatabaseManager('path/to/your_database.db')
```

### 3D 렌더링 안 됨
→ Three.js CDN 로드 확인:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
```

---

## ✅ 완료 체크

모두 완료되면:
- ✅ 4개 데이터베이스 테이블 생성됨
- ✅ 2,816개 해안선 + 14개 섹터 + 309개 지점 + 101개 항로 로드됨
- ✅ 4개 REST API 엔드포인트 작동
- ✅ 프론트엔드 iframe 로드
- ✅ 탭 네비게이션 작동
- ✅ 3D 지도 표시됨

축하합니다! 🎉 3D 지도 서비스 통합이 완료되었습니다!
