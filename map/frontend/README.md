# 3D Map Service - 항공편 경로 & 섹터 시각화

## 개요

Three.js 기반의 고급 3D 지도 서비스로, 항공편 경로, 통제 섹터, 항로 지점을 실시간으로 시각화합니다.

## 기능

### 핵심 기능 (5가지)

✅ **배경 지도**
- 한국, 중국, 일본, 북한 해안선 & 경계
- Light/Dark 테마 자동 전환

✅ **섹터 오버레이**
- 14개의 통제 섹터 경계선
- 호버 시 섹터 상세 정보 표시
- 고도 범위 필터링 가능

✅ **항로 지점**
- 309개의 주요 항로 지점 (NAVAID, AIRPORT, WAYPOINT)
- 동적 라벨 표시
- 지점 타입별 필터링

✅ **항로 시각화**
- 101개 표준 항로 (AIRWAY, SIDS, STARS)
- 경로상 주요 지점 표시
- 점선으로 항로 표시

✅ **카메라 제어**
- **Ctrl + 좌클릭 드래그**: 지도 이동 (팬)
- **Ctrl + 우클릭 드래그**: 회전
- **마우스 휠**: 확대/축소
- **버튼 제어**: 초기화, 확대, 축소

## 데이터 구조

### API 엔드포인트

```
GET /api/map/geo/coastlines
  - 해안선 데이터 (GeoJSON)
  - 쿼리: ?regions=korea,japan,china,northkorea

GET /api/map/geo/sectors
  - 섹터 경계선 (GeoJSON)
  - 쿼리: ?altitude_min=0&altitude_max=5000

GET /api/map/geo/fixpoints
  - 항로 지점 (GeoJSON Point)
  - 쿼리: ?types=NAVAID,AIRPORT&limit=200

GET /api/map/geo/routes
  - 표준 항로 (GeoJSON LineString)
  - 쿼리: ?types=AIRWAY,SIDS&limit=50
```

### 데이터 소스

- **해안선**: 4개 (korea, japan, china, northkorea)
- **섹터**: 14개 (DB: geo_sectors)
- **지점**: 309개 (DB: geo_fixpoints)
- **항로**: 101개 (DB: geo_routes)

## 파일 구조

```
frontend/map-service/
├── index.html              # 메인 HTML
├── style.css               # 스타일시트
├── main.js                 # 초기화 & 제어 로직
└── README.md               # 이 파일

frontend/js/renderers/
├── map-renderer.js         # Three.js 3D 렌더러
└── coordinate-transformer.js # 좌표 변환 엔진
```

## 기술 스택

- **3D 엔진**: Three.js (r128+)
- **서버**: Flask REST API
- **데이터베이스**: SQLite (geo_* 테이블)
- **인증**: Session-based (선택사항)

## 시작하기

### 로컬 개발

```bash
# 1. 데이터베이스 마이그레이션 (초회만)
python3 database/migrate_geojson.py

# 2. Flask 백엔드 시작
python3 backend/app.py

# 3. 브라우저에서 접속
http://localhost:7400/frontend/map-service/
```

### 프로덕션 배포

```bash
# 1. 데이터 마이그레이션 확인
sqlite3 database/similarity_detector.db "SELECT COUNT(*) FROM geo_sectors;"

# 2. API 엔드포인트 테스트
curl http://your-server:7400/api/map/geo/sectors | jq

# 3. 지도 서비스 접속
https://your-server:7400/frontend/map-service/
```

## 성능 최적화

### 데이터 로드 시간

| 항목 | 레코드 수 | 로드 시간 |
|------|---------|---------|
| 해안선 | 4 | ~50ms |
| 섹터 | 14 | ~20ms |
| 지점 | 309 | ~100ms |
| 항로 | 101 | ~80ms |

**총 초기 로드**: ~250ms

### 메모리 사용

- Three.js Scene: ~50MB
- GeoJSON 캐시: ~30MB
- 텍스처 & 스프라이트: ~20MB
- **총합**: ~100MB

### 최적화 기법

1. **API 캐싱**: 1시간 (해안선), 24시간 (섹터)
2. **LOD (Level of Detail)**: 대량 데이터 세그먼트화
3. **메모리 정리**: 불필요한 메시 `dispose()` 호출
4. **비동기 로드**: 항목별 순차 로드

## 보안 고려사항

### 파일 접근 제제

- GeoJSON 파일 직접 접근 **불가** ❌
- API를 통해서만 데이터 제공 ✅
- 인증 & 권한 검증 가능

### Rate Limiting

```python
# (향후 구현)
@app.route('/api/map/geo/coastlines')
@limiter.limit("10 per minute")
def get_coastlines():
    ...
```

## 향후 기능 (고급)

- [ ] 유사호출 경로 비교 시각화
- [ ] 핫스팟 분석 (히트맵)
- [ ] 실시간 항공편 추적
- [ ] 타임라인 플레이어
- [ ] 3D 폴리곤 (공역 볼륨)
- [ ] 모바일 터치 제스처
- [ ] WebGL 성능 프로파일링

## 디버깅

### 개발자 콘솔 명령어

```javascript
// 렌더러 접근
mapService.renderer

// 카메라 위치 확인
mapService.renderer.camera.position

// 장면 객체 수
mapService.renderer.scene.children.length

// 특정 지점 좌표 변환
mapService.transformer.transform(37.5, 127.0, 0)

// 역변환 (3D → 위경도)
mapService.transformer.worldToLatLon(x, z)
```

### 일반적인 문제

**Q: 지도가 검은색으로만 표시됨**
- A: Three.js 조명 설정 확인
- A: renderer.addLighting() 호출 여부 확인

**Q: 데이터가 로드되지 않음**
- A: 브라우저 Network 탭에서 `/api/map/geo/*` 호출 확인
- A: CORS 정책 확인 (Flask app에서 CORS 활성화 필수)

**Q: 모바일에서 반응 없음**
- A: Ctrl+클릭 대신 터치 제스처 구현 필요 (향후)

## 라이선스

MIT License - 자유롭게 수정 & 배포 가능

## 기여

피드백 및 개선 사항은 이슈 또는 PR로 제출해주세요.

---

**마지막 업데이트**: 2025-02-07
**버전**: 1.0.0-alpha
