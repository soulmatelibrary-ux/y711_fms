# 3D 지도 서비스 (Map Service)

항공편 경로, 섹터, 경유지점, 해안선을 3D로 시각화하는 Three.js 기반 지도 서비스입니다.

## 📁 폴더 구조

```
map/
├── README.md                           # 이 파일
├── frontend/                           # 프론트엔드 코드
│   ├── index.html                      # 메인 페이지
│   ├── style.css                       # 스타일시트
│   ├── main.js                         # 초기화 및 제어 로직
│   ├── test.html                       # 테스트 페이지
│   └── js/renderers/
│       ├── map-renderer.js             # Three.js 렌더러 (1,368줄)
│       └── coordinate-transformer.js   # 좌표 변환 유틸리티
├── backend/                            # 백엔드 API
│   ├── map_api.py                      # 지도 API 라우트 (Blueprint)
│   └── (데이터베이스 매니저 필요)
└── database/                           # 데이터베이스
    ├── schema.sql                      # 4개 테이블 스키마
    ├── migrate_geojson.py              # GeoJSON 데이터 마이그레이션
    └── db_manager.py                   # 데이터베이스 매니저
```

---

## 🚀 빠른 시작

### 1. 파일 복사

다른 프로젝트로 복사:

```bash
cp -r map/ /path/to/your/project/
```

### 2. 데이터베이스 설정

#### 2.1 스키마 생성
```bash
sqlite3 your_database.db < map/database/schema.sql
```

#### 2.2 GeoJSON 데이터 마이그레이션

GeoJSON 파일들을 준비하고 마이그레이션:

```bash
python3 map/database/migrate_geojson.py
```

필요한 GeoJSON 파일:
- `korea-provinces.geojson` - 한국 행정구역
- `japan-coastline.geojson` - 일본 해안선
- `china-provinces.geojson` - 중국 행정구역
- `northkorea-provinces.geojson` - 북한 행정구역
- `coastline.geojson` - 동아시아 통합 해안선
- `sector.csv` - 항공 섹터 데이터
- `aip_fixpoints.geojson` - 항로 지점 (309개)
- `aip_routes.geojson` - 항로 데이터 (101개)

### 3. 백엔드 통합

Flask 앱에서 API 라우트 등록:

```python
from map.backend.map_api import create_map_routes
from database.db_manager import DatabaseManager

# DatabaseManager 초기화
db_manager = DatabaseManager('your_database.db')

# 지도 API 라우트 생성 및 등록
map_api_blueprint = create_map_routes(db_manager)
app.register_blueprint(map_api_blueprint)
```

### 4. 프론트엔드 통합

#### 4.1 HTML 페이지 추가

```html
<div id="map-service-view" class="view-section">
    <iframe src="map/frontend/index.html"
            style="width: 100%; height: 100%; border: none;">
    </iframe>
</div>
```

#### 4.2 탭 네비게이션에 추가

```html
<button class="nav-tab" data-target="map-service-view">
    <i class="fas fa-map"></i> 3D 지도
</button>
```

#### 4.3 JavaScript 탭 처리

```javascript
// UI 초기화 시
} else if (targetId === 'map-service-view') {
    targetView.style.display = 'flex';
    console.log('🗺️ 3D 지도 탭 활성화');
}
```

---

## 📊 API 엔드포인트

모든 API는 GeoJSON FeatureCollection을 반환합니다.

### 해안선
```
GET /api/map/geo/coastlines?regions=korea,japan,china,northkorea,east-asia
```
응답: 해안선 Polygon 피처

### 섹터
```
GET /api/map/geo/sectors?altitude_min=0&altitude_max=999999
```
응답: 통제 섹터 Polygon 피처

### 경유지점
```
GET /api/map/geo/fixpoints?limit=500&types=WAYPOINT
```
응답: 309개 항로 지점 Point 피처

### 항로
```
GET /api/map/geo/routes?limit=200&types=AIRWAY
```
응답: 101개 항로 LineString 피처

---

## 🎨 UI 컴포넌트

### 왼쪽 메뉴 (160px 고정 너비)

**표시 옵션:**
- ☑️ 섹터 표시 (노란색 라인)
- ☑️ 해안선 표시 (테마별 색상)
- ☑️ 지점 표시 (주황색 구체 + 라벨)

**카메라 제어:**
- ↻ 초기화 - 기본 뷰로 복구
- 🔍+ 확대 - 20% 가까워짐
- 🔍- 축소 - 20% 멀어짐

**조작법:**
- Ctrl + 좌클릭: 이동
- Ctrl + 우클릭: 회전
- 휠: 확대/축소

**테마:**
- ☑️ 어두운 모드 (기본)
  - 해안선: 밝은 회색 (0xcccccc)
  - 배경: 검정 (0x1a1a2e)
- ☐ 밝은 모드
  - 해안선: 어두운 회색 (0x2a2a2a)
  - 배경: 밝은 회색 (0xf5f5f5)

---

## 💾 데이터베이스 통계

현재 데이터:
- **해안선**: 2,816개 피처 (5개 지역)
- **섹터**: 14개 통제 섹터
- **경유지점**: 309개 항로 지점
- **항로**: 101개 국제항로

---

## 🛠️ 기술 스택

### 프론트엔드
- **Three.js** (r128) - 3D 렌더링
- **Canvas** - 텍스트 라벨링
- **Vanilla JavaScript** - 제어 로직

### 백엔드
- **Flask** - REST API
- **SQLite** - 데이터 저장
- **Python** - GeoJSON 처리
  - `shapely` - 지리정보 기하학
  - `json` - JSON 직렬화

### 데이터 형식
- **GeoJSON** - 지리정보 표준
- **WGS84** (EPSG:4326) - 좌표계
- **Polygon/LineString/Point** - 기하학 타입

---

## 📈 성능 특성

- **로딩 시간**: ~2초 (309개 지점, 101개 항로)
- **프레임레이트**: 60 FPS (WebGL 활성화 시)
- **메모리**: ~50MB (GeoJSON + Three.js 메시 포함)
- **네트워크**: ~2MB (모든 API 요청 합계)

---

## ⚙️ 필수 Python 패키지

```bash
pip install flask shapely numpy scipy pandas
```

---

## 📝 CSS 커스터마이징

메뉴 너비 조정:
```css
.control-panel {
    width: 160px;  /* 변경 가능 */
}
```

색상 커스터마이징:
```css
:root {
    --primary-color: #667eea;  /* 주색상 */
    --secondary-color: #764ba2;  /* 보조색 */
}
```

---

## 🐛 문제 해결

### iframe이 로드되지 않음
→ CORS 설정 확인 또는 상대 경로 확인

### 3D 지도가 보이지 않음
→ WebGL 지원 확인, Three.js CDN 로드 확인

### API 500 에러
→ 데이터베이스 연결 확인, schema.sql 실행 확인

### 경유지점이 너무 작음
→ main.js의 sprite.scale 값 조정

---

## 📄 라이선스

원본 Airspace-Sim-Station 프로젝트에 포함됨

---

## 💡 팁

1. **데이터 업데이트**: migrate_geojson.py 재실행으로 자동 갱신
2. **성능 최적화**: API limit 파라미터로 반환 데이터 제한
3. **커스텀 색상**: map-renderer.js의 색상 상수 변경
4. **새로운 데이터**: geo_* 테이블에 직접 INSERT 가능

---

## 📞 기술 지원

이 3D 지도 서비스는 Airspace-Sim-Station의 독립적인 모듈입니다.
다른 프로젝트에 쉽게 통합할 수 있도록 설계되었습니다.
