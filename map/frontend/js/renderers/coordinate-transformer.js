/**
 * 좌표 변환 유틸리티 (3D 렌더링용)
 * 위경도 → 3D 좌표 (Three.js)
 */

class CoordinateTransformer {
  constructor(options = {}) {
    // 한국 중심 좌표
    this.centerLat = options.centerLat || 37.5;
    this.centerLon = options.centerLon || 127.0;

    // 스케일 (화면 픽셀당 실제 거리)
    this.scale = options.scale || 1.0;

    // 투영 타입
    this.projection = options.projection || 'mercator'; // 'simple', 'mercator'

    // 고도 스케일
    this.altitudeScale = options.altitudeScale || 5; // 고도 스케일 (사용자 요청: 5 - 약 16배 과장)

    // 기준점 (0,0) 화면 중심
    this.offsetX = options.offsetX || 0;
    this.offsetY = options.offsetY || 0;
    this.offsetZ = options.offsetZ || 0;
  }

  /**
   * 간단한 좌표 변환 (직선 투영)
   * 가장 빠르고 정확도는 중정도
   */
  transformSimple(latitude, longitude, altitude = 0) {
    // 중심점으로부터의 차이 계산
    const dLat = latitude - this.centerLat;
    const dLon = longitude - this.centerLon;

    // 거리 계산 (대략 1도 ≈ 111km)
    const kmPerDegree = 111.0;
    const x = -dLat * kmPerDegree * this.scale;  // X축: 위도 (남북) - 음수로 반전
    const z = -dLon * kmPerDegree * this.scale;  // Z축: 경도 (동서) - 좌우 반전
    const y = altitude * this.altitudeScale / 1000; // 고도를 미터에서 km로

    return {
      x: x + this.offsetX,
      y: y + this.offsetY,
      z: z + this.offsetZ
    };
  }

  /**
   * 3D 좌표 -> 위경도 변환 (역변환)
   */
  worldToLatLon(x, z) {
    const kmPerDegree = 111.0;

    // transformSimple의 역연산
    // x = -dLat * kmPerDegree * scale + offsetX
    // dLat = -(x - offsetX) / (kmPerDegree * scale)

    const dLat = -(x - this.offsetX) / (kmPerDegree * this.scale);
    const dLon = -(z - this.offsetZ) / (kmPerDegree * this.scale);

    return {
      latitude: this.centerLat + dLat,
      longitude: this.centerLon + dLon
    };
  }

  /**
   * Mercator 투영
   * 더 정확한 지도 투영
   */
  transformMercator(latitude, longitude, altitude = 0) {
    // Mercator 투영 공식
    const R = 6371000; // 지구 반지름 (미터)

    // 라디안으로 변환 (극 근처 좌표 제한)
    const clampedLat = Math.max(-89.9, Math.min(89.9, latitude)); // ±89.9도로 제한
    const clampedCenterLat = Math.max(-89.9, Math.min(89.9, this.centerLat));

    const lat = clampedLat * (Math.PI / 180);
    const lon = longitude * (Math.PI / 180);
    const centerLat = clampedCenterLat * (Math.PI / 180);
    const centerLon = this.centerLon * (Math.PI / 180);

    // Mercator 좌표 (X축: 위도(남북), Z축: 경도(동서))
    const tanTerm = Math.tan(Math.PI / 4 + lat / 2);
    const tanCenterTerm = Math.tan(Math.PI / 4 + centerLat / 2);

    // 무한대/NaN 방지
    if (!isFinite(tanTerm) || !isFinite(tanCenterTerm)) {
      // Mercator 투영 실패 시 Simple 투영으로 폴백
      return this.transformSimple(latitude, longitude, altitude);
    }

    const x = -R * Math.log(tanTerm) * this.scale / 1000;  // X축: 위도 - 음수로 반전
    const xCenter = -R * Math.log(tanCenterTerm) * this.scale / 1000;
    const z = -R * (lon - centerLon) * this.scale / 1000; // Z축: 경도 - 좌우 반전 (km 단위)

    const y = altitude * this.altitudeScale / 1000;

    // 최종 결과도 확인
    const result = {
      x: (x - xCenter) + this.offsetX,
      y: y + this.offsetY,
      z: z + this.offsetZ
    };

    if (!isFinite(result.x) || !isFinite(result.y) || !isFinite(result.z)) {
      // 결과가 무한대면 Simple 투영으로 폴백
      return this.transformSimple(clampedLat, longitude, altitude);
    }

    return result;
  }

  /**
   * 주요 변환 메서드
   */
  transform(latitude, longitude, altitude = 0) {
    // 입력 값 검증 - 유효하지 않은 좌표는 중심점으로 매핑
    if (isNaN(latitude) || isNaN(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      // 유효하지 않은 좌표 - 중심점 반환
      return {
        x: this.offsetX,
        y: (altitude * this.altitudeScale / 1000) + this.offsetY,
        z: this.offsetZ
      };
    }

    let result;
    if (this.projection === 'mercator') {
      result = this.transformMercator(latitude, longitude, altitude);
    } else {
      result = this.transformSimple(latitude, longitude, altitude);
    }

    // 결과 값 검증 - NaN 확인
    if (isNaN(result.x) || isNaN(result.y) || isNaN(result.z)) {
      console.warn(`⚠️ 좌표 변환 오류 (${latitude}, ${longitude}): `, result);
      // NaN 값 반환하지 말고 중심점 반환
      return {
        x: this.offsetX,
        y: (altitude * this.altitudeScale / 1000) + this.offsetY,
        z: this.offsetZ
      };
    }

    return result;
  }

  /**
   * 여러 좌표 변환 (배열)
   */
  transformArray(coordinates) {
    return coordinates.map((coord) => {
      return this.transform(coord.latitude, coord.longitude, coord.altitude || 0);
    });
  }

  /**
   * 역변환 (3D 좌표 → 위경도) - 아직 구현 안 함
   */
  transformInverse(x, y, z) {
    // TODO: 역변환 구현
    return {
      latitude: 0,
      longitude: 0,
      altitude: 0
    };
  }

  /**
   * 월드 좌표(x,z)를 위경도로 변환
   */
  worldToLatLon(worldX, worldZ) {
    const x = worldX - this.offsetX;
    const z = worldZ - this.offsetZ;
    const kmPerDegree = 111.0;

    if (this.projection === 'mercator') {
      const R = 6371000;
      const centerLatRad = this.centerLat * (Math.PI / 180);
      const xCenter = -R * Math.log(Math.tan(Math.PI / 4 + centerLatRad / 2)) * this.scale / 1000;

      const xValue = (worldX - this.offsetX) + xCenter;
      const xMeters = xValue * 1000 / this.scale;
      const latRad = 2 * Math.atan(Math.exp(-xMeters / R)) - Math.PI / 2;
      const lat = latRad * (180 / Math.PI);

      const zValue = worldZ - this.offsetZ;
      const lon = this.centerLon - (zValue * 1000) / (R * this.scale) * (180 / Math.PI);
      return { latitude: lat, longitude: lon };
    }

    const lon = this.centerLon - z / (kmPerDegree * this.scale);
    const lat = this.centerLat - x / (kmPerDegree * this.scale);
    return { latitude: lat, longitude: lon };
  }

  /**
   * 두 폴리곤이 교차하는지 확인 (2D 평면, X-Z 좌표)
   * coordinates1, coordinates2: [{ latitude, longitude }, ...]
   */
  polygonsIntersect(coordinates1, coordinates2) {
    if (!coordinates1 || !coordinates2 || coordinates1.length < 3 || coordinates2.length < 3) {
      return false;
    }

    // 세계 좌표로 변환
    const polygon1 = coordinates1.map(c => this.transform(c.latitude, c.longitude, 0));
    const polygon2 = coordinates2.map(c => this.transform(c.latitude, c.longitude, 0));

    // 2D 좌표 (X, Z만 사용)
    const p1 = polygon1.map(p => ({ x: p.x, y: p.z }));
    const p2 = polygon2.map(p => ({ x: p.x, y: p.z }));

    // 1. AABB (Axis-Aligned Bounding Box) 빠른 검사
    const bbox1 = this.getPolygonBBox(p1);
    const bbox2 = this.getPolygonBBox(p2);

    if (!this.bboxIntersect(bbox1, bbox2)) {
      return false;
    }

    // 2. 세부 교차 검사 (SAT - Separating Axis Theorem)
    return this.satIntersect(p1, p2);
  }

  /**
   * 폴리곤의 바운딩 박스 계산
   */
  getPolygonBBox(polygon) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const point of polygon) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }

    return { minX, maxX, minY, maxY };
  }

  /**
   * 두 바운딩 박스가 교차하는지 확인
   */
  bboxIntersect(bbox1, bbox2) {
    return !(bbox1.maxX < bbox2.minX || bbox1.minX > bbox2.maxX ||
      bbox1.maxY < bbox2.minY || bbox1.minY > bbox2.maxY);
  }

  /**
   * SAT (Separating Axis Theorem)를 사용한 폴리곤 교차 검사
   */
  satIntersect(polygon1, polygon2) {
    const polygons = [polygon1, polygon2];

    for (const polygon of polygons) {
      for (let i = 0; i < polygon.length; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];

        // 변에 수직인 축 계산
        const edge = { x: p2.x - p1.x, y: p2.y - p1.y };
        const axis = { x: -edge.y, y: edge.x };
        const axisLen = Math.sqrt(axis.x * axis.x + axis.y * axis.y);
        if (axisLen === 0) continue;

        const normalAxis = { x: axis.x / axisLen, y: axis.y / axisLen };

        // 두 폴리곤을 축에 투영
        const proj1 = this.projectPolygon(polygon1, normalAxis);
        const proj2 = this.projectPolygon(polygon2, normalAxis);

        // 투영이 겹치지 않으면 교차하지 않음
        if (proj1.max < proj2.min || proj2.max < proj1.min) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 폴리곤을 축에 투영
   */
  projectPolygon(polygon, axis) {
    let min = polygon[0].x * axis.x + polygon[0].y * axis.y;
    let max = min;

    for (let i = 1; i < polygon.length; i++) {
      const projection = polygon[i].x * axis.x + polygon[i].y * axis.y;
      if (projection < min) min = projection;
      if (projection > max) max = projection;
    }

    return { min, max };
  }

  /**
   * 카메라 위치 설정 (한중일 전체 보기 - 사용자 요청 뷰)
   */
  getCameraPosition() {
    // 한중일 지역 전체를 볼 수 있는 높은 위치
    // 이미지를 보면 한반도와 일본 사이가 중심이고, 꽤 높이서 보고 있음
    return {
      x: this.offsetX + 50 + 0.001, // 타겟(x+50)과 거의 동일하지만, 짐벌 락 방지 및 북쪽(North)을 위로 하기 위한 미세 오프셋
      y: 1750,                 // 높이 (사용자 요청)
      z: this.offsetZ - 150    // 타겟(z-150)과 동일한 경도 (회전 없음)
    };
  }

  /**
   * 카메라 타겟 (회전 중심점)
   */
  getCameraTarget() {
    // 한반도와 일본 사이 (대한해협 근처)
    return {
      x: this.offsetX + 50,    // 위도 35~36도 근처
      y: 0,                    // 지면
      z: this.offsetZ - 150    // 경도 129~130도 근처 (동쪽은 음수)
    };
  }
}

/**
 * 글로벌 좌표 변환기 생성
 */
let globalTransformer = null;

function initializeCoordinateTransformer(options = {}) {
  // 한반도 범위: 위도 7° (33°~43°), 경도 7° (124°~131°)
  // 1° ≈ 111km이므로, 7° ≈ 777km
  // 맵 평면이 400x400이므로, scale = 400/777 ≈ 0.515
  globalTransformer = new CoordinateTransformer({
    centerLat: 37.5,
    centerLon: 127.0,
    scale: 0.515,  // 맵 평면 400x400에 맞춤
    altitudeScale: 1500,  // 고도 스케일 대幅 증가 (300 → 1500): 고도 차이를 입체적으로 더 명확하게 표시
    projection: 'simple',  // 간단한 선형 변환 사용
    ...options
  });

  console.log('✅ 좌표 변환기 초기화됨 (scale: 0.515, projection: simple, altitudeScale: 1500)');
  return globalTransformer;
}

function getCoordinateTransformer() {
  if (!globalTransformer) {
    globalTransformer = new CoordinateTransformer();
  }
  return globalTransformer;
}

/**
 * 테스트용: 샘플 좌표 변환
 */
function testCoordinateTransformation() {
  const transformer = getCoordinateTransformer();

  const testCoords = [
    { latitude: 37.5, longitude: 127.0, altitude: 0, name: '중심' },
    { latitude: 35.756111, longitude: 127.614444, altitude: 0, name: 'Kwan0' },
    { latitude: 37.5, longitude: 127.5, altitude: 0, name: '우측' },
    { latitude: 38.0, longitude: 127.0, altitude: 0, name: '북쪽' }
  ];

  console.group('📐 좌표 변환 테스트');
  testCoords.forEach((coord) => {
    const transformed = transformer.transform(coord.latitude, coord.longitude, coord.altitude);
    console.log(`${coord.name}:`, {
      input: { lat: coord.latitude.toFixed(2), lon: coord.longitude.toFixed(2) },
      output: {
        x: transformed.x.toFixed(2),
        y: transformed.y.toFixed(2),
        z: transformed.z.toFixed(2)
      }
    });
  });
  console.groupEnd();
}

/**
 * 내보내기
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CoordinateTransformer,
    initializeCoordinateTransformer,
    getCoordinateTransformer,
    testCoordinateTransformation
  };
}

// 브라우저 환경에서 전역 할당
if (typeof window !== 'undefined') {
  window.CoordinateTransformer = CoordinateTransformer;
  window.initializeCoordinateTransformer = initializeCoordinateTransformer;
  window.getCoordinateTransformer = getCoordinateTransformer;
  window.testCoordinateTransformation = testCoordinateTransformation;
}
