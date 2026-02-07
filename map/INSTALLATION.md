# 3D 지도 서비스 설치 및 배포 가이드

## 📦 패키지 내용

```
map/
├── README.md                          # 프로젝트 개요
├── INSTALLATION.md                    # 이 파일
├── frontend/                          # 프론트엔드 (Three.js)
│   ├── index.html                     # 메인 페이지
│   ├── style.css                      # 스타일 (160px 고정 메뉴)
│   ├── main.js                        # 초기화 & 제어 로직
│   ├── test.html                      # 테스트 페이지
│   ├── README.md                      # 프론트엔드 문서
│   └── js/renderers/
│       ├── map-renderer.js            # Three.js 렌더러 (1,368줄)
│       └── coordinate-transformer.js  # 좌표 변환
├── backend/                           # 백엔드 API
│   ├── map_api.py                     # Flask Blueprint (복사 가능)
│   └── db_manager.py                  # 데이터베이스 관리
├── database/                          # 데이터베이스
│   ├── schema.sql                     # 4개 테이블 스키마
│   ├── migrate_geojson.py             # GeoJSON 마이그레이션
│   └── db_manager.py                  # DB 매니저
├── docs/                              # 문서
│   └── INTEGRATION_GUIDE.md           # 상세 통합 가이드
└── data/ (선택사항)                   # 샘플 데이터
    └── geojson-files/
```

---

## 🚀 빠른 설치 (5분)

### 1️⃣ 파일 복사
```bash
cp -r map /path/to/your/project/
```

### 2️⃣ 데이터베이스 생성
```bash
sqlite3 your_database.db < map/database/schema.sql
```

### 3️⃣ 데이터 마이그레이션
```bash
python3 map/database/migrate_geojson.py
```

### 4️⃣ Flask 앱에 API 등록
```python
from map.backend.map_api import create_map_routes
db_manager = DatabaseManager('your_database.db')
app.register_blueprint(create_map_routes(db_manager))
```

### 5️⃣ HTML에 iframe 추가
```html
<iframe src="map/frontend/index.html" style="width:100%; height:100%; border:none;"></iframe>
```

✅ 완료! 이제 3D 지도가 작동합니다.

---

## 📊 데이터 통계

| 항목 | 수량 | 설명 |
|------|------|------|
| **해안선** | 2,816개 피처 | 5개 지역 (한중일 + 동아시아) |
| **섹터** | 14개 | 항공 통제 섹터 |
| **경유지점** | 309개 | 항로 지점 |
| **항로** | 101개 | 국제항로 |

---

## 🔧 필수 요구사항

### Python 패키지
```bash
pip install flask shapely numpy scipy pandas sqlite3
```

### 프론트엔드
- 모던 웹 브라우저 (WebGL 지원)
- Three.js r128 (CDN에서 자동 로드)

### 데이터
- GeoJSON 파일들 (`Tmp/airspace/data/`)
- SQLite 데이터베이스

---

## 📋 체크리스트

### 설치 전
- [ ] Python 3.8+ 설치
- [ ] 필수 패키지 설치
- [ ] GeoJSON 파일 준비

### 설치 중
- [ ] map 폴더 복사
- [ ] schema.sql 실행
- [ ] 데이터 마이그레이션
- [ ] Flask 앱에 API 등록

### 설치 후
- [ ] API 테스트 (curl)
- [ ] UI 로드 확인
- [ ] 3D 렌더링 확인
- [ ] 탭 네비게이션 작동 확인

---

## 🎯 핵심 기능

### 표시 기능
- ✅ 14개 섹터 (노란색 라인)
- ✅ 309개 경유지점 (주황색 구체 + 라벨)
- ✅ 2,816개 해안선 (테마별 색상)
- ✅ 101개 항로 (파란색 점선)

### 상호작용
- 🖱️ Ctrl + 좌클릭: 이동
- 🖱️ Ctrl + 우클릭: 회전
- 🖱️ 마우스 휠: 확대/축소
- 🎛️ 카메라 초기화/확대/축소 버튼
- 🌓 어두운/밝은 테마 전환

### API 엔드포인트
```
GET /api/map/geo/coastlines     → 해안선
GET /api/map/geo/sectors        → 섹터
GET /api/map/geo/fixpoints      → 경유지점
GET /api/map/geo/routes         → 항로
```

---

## 🎨 UI 구성

```
┌─────────────────────────────────────┐
│  헤더 (탭 네비게이션)                |
├────────────┬──────────────────────┤
│            │                      │
│  메뉴      │   3D 지도 캔버스     │
│  160px     │                      │
│            │                      │
└────────────┴──────────────────────┘
```

메뉴 너비: **고정 160px** (설정 가능)

---

## 💡 커스터마이징

### 메뉴 너비 변경
```css
/* map/frontend/style.css */
.control-panel {
    width: 200px;  /* 160px → 200px */
}
```

### 섹터 색상 변경
```javascript
// map/frontend/main.js
const material = new THREE.LineBasicMaterial({
    color: 0xff0000,  // 노란색 → 빨간색
});
```

### 해안선 색상 변경
```javascript
// 어두운 모드
if (this.currentTheme === 'dark') {
    coastlineColor = 0x00ff00;  // 초록색
}
```

### 카메라 초기 위치
```javascript
// map/frontend/js/renderers/coordinate-transformer.js
this.cameraDistance = 1500;  // 기본값: 1200
this.centerLat = 37.0;       // 기본값: 36.5
this.centerLon = 128.0;      // 기본값: 127.5
```

---

## 🔍 검증 방법

### 1. 데이터 확인
```bash
sqlite3 your_database.db "SELECT COUNT(*) FROM geo_coastlines;"  # 2816
sqlite3 your_database.db "SELECT COUNT(*) FROM geo_sectors;"     # 14
sqlite3 your_database.db "SELECT COUNT(*) FROM geo_fixpoints;"   # 309
sqlite3 your_database.db "SELECT COUNT(*) FROM geo_routes;"      # 101
```

### 2. API 테스트
```bash
curl http://localhost:7400/api/map/geo/coastlines | jq '.features | length'
curl http://localhost:7400/api/map/geo/fixpoints?limit=1 | jq '.features[0]'
```

### 3. UI 테스트
- 브라우저에서 3D 지도 탭 클릭
- 모든 요소 (섹터, 해안선, 지점, 항로) 표시 확인
- 테마 전환 (어두운/밝은 모드) 작동 확인

---

## 📝 파일 설명

### Backend
| 파일 | 크기 | 설명 |
|------|------|------|
| `map_api.py` | 227줄 | Flask Blueprint (복사 가능) |
| `db_manager.py` | 복사됨 | SQLite 관리자 |
| `migrate_geojson.py` | 복사됨 | GeoJSON → DB 마이그레이션 |

### Frontend
| 파일 | 크기 | 설명 |
|------|------|------|
| `index.html` | 113줄 | 메인 페이지 |
| `main.js` | 675줄 | 초기화 및 제어 로직 |
| `style.css` | 377줄 | 스타일시트 |
| `map-renderer.js` | 1,368줄 | Three.js 렌더러 |
| `coordinate-transformer.js` | 107줄 | 좌표 변환 |

### Database
| 파일 | 설명 |
|------|------|
| `schema.sql` | geo_coastlines, geo_sectors, geo_fixpoints, geo_routes |
| `migrate_geojson.py` | GeoJSON/CSV → SQLite |

---

## 🚨 일반적인 문제

### ❌ "No module named 'shapely'"
```bash
pip install shapely numpy scipy pandas
```

### ❌ "API 404 Not Found"
```python
# Flask 앱에 Blueprint 등록 확인
app.register_blueprint(create_map_routes(db_manager))
```

### ❌ "3D 렌더링 안 됨"
- WebGL 지원 확인
- Three.js CDN 로드 확인
- 브라우저 콘솔 확인

### ❌ "iframe 로드 안 됨"
- CORS 설정 확인
- 상대 경로 확인
- 파일 경로 확인

---

## 📈 성능

| 항목 | 값 |
|------|-----|
| 초기 로딩 시간 | ~2초 |
| 메모리 사용량 | ~50MB |
| 네트워크 데이터 | ~2MB |
| 프레임레이트 | 60 FPS |

---

## 📞 지원

이 패키지는 독립적으로 사용 가능하도록 설계되었습니다.

문제 발생 시 확인 사항:
1. Python 패키지 설치 상태
2. 데이터베이스 연결
3. API 엔드포인트 등록
4. 프론트엔드 파일 경로
5. 브라우저 콘솔 오류 메시지

---

## ✅ 설치 완료 후

```
축하합니다! 🎉

당신의 프로젝트에 3D 지도가 완성되었습니다.
- ✅ 309개 경유지점
- ✅ 14개 항공 섹터
- ✅ 101개 국제항로
- ✅ 2,816개 해안선 피처

더 자세한 내용은 docs/INTEGRATION_GUIDE.md를 참조하세요.
```

---

**Happy Mapping! 🗺️🚀**
