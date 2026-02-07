/**
 * 맵 렌더러 - Three.js 3D 지도 렌더링
 */

class MapRenderer {
  constructor(containerSelector, options = {}) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.error('❌ 컨테이너를 찾을 수 없습니다:', containerSelector);
      return;
    }

    // 테마 설정 (dark 또는 light)
    this.theme = options.theme || 'dark'; // 기본값: dark

    // Three.js 기본 설정
    this.width = this.container.clientWidth || 800;
    this.height = this.container.clientHeight || 600;

    // 카메라
    this.camera = new THREE.PerspectiveCamera(75, this.width / this.height, 0.1, 10000);

    // 장면
    this.scene = new THREE.Scene();
    // 테마에 따른 배경색 설정
    const bgColor = this.theme === 'light' ? 0xf5f5f5 : 0x1a1a2e;
    this.scene.background = new THREE.Color(bgColor);

    // 렌더러
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.container.appendChild(this.renderer.domElement);

    // 좌표 변환기
    this.transformer = getCoordinateTransformer();

    // 폴리곤 저장소
    this.polygons = new Map(); // volumeCode → polygon
    this.meshes = []; // 모든 메시
    this.centerChangeCallbacks = [];

    // 섹터 저장소
    this.sectorLines = []; // 모든 섹터 라인
    this.sectorData = new Map(); // 섹터 좌표 데이터 (sectorId → [points])
    this.sectorsVisible = true; // 섹터 표시 여부

    // 평면/구 렌더링 모드
    this.planeGroup = new THREE.Group(); // 평면 지도 (PlaneGeometry)
    this.sphereGroup = new THREE.Group(); // 구 지도 (SphereGeometry)
    this.scene.add(this.planeGroup);
    this.scene.add(this.sphereGroup);

    this.globeMode = localStorage.getItem('globeMode') === 'true' || false; // 지구 모드 (기본값: false - 평면)
    this.updateGlobeModeVisibility(); // 초기 표시 상태 설정

    // 카메라 초기 위치 (위: 북쪽, 아래: 남쪽, 좌: 동쪽, 우: 서쪽)
    const camPos = this.transformer.getCameraPosition();
    const target = this.transformer.getCameraTarget();

    this.cameraTarget = new THREE.Vector3(target.x, target.y, target.z);

    // CoordinateTransformer에서 정의한 위치 그대로 사용
    this.camera.position.set(camPos.x, camPos.y, camPos.z);
    this.camera.lookAt(target.x, target.y, target.z);

    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // 지도 배경 추가 (API 방식으로 main.js에서 처리)
    // this.addMapBackground();

    // FIR 경계선 추가 (사용자 요청) - 기존 섹터 라인과 겹쳐서 제거
    // this.addFIRBoundaries();

    // 조명 설정
    this.addLighting();

    // 이벤트 리스너
    this.setupEventListeners();

    // 테마 변경 이벤트 리스너
    window.addEventListener('themeChanged', (e) => {
      this.setTheme(e.detail.theme);
    });

    // 카메라 제어 (드래그, 확대/축소)
    this.setupCameraControls();

    // 애니메이션 루프
    this.animate();

    console.log('✅ MapRenderer 초기화됨');
  }

  /**
   * 테마 변경 적용
   */
  setTheme(theme) {
    this.theme = theme;

    // 배경색 변경
    const bgColor = this.theme === 'light' ? 0xf5f5f5 : 0x1a1a2e;
    this.scene.background = new THREE.Color(bgColor);

    // 해안선 및 경계선 색상 설정
    let lineColor;
    if (this.theme === 'light') {
      lineColor = 0x505050; // 라이트 모드: 어두운 회색
    } else {
      lineColor = 0xcccccc; // 다크 모드: 밝은 회색
    }

    // 평면 그룹의 모든 라인 색상 업데이트
    this.planeGroup.children.forEach(child => {
      if (child.userData.isMapLine && child.material) {
        child.material.color.setHex(lineColor);
      }
    });

    // 구 그룹의 모든 라인 색상 업데이트
    this.sphereGroup.children.forEach(child => {
      if (child.userData.isMapLine && child.material) {
        child.material.color.setHex(lineColor);
      }
    });

    // 섹터 라인 색상 업데이트
    const sectorColor = this.theme === 'light' ? 0xcc5500 : 0xffaa00;
    this.sectorLines.forEach(line => {
      if (line.material) {
        line.material.color.setHex(sectorColor);
      }
    });

    console.log(`🎨 MapRenderer 테마 변경됨: ${theme}`);
  }

  /**
   * 해안선 제거 (색상 변경을 위해 재렌더링 전에 호출)
   */
  clearCoastlines() {
    // planeGroup에서 isMapLine 태그된 객체 제거 (해안선)
    for (let i = this.planeGroup.children.length - 1; i >= 0; i--) {
      const child = this.planeGroup.children[i];
      if (child.userData.isMapLine) {
        this.planeGroup.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      }
    }

    // sphereGroup에서도 제거
    for (let i = this.sphereGroup.children.length - 1; i >= 0; i--) {
      const child = this.sphereGroup.children[i];
      if (child.userData.isMapLine) {
        this.sphereGroup.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      }
    }

    console.log('🧹 해안선 제거 완료');
  }

  /**
   * 한중일 지도 + Sector 렌더링
   */
  addMapBackground() {
    // 한중일 GeoJSON과 Sector 데이터를 동시에 로드
    Promise.all([
      fetch('/data/korea-provinces.geojson').then(r => r.json()),
      fetch('/data/northkorea-provinces.geojson').then(r => r.json()),
      fetch('/data/china-provinces.geojson').then(r => r.json()),
      fetch('/data/japan-prefectures.geojson').then(r => r.json()),
      fetch('/data/japan-coastline.geojson').then(r => r.json()),
      fetch('/data/sector.csv').then(r => r.text())  // Sector 데이터
    ])
      .then(([koreaGeo, northkoreaProvinces, chinaGeo, japanGeo, japanCoastline, sectorCsv]) => {
        // 테마에 따른 색상 설정 (모든 해안선/경계선 통일)
        let colors;
        if (this.theme === 'light') {
          // 라이트 모드: 어두운 회색 (0x505050)
          const darkGray = 0x505050;
          colors = {
            korea: darkGray,
            coastlineNK: darkGray,
            china: darkGray,
            japan: darkGray,
            coastlineJP: darkGray
          };
        } else {
          // 다크 모드: 밝은 회색 (0xcccccc)
          const lightGray = 0xcccccc;
          colors = {
            korea: lightGray,
            coastlineNK: lightGray,
            china: lightGray,
            japan: lightGray,
            coastlineJP: lightGray
          };
        }

        // 1. 국가 경계선 렌더링
        this.renderGeoJSONAsLines(koreaGeo, colors.korea);
        this.renderGeoJSONAsLines(northkoreaProvinces, colors.coastlineNK);
        this.renderGeoJSONAsLines(chinaGeo, colors.china);
        this.renderGeoJSONAsLines(japanGeo, colors.japan);
        this.renderGeoJSONAsLines(japanCoastline, colors.coastlineJP);

        // 2. Sector 경계선 렌더링
        this.renderSectorBoundaries(sectorCsv);

        console.log(`✅ 한중일 + 해안선 지도 로드 완료 (${this.theme} 모드)`);
      })
      .catch(error => {
        console.warn('⚠️ 지도 로드 실패:', error);
      });
  }



  /**
   * FIR 경계선 추가 (인천 FIR 및 인접국 경계)
   */
  addFIRBoundaries() {
    // 인천 FIR (RKRR) 대략적인 경계 좌표
    // 정확한 데이터가 없으므로 주요 변곡점을 근사치로 설정
    const firCoords = [
      { lat: 37.0, lon: 124.0 }, // 서해 북부 (한중 잠정조치수역 인근)
      { lat: 34.0, lon: 124.0 }, // 서해 중부
      { lat: 32.0, lon: 124.0 }, // 서해 남부 (상하이 FIR 경계 시작)
      { lat: 30.0, lon: 124.0 }, // 제주 남서방 (아카라 회랑 서단)
      { lat: 30.0, lon: 128.0 }, // 제주 남동방 (아카라 회랑 동단)
      { lat: 31.0, lon: 128.5 }, // 남해 먼바다
      { lat: 32.5, lon: 129.0 }, // 큐슈 서방 (후쿠오카 FIR 경계)
      { lat: 34.0, lon: 129.5 }, // 대마도 인근
      { lat: 35.0, lon: 130.0 }, // 부산 남동방
      { lat: 36.0, lon: 131.0 }, // 동해 남부
      { lat: 37.0, lon: 132.0 }, // 독도 인근
      { lat: 38.0, lon: 133.0 }, // 동해 중부
      { lat: 38.6, lon: 133.0 }, // 동해 북부 (북한 FIR 경계)
      // 북쪽 경계는 휴전선 및 NLL 인근이나 복잡하므로 생략하거나 단순화
      { lat: 38.6, lon: 128.3 }, // 고성 인근
      { lat: 37.8, lon: 126.6 }, // 판문점 인근
      { lat: 37.8, lon: 125.5 }, // NLL 인근
      { lat: 37.0, lon: 124.0 }  // 시작점 연결
    ];

    const points = firCoords.map(c => {
      const p = this.transformer.transform(c.lat, c.lon, 0);
      return new THREE.Vector3(p.x, 0.6, p.z); // 지도(0.5)보다 살짝 위에 표시
    });

    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    // FIR 경계선 재질 (노란색 점선)
    const material = new THREE.LineDashedMaterial({
      color: 0xFFFF00, // 노란색
      dashSize: 5,
      gapSize: 3,
      linewidth: 2
    });

    const line = new THREE.Line(geometry, material);
    line.computeLineDistances(); // 점선 계산을 위해 필수

    line.userData = { type: 'FIR_BOUNDARY' };
    this.scene.add(line);

    console.log('✅ 인천 FIR 경계선 추가됨');
  }

  /**
   * Sector CSV 데이터를 Three.js Line으로 렌더링 (단색)
   */
  renderSectorBoundaries(csvData) {
    const lines = csvData.trim().split('\n');
    if (lines.length < 2) return;

    // CSV 파싱
    const headers = lines[0].split(',');
    const sectorMap = new Map();

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const sector = {
        id: values[0],
        seq: parseInt(values[1]),
        lat: parseFloat(values[2]),
        lon: parseFloat(values[3]),
        effective_dt: values[4],
        alt_start: parseInt(values[5]),
        alt_end: parseInt(values[6])
      };

      if (!sectorMap.has(sector.id)) {
        sectorMap.set(sector.id, []);
      }
      sectorMap.get(sector.id).push(sector);
    }

    // 테마에 따른 섹터 색상 설정 (단색)
    const sectorColor = this.theme === 'light' ? 0xcc5500 : 0xffaa00; // 라이트: 어두운 주황, 다크: 밝은 주황

    for (const [sectorId, points] of sectorMap) {
      // 시퀀스 순서로 정렬
      points.sort((a, b) => a.seq - b.seq);

      // 섹터 좌표 데이터 저장 (편집 팝업에서 사용)
      this.sectorData.set(sectorId, points);

      // 좌표 변환
      const linePoints = points.map(p => {
        const transformed = this.transformer.transform(p.lat, p.lon, 0);
        // 고도 표시 제거: 지면(0.5)에 고정 (사용자 요청: 공중에 떠있는 다각형 제거)
        const altitude = 0.5;
        return new THREE.Vector3(transformed.x, altitude, transformed.z);
      });

      // 폐곡선 만들기 (마지막 점을 첫 번째 점과 연결)
      if (linePoints.length > 2 &&
        !linePoints[0].equals(linePoints[linePoints.length - 1])) {
        linePoints.push(linePoints[0]);
      }

      if (linePoints.length > 1) {
        const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
        const material = new THREE.LineBasicMaterial({
          color: sectorColor,
          linewidth: 3,
          depthTest: true,
          transparent: true,
          opacity: 0.9
        });
        const line = new THREE.Line(geometry, material);
        line.userData.isSectorLine = true; // 섹터 라인 마크
        this.scene.add(line);
        this.sectorLines.push(line); // 섹터 라인 저장
      }
    }

    console.log(`✅ Sector 경계선 렌더링 완료 (${sectorMap.size}개 섹터, 단색: ${sectorColor.toString(16)})`);
  }

  /**
   * GeoJSON을 Three.js Line으로 렌더링 (FeatureCollection 또는 단일 Feature)
   */
  renderGeoJSONAsLines(geojson, color = 0xd4e6f1) {
    if (!geojson) return;

    let lineCount = 0;
    let features = [];

    // FeatureCollection 또는 단일 Feature 처리
    if (geojson.features) {
      features = geojson.features;
    } else if (geojson.geometry) {
      // 단일 Feature (northkorea.geojson 같은 경우)
      features = [geojson];
    }

    for (const feature of features) {
      const geometry = feature.geometry;

      if (geometry.type === 'MultiPolygon') {
        // MultiPolygon 처리
        for (const polygon of geometry.coordinates) {
          // 가장 바깥쪽 ring만 사용 (경계선)
          const ring = polygon[0];
          this.drawGeoJSONRing(ring, color);
          lineCount++;
        }
      } else if (geometry.type === 'Polygon') {
        // Polygon 처리 - 가장 바깥쪽 ring만 사용
        const ring = geometry.coordinates[0];
        this.drawGeoJSONRing(ring, color);
        lineCount++;
      }
    }

    console.log(`📍 ${color.toString(16)}: ${lineCount}개 경계선 렌더링 완료`);
  }

  /**
   * GeoJSON ring을 Three.js Line으로 렌더링 (평면/구 동시 지원)
   * 평면과 구 기하학을 모두 생성하고 각각의 그룹에 추가
   */
  drawGeoJSONRing(ring, color) {
    if (!ring || ring.length < 2) {
      console.warn('⚠️ Ring 데이터 없음');
      return;
    }

    // 좌표를 3D 좌표로 변환 (NaN 검증 추가)
    const points = ring
      .map(([lon, lat]) => {
        const transformed = this.transformer.transform(lat, lon, 0);
        // NaN 검증 - 유효한 좌표만 포함
        if (isNaN(transformed.x) || isNaN(transformed.z)) {
          return null;
        }
        return new THREE.Vector3(transformed.x, 0.5, transformed.z);  // y=0.5에 렌더링
      })
      .filter(p => p !== null);

    console.log(`📍 Ring처리: ${ring.length} 점 → ${points.length} 점 필터링됨`);

    if (points.length > 1) {
      // 1. 평면 버전 (원래대로)
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: color,
        linewidth: 2,
        depthTest: true
      });
      const line = new THREE.Line(lineGeometry, material);
      line.userData.isMapLine = true; // 테마 토글 시 제거하기 위한 마크
      this.planeGroup.add(line);

      // 2. 구 버전 (지구 표면에 투영)
      // 구의 반지름 설정 (평면의 크기와 맞춤)
      const sphereRadius = 200; // 적절한 반지름 선택

      // 구 표면에 점들을 투영
      const spherePoints = points.map(point => {
        // 평면 좌표의 거리(반지름)를 기반으로 구의 각도를 계산
        const distFromOrigin = Math.sqrt(point.x * point.x + point.z * point.z);
        const angle = distFromOrigin / 100; // 거리를 각도로 변환 (스케일 조정)

        // 구의 표면 좌표 계산
        const azimuth = Math.atan2(point.z, point.x);
        const sphereX = sphereRadius * Math.cos(azimuth) * Math.sin(angle);
        const sphereY = sphereRadius * Math.cos(angle);
        const sphereZ = sphereRadius * Math.sin(azimuth) * Math.sin(angle);

        return new THREE.Vector3(sphereX, sphereY, sphereZ);
      });

      const sphereLineGeometry = new THREE.BufferGeometry().setFromPoints(spherePoints);
      const sphereLine = new THREE.Line(sphereLineGeometry, material.clone());
      sphereLine.userData.isMapLine = true;
      this.sphereGroup.add(sphereLine);
    }
  }


  /**
   * 커스텀 카메라 제어 (마우스 드래그 + 휠)
   * Ctrl + 좌클릭 드래그: 팬(이동, 수평 이동)
   * Ctrl + 우클릭 드래그: 회전
   * 스크롤: 확대/축소
   * 주의: Ctrl 키 없이는 드래그로 아무것도 할 수 없음 (클릭만 가능)
   */
  setupCameraControls() {
    const target = this.transformer.getCameraTarget();
    this.cameraTarget = new THREE.Vector3(target.x, target.y, target.z);

    let isDragging = false;
    let isCtrlPan = false; // Ctrl + 좌클릭으로 팬 모드
    let isCtrlRotate = false; // Ctrl + 우클릭으로 회전 모드
    let previousMousePosition = { x: 0, y: 0 };
    this.ctrlClickPending = false;
    this.ctrlClickStart = null;

    // 마우스 다운
    this.renderer.domElement.addEventListener('mousedown', (e) => {
      // Ctrl + 좌클릭: 팬(이동)
      if (e.ctrlKey && e.button === 0) {
        isDragging = true;
        isCtrlPan = true;
        isCtrlRotate = false;
        previousMousePosition = { x: e.clientX, y: e.clientY };
        this.ctrlClickPending = true;
        this.ctrlClickStart = { x: e.clientX, y: e.clientY };
      }
      // Ctrl + 우클릭: 회전
      else if (e.ctrlKey && e.button === 2) {
        isDragging = true;
        isCtrlPan = false;
        isCtrlRotate = true;
        previousMousePosition = { x: e.clientX, y: e.clientY };
      }
    });

    // 마우스 이동
    this.renderer.domElement.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      let centerMoved = false;

      // 드래그 중 Ctrl 키 상태 실시간 업데이트
      // e.buttons & 1 : 좌클릭 상태인지 확인
      // e.buttons & 2 : 우클릭 상태인지 확인
      if ((e.buttons & 1) === 1) {
        isCtrlPan = e.ctrlKey;
        isCtrlRotate = false;
      } else if ((e.buttons & 2) === 2) {
        isCtrlRotate = e.ctrlKey;
        isCtrlPan = false;
      } else {
        // Ctrl 키를 뗐으면 드래그 종료
        isDragging = false;
        isCtrlPan = false;
        isCtrlRotate = false;
        return;
      }

      if (isCtrlPan) {
        // Ctrl + 좌클릭: 팬(이동) - 지면(XZ평면) 이동만 가능
        const distance = this.camera.position.distanceTo(this.cameraTarget);
        const panSpeed = distance * 0.0015;

        // 1. View Direction (카메라가 바라보는 방향)
        const viewDir = new THREE.Vector3().subVectors(this.cameraTarget, this.camera.position).normalize();

        // 2. Right Vector (화면상의 오른쪽) = ViewDir x CameraUp
        const right = new THREE.Vector3().crossVectors(viewDir, this.camera.up).normalize();
        right.y = 0; // 지면 이동을 위해 Y 성분 제거
        right.normalize();

        // 3. Forward Vector (지면상의 전진/북쪽 방향) = Right x WorldUp(0,1,0)
        const forward = new THREE.Vector3().crossVectors(right, new THREE.Vector3(0, 1, 0)).normalize();

        // 4. 이동 벡터 계산
        // 마우스 좌우(deltaX) -> Right 벡터 방향 (반대)
        // 마우스 상하(deltaY) -> Forward 벡터 방향 (반대)
        const moveVector = new THREE.Vector3()
          .add(right.multiplyScalar(-deltaX * panSpeed))
          .add(forward.multiplyScalar(-deltaY * panSpeed));

        // 타겟과 카메라 모두 이동
        this.cameraTarget.add(moveVector);
        this.camera.position.add(moveVector);

        centerMoved = true;
        this.ctrlClickPending = false;
      } else if (isCtrlRotate) {
        // Ctrl + 우클릭: 회전 - 타겟 중심으로 카메라 회전
        const rotateSpeed = 0.005;

        // 현재 카메라와 타겟 사이의 벡터
        const offset = this.camera.position.clone().sub(this.cameraTarget);
        const distance = offset.length();

        // 구면 좌표계로 변환
        const spherical = new THREE.Spherical().setFromVector3(offset);

        // 마우스 이동에 따라 각도 조정
        // deltaX: 방위각 (azimuth, 수평 회전)
        // deltaY: 극각 (polar, 수직 회전)
        spherical.theta -= deltaX * rotateSpeed; // 좌우 회전
        spherical.phi -= deltaY * rotateSpeed;   // 상하 회전

        // 극각 제한 (지도가 뒤집히지 않도록)
        const minPolarAngle = Math.PI * 0.1;  // 18도
        const maxPolarAngle = Math.PI * 0.5;  // 90도 (정상방)
        spherical.phi = Math.max(minPolarAngle, Math.min(maxPolarAngle, spherical.phi));

        // 거리 유지
        spherical.radius = distance;

        // 다시 직교 좌표로 변환
        offset.setFromSpherical(spherical);

        // 카메라 위치 업데이트
        this.camera.position.copy(this.cameraTarget.clone().add(offset));
      }
      // Ctrl 키 없이는 회전도 팬도 하지 않음 (드래그 비활성화)

      if (this.ctrlClickPending && this.ctrlClickStart && !centerMoved) {
        const moveX = Math.abs(e.clientX - this.ctrlClickStart.x);
        const moveY = Math.abs(e.clientY - this.ctrlClickStart.y);
        if (moveX > 4 || moveY > 4) {
          this.ctrlClickPending = false;
        }
      }

      if (centerMoved) {
        this.notifyCenterChanged();
      }

      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    // 마우스 업
    this.renderer.domElement.addEventListener('mouseup', (e) => {
      isDragging = false;
      isCtrlPan = false;
      isCtrlRotate = false;
      if (this.ctrlClickPending && e.button === 0) {
        this.setCenterFromEvent(e);
      }
      this.ctrlClickPending = false;
    });

    // 휠 스크롤 (확대/축소)
    this.renderer.domElement.addEventListener('wheel', (e) => {
      e.preventDefault();

      const zoomSpeed = 0.1;
      const direction = this.camera.position.clone().sub(this.cameraTarget).normalize();
      const distance = this.camera.position.distanceTo(this.cameraTarget);

      // 거리 제약 (확대: 50, 축소: 1750)
      let newDistance = distance;
      if (e.deltaY > 0) {
        newDistance = Math.min(distance * (1 + zoomSpeed), 1750); // 최대 축소 (250 확장)
      } else {
        newDistance = Math.max(distance * (1 - zoomSpeed), 50);   // 최대 확대 (250 확장)
      }

      const newPosition = this.cameraTarget.clone().add(direction.multiplyScalar(newDistance));
      this.camera.position.copy(newPosition);
    }, { passive: false });

    // 마우스 우클릭 메뉴 방지
    this.renderer.domElement.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    console.log('✅ 카메라 제어 설정 완료');
    console.log('   - Ctrl + 좌클릭 드래그: 팬(이동)');
    console.log('   - Ctrl + 우클릭 드래그: 회전 (극각 제약: 18~90° - 지도 뒤집히지 않음)');
    console.log('   - 휠: 확대/축소 (거리: 50~1750)');
  }


  /**
   * 조명 설정
   */
  addLighting() {
    // 주광선 (태양광) - 더 밝게
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(100, 200, 100);
    this.scene.add(directionalLight);

    // 환경광 - 더 밝게
    const ambientLight = new THREE.AmbientLight(0xcccccc, 1.2);
    this.scene.add(ambientLight);

    // 반사광
    const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x404040, 0.8);
    this.scene.add(hemisphereLight);

    console.log('✅ 조명 설정 완료 (Directional: 1.0, Ambient: 1.2)');
  }

  /**
   * 이벤트 리스너 설정
   */
  setupEventListeners() {
    // 창 크기 변경
    window.addEventListener('resize', () => this.onWindowResize());

    // 마우스 이벤트 (나중에 추가)
    this.renderer.domElement.addEventListener('click', (e) => this.onMouseClick(e));
    this.renderer.domElement.addEventListener('mousemove', (e) => this.onMouseMove(e));
  }

  /**
   * 폴리곤 렌더링
   */
  renderPolygon(volumeCode, coordinates, options = {}) {
    const selected = options.selected || false;
    const metadata = options.metadata || {};

    // 색상 처리 (16진수 또는 RGB 배열 모두 지원)
    let color = options.color || 0x6496DC;
    let rgbColor = [100, 150, 220];

    const lowerLimit = options.lowerLimit || 0;
    const upperLimit = options.upperLimit || 1000; // 기본값

    // 좌표 변환 (XZ 평면 좌표만 필요)
    const vertices = this.transformer.transformArray(coordinates);

    // 1. Shape 생성 (2D 바닥면)
    const shape = new THREE.Shape();
    if (vertices.length > 0) {
      // Three.js에서는 X, Y가 2D 평면 좌표. 여기서는 X, Z를 사용해야 함.
      // Shape는 X, Y 평면에 생성되므로, 나중에 회전시켜야 함.
      // 또는 ExtrudeGeometry 설정을 통해 처리.

      // 여기서는 X, Z(->Y로 매핑) 좌표로 Shape 생성
      shape.moveTo(vertices[0].x, vertices[0].z);
      for (let i = 1; i < vertices.length; i++) {
        shape.lineTo(vertices[i].x, vertices[i].z);
      }
      shape.closePath();
    }

    // 2. 고도 계산 (Y축)
    // lowerLimit, upperLimit는 피트(ft) 단위라고 가정 (또는 미터)
    // transformer.altitudeScale을 사용하여 월드 좌표계 높이로 변환
    // coordinate-transformer.js: y = altitude * this.altitudeScale / 1000

    const yBottom = lowerLimit * this.transformer.altitudeScale / 1000;
    const yTop = upperLimit * this.transformer.altitudeScale / 1000;
    const height = Math.max(0.1, yTop - yBottom); // 최소 높이 보장

    // 3. ExtrudeGeometry 생성
    const extrudeSettings = {
      steps: 1,
      depth: height,
      bevelEnabled: false
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    // 4. 회전 및 위치 조정
    // ExtrudeGeometry는 기본적으로 Z축 방향으로 압출됨 (X, Y 평면의 Shape를 Z로)
    // 하지만 우리는 X, Z 평면의 Shape를 Y로 압출하고 싶음.
    // 위에서 Shape를 (x, z) 좌표로 만들었음. 즉 (x, y) 자리에 (x, z)를 넣음.
    // 생성된 Geometry는 X, Y 평면에 있고 Z축으로 솟음.
    // 이를 X축 기준으로 90도 회전시켜야 함. -> (x, z, -y)가 됨.

    // 회전: X축 기준 90도 (눕히기)
    geometry.rotateX(Math.PI / 2);

    // Material 생성
    const material = new THREE.MeshPhongMaterial({
      color: new THREE.Color(
        color[0] / 255,
        color[1] / 255,
        color[2] / 255
      ),
      emissive: selected ? 0xffaa00 : 0x000000,
      shininess: 100,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7, // 반투명
      wireframe: false
    });

    // Mesh 생성
    const mesh = new THREE.Mesh(geometry, material);

    // 위치 및 회전 조정
    // Shape는 (x, z)로 정의됨. Extrude는 +Z 방향.
    // 회전 후: Y=0에서 Y=-depth로 생성됨. (오른손 법칙)
    // 따라서 position.y를 yTop(즉 yBottom + height)으로 설정하면:
    // Top(yTop)에서 시작해서 아래로(yBottom까지) 그려짐.
    mesh.position.y = yTop; // 상단 Y 위치를 yTop으로 설정하면, Extrude된 볼륨의 상단이 yTop에 위치

    mesh.userData = {
      volumeCode: volumeCode,
      isPolygon: true,
      selected: selected,
      metadata: options.metadata // 메타데이터도 전달
    };

    this.scene.add(mesh);
    this.meshes.push(mesh);

    // 폴리곤 정보 저장
    this.polygons.set(volumeCode, {
      mesh: mesh,
      geometry: geometry,
      vertices: vertices,
      color: color,
      selected: selected,
      metadata: options.metadata // 메타데이터도 저장
    });

    console.log(`✅ 폴리곤(3D) 렌더링: ${volumeCode}, 높이: ${lowerLimit}~${upperLimit} (월드 Y: ${yBottom.toFixed(2)}~${yTop.toFixed(2)})`);
    return mesh;
  }

  /**
   * 기존 폴리곤 제거
   */
  clearPolygons() {
    this.polygons.forEach((poly) => {
      if (poly.mesh) {
        this.scene.remove(poly.mesh);
        if (poly.geometry) {
          poly.geometry.dispose();
        }
        if (poly.mesh.material) {
          poly.mesh.material.dispose();
        }
      }
    });
    this.polygons.clear();
    this.meshes.length = 0;
  }

  /**
   * 단순한 삼각형화 (Fan triangulation)
   * 볼록 폴리곤용
   */
  triangulatePolygon(vertexCount) {
    const indices = [];

    // 첫 번째 점을 기준으로 부채꼴 삼각형 생성
    for (let i = 1; i < vertexCount - 1; i++) {
      indices.push(0, i, i + 1);
    }

    return indices;
  }

  /**
   * 여러 폴리곤 한번에 렌더링
   */
  renderVolumes(volumeCodes, colorMap = {}, options = {}) {
    if (!window.SPAData || !window.SPAData.volumes) {
      console.warn('⚠️ SPAData가 없습니다');
      return;
    }

    const { clearBefore = false } = options;
    if (clearBefore) {
      this.clearPolygons();
    }

    let renderedCount = 0;
    let skippedCount = 0;

    volumeCodes.forEach((code) => {
      const volume = window.SPAData.volumes.get(code);
      if (volume && volume.coordinates && volume.coordinates.length > 0) {
        // 고도 정보 추출
        let lower = volume.baseAltitude || 0;
        let upper = volume.maxAltitude || 10000; // Phase 2 파서에서 제공

        // 폴백: lowerLimit/upperLimit 추출
        if (volume.lowerLimit) {
          if (typeof volume.lowerLimit === 'number') lower = volume.lowerLimit;
          else if (volume.lowerLimit === 'GND' || volume.lowerLimit === 'SFC') lower = 0;
          else {
            const match = String(volume.lowerLimit).match(/\d+/);
            if (match) {
              let val = parseInt(match[0]);
              if (String(volume.lowerLimit).includes('FL')) val *= 100;
              lower = val;
            }
          }
        }

        if (volume.upperLimit) {
          if (typeof volume.upperLimit === 'number') upper = volume.upperLimit;
          else if (volume.upperLimit === 'UNL') upper = 60000;
          else {
            const match = String(volume.upperLimit).match(/\d+/);
            if (match) {
              let val = parseInt(match[0]);
              if (String(volume.upperLimit).includes('FL')) val *= 100;
              upper = val;
            }
          }
        }

        // 좌표 변환용 - 고도 정보를 실제로 적용
        const coords = volume.coordinates.map((c) => ({
          latitude: c.latitude,
          longitude: c.longitude,
          altitude: upper  // 최상위 고도로 폴리곤 위치 설정
        }));

        // 색상 가져오기
        let color = colorMap[code] || [100, 150, 255];

        // RGB 배열인 경우 16진수로 변환하지 않고 그대로 사용
        if (typeof color === 'number') {
          color = [
            (color >> 16) & 255,
            (color >> 8) & 255,
            color & 255
          ];
        }

        // 렌더링 (3D)
        this.renderPolygon(code, coords, {
          color: color,
          selected: false,
          lowerLimit: lower,
          upperLimit: upper,
          metadata: volume
        });

      }
    });

    console.log(`✅ ${volumeCodes.length}개 3D 볼륨 렌더링 완료`);
  }

  /**
   * 폴리곤 선택 해제
   */
  deselectAll() {
    this.polygons.forEach((poly) => {
      poly.selected = false;
      poly.mesh.material.emissive.setHex(0x000000);
    });
  }

  /**
   * 폴리곤 선택
   */
  selectPolygon(volumeCode) {
    this.deselectAll();

    const poly = this.polygons.get(volumeCode);
    if (poly) {
      poly.selected = true;
      poly.mesh.material.emissive.setHex(0xffaa00);
      console.log(`✅ 폴리곤 선택: ${volumeCode}`);
    }
  }

  /**
   * 마우스 클릭 처리
   */
  onMouseClick(event) {
    if (!this.camera) return;

    // 마우스 위치 (NDC: -1 ~ 1)
    const mouse = new THREE.Vector2();
    const rect = this.renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Raycaster로 교점 찾기
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    const intersects = raycaster.intersectObjects(this.meshes);

    if (intersects.length > 0) {
      const clicked = intersects[0].object;
      if (clicked.userData.isPolygon) {
        this.selectPolygon(clicked.userData.volumeCode);
      }
    }
  }

  /**
   * 마우스 이동 처리 (나중에 추가)
   */
  onMouseMove(event) {
    // TODO: 마우스 호버 효과
  }

  /**
   * 카메라 / 컨트롤을 초기 위치로 복원
   */
  resetView() {
    const camPos = this.transformer.getCameraPosition();
    const target = this.transformer.getCameraTarget();

    // 카메라 업벡터 초기화 (월드 업 벡터로)
    this.camera.up.set(0, 1, 0);

    // CoordinateTransformer에서 정의한 위치 그대로 사용
    this.camera.position.set(camPos.x, camPos.y, camPos.z);
    this.camera.lookAt(target.x, target.y, target.z);

    if (this.cameraTarget) {
      this.cameraTarget.set(target.x, target.y, target.z);
    }

    this.notifyCenterChanged();
  }

  onCenterChange(callback) {
    if (typeof callback !== 'function') return;
    this.centerChangeCallbacks.push(callback);
    const center = this.getCenterLatLon();
    if (center) {
      callback(center);
    }
  }

  notifyCenterChanged() {
    const center = this.getCenterLatLon();
    if (!center) return;
    this.centerChangeCallbacks.forEach((cb) => cb(center));
  }

  setCenterFromEvent(event) {
    if (!this.groundPlane || !this.camera) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    const intersection = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(this.groundPlane, intersection)) {
      const offset = this.camera.position.clone().sub(this.cameraTarget);
      this.cameraTarget.copy(intersection);
      this.camera.position.copy(intersection.clone().add(offset));
      this.notifyCenterChanged();
    }
  }

  getCenterLatLon() {
    if (!this.cameraTarget) return null;
    return this.transformer.worldToLatLon(this.cameraTarget.x, this.cameraTarget.z);
  }

  /**
   * 마우스 이벤트로부터 위경도 좌표 계산
   */
  getLatLonFromEvent(event) {
    if (!this.groundPlane || !this.camera) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    const intersection = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(this.groundPlane, intersection)) {
      return this.transformer.worldToLatLon(intersection.x, intersection.z);
    }
    return null;
  }

  /**
   * 윈도우 크기 변경 처리
   */
  onWindowResize() {
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(this.width, this.height);
    if (this.controls) {
      this.controls.update();
    }
  }

  /**
   * 애니메이션 루프
   */
  animate() {
    requestAnimationFrame(() => this.animate());

    // 카메라가 타겟을 바라보도록 설정
    if (this.cameraTarget) {
      this.camera.lookAt(this.cameraTarget);
    }

    // 렌더러 업데이트
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * 테마 토글 (Dark ↔ Light)
   */
  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';

    // 배경색 변경
    const bgColor = this.theme === 'light' ? 0xf5f5f5 : 0x1a1a2e;
    this.scene.background = new THREE.Color(bgColor);

    // 조명 조정 (라이트 모드에서는 더 밝게)
    const ambientLight = this.scene.getObjectByProperty('type', 'AmbientLight');
    if (ambientLight) {
      ambientLight.intensity = this.theme === 'light' ? 1.5 : 1.2;
    }

    // 기존 메시 제거
    this.scene.children = this.scene.children.filter(child => {
      if (child.userData && child.userData.isMapLine) {
        this.scene.remove(child);
        return false;
      }
      return true;
    });

    // 지도 다시 로드
    this.addMapBackground();

    console.log(`🎨 테마 변경: ${this.theme.toUpperCase()}`);
  }

  /**
   * 섹터 표시/숨김 토글
   */
  toggleSectors() {
    this.sectorsVisible = !this.sectorsVisible;
    this.sectorLines.forEach((line) => {
      line.visible = this.sectorsVisible;
    });
    console.log(`📍 Sector ${this.sectorsVisible ? '표시' : '숨김'}`);
  }

  /**
   * 섹터 표시
   */
  showSectors() {
    if (!this.sectorsVisible) {
      this.toggleSectors();
    }
  }

  /**
   * 섹터 숨김
   */
  hideSectors() {
    if (this.sectorsVisible) {
      this.toggleSectors();
    }
  }

  /**
   * 항로 렌더링
   */
  renderRoutes(show = true) {
    // 기존 항로 그룹 제거
    if (this.routesGroup) {
      this.scene.remove(this.routesGroup);
      this.routesGroup.clear();
      this.routesGroup = null;
    }

    if (!show) return;

    // localStorage 또는 window 객체에서 routesData 가져오기
    let routesData = window.routesData;
    if (!routesData) {
      const storedData = localStorage.getItem('routesData');
      if (storedData) {
        try {
          routesData = JSON.parse(storedData);
        } catch (e) {
          console.warn('⚠️ Failed to parse routes data from localStorage');
        }
      }
    }

    if (!routesData || !routesData.features) {
      console.warn('⚠️ Routes data not found');
      return;
    }

    // 색상 설정 (localStorage 또는 window 객체에서 가져오기)
    let colorValue = 0x00ccff; // 기본값: 하늘색 (섹터/지점과 겹치지 않게)
    const storedColor = localStorage.getItem('routeColor');
    if (storedColor) {
      colorValue = parseInt(storedColor.replace('#', '0x'), 16);
    } else {
      const routeColorPicker = window.parent?.document.getElementById('routeColor') || document.getElementById('routeColor');
      if (routeColorPicker) {
        colorValue = parseInt(routeColorPicker.value.replace('#', '0x'), 16);
      }
    }

    this.routesGroup = new THREE.Group();

    // 항로 데이터 렌더링
    for (const feature of routesData.features) {
      const coordinates = feature.geometry.coordinates;
      const points = coordinates.map(([lon, lat]) => {
        return this.transformer.transform(lat, lon, 0);
      });

      if (points.length > 1) {
        // 점선으로 표시
        const geometry = new THREE.BufferGeometry();
        const positionArray = [];

        points.forEach(p => {
          positionArray.push(p.x, p.y, p.z);
        });

        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positionArray), 3));
        const material = new THREE.LineDashedMaterial({
          color: colorValue,
          opacity: 0.8,
          transparent: true,
          linewidth: 2,
          dashSize: 3,
          gapSize: 2
        });
        const line = new THREE.Line(geometry, material);
        line.computeLineDistances(); // 점선을 위해 필수
        this.routesGroup.add(line);
      }
    }

    this.scene.add(this.routesGroup);
  }

  /**
   * 지점 렌더링
   */
  renderFixpoints(show = true) {
    // 기존 지점 그룹 제거
    if (this.fixpointsGroup) {
      this.scene.remove(this.fixpointsGroup);
      this.fixpointsGroup.clear();
      this.fixpointsGroup = null;
    }

    if (!show) return;

    // localStorage 또는 window 객체에서 fixpointsData 가져오기
    let fixpointsData = window.fixpointsData;
    if (!fixpointsData) {
      const storedData = localStorage.getItem('fixpointsData');
      if (storedData) {
        try {
          fixpointsData = JSON.parse(storedData);
        } catch (e) {
          console.warn('⚠️ Failed to parse fixpoints data from localStorage');
        }
      }
    }

    if (!fixpointsData || !fixpointsData.features) {
      console.warn('⚠️ Fixpoints data not found');
      return;
    }

    // 색상 설정 (index.html과 동일: #ff6600)
    let colorValue = 0xff6600; // 기본값

    // 팝업 창인 경우 opener(부모 창)에서 색상 가져오기
    const parentColorPicker = window.opener?.document.getElementById('fixpointColor');
    if (parentColorPicker) {
      colorValue = parseInt(parentColorPicker.value.replace('#', '0x'), 16);
    }

    // 크기 배율 가져오기 (index.html과 동일)
    let userFixpointScale = 1.0; // 기본값

    // StateManager에서 저장한 값 가져오기
    try {
      const airspace3State = localStorage.getItem('airspace3_state');
      if (airspace3State) {
        const state = JSON.parse(airspace3State);
        if (state.userFixpointScale !== undefined) {
          userFixpointScale = parseFloat(state.userFixpointScale);
        }
      }
    } catch (e) {
      console.warn('⚠️ Failed to parse airspace3_state from localStorage');
    }

    // 부모 창(opener)에서도 시도
    if (window.opener?.userFixpointScale) {
      userFixpointScale = window.opener.userFixpointScale;
    }

    // 동적 스케일 계산 (index.html과 동일한 방식)
    const dynamicScale = this.calculateDynamicScale(userFixpointScale);

    this.fixpointsGroup = new THREE.Group();

    // 지점 데이터 렌더링
    for (const feature of fixpointsData.features) {
      const [lon, lat] = feature.geometry.coordinates;
      const worldPos = this.transformer.transform(lat, lon, 0);
      const fixpointName = feature.properties?.name || feature.properties?.NAME || feature.properties?.ident || feature.properties?.FIXPOINT_ID || 'UNKNOWN';

      // 지점 구체 (고정된 작은 크기 - dynamicScale에 영향 없음)
      const sphereRadius = 1;
      const geometry = new THREE.SphereGeometry(sphereRadius, 8, 8);
      const material = new THREE.MeshBasicMaterial({
        color: colorValue,
        opacity: 0.9,
        transparent: true
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.set(worldPos.x, 0, worldPos.z); // y = 0 (지면 레벨)
      this.fixpointsGroup.add(sphere);

      // 지점 이름 텍스트 (Sprite 사용)
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = 512;
      canvas.height = 128;

      // 투명 배경
      context.fillStyle = 'rgba(255, 255, 255, 0)';
      context.fillRect(0, 0, canvas.width, canvas.height);

      // 폰트 크기를 고정 (dynamicScale에 거의 영향 없음)
      const fontSize = 24;
      context.font = `Bold ${Math.round(fontSize)}px Arial`;
      context.fillStyle = '#ffffff'; // 흰색 텍스트
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(fixpointName, canvas.width / 2, canvas.height / 2);

      // Sprite 생성
      const texture = new THREE.CanvasTexture(canvas);
      const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0.9
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.position.set(worldPos.x, 10, worldPos.z); // 지면 바로 위에 표시
      sprite.scale.set(100, 25, 1); // 고정 크기 (dynamicScale에 영향 없음)
      this.fixpointsGroup.add(sprite);
    }

    this.scene.add(this.fixpointsGroup);
  }

  /**
   * 카메라 거리에 따른 동적 스케일 계산 (index.html과 동일)
   */
  calculateDynamicScale(baseScale = 1.0) {
    // 동적 스케일링이 비활성화된 경우 기본 스케일 반환
    const enableDynamicScaling = localStorage.getItem('enableDynamicScaling') !== 'false';
    if (!enableDynamicScaling) return baseScale;

    // 카메라와 타겟 사이의 거리 계산
    const distance = this.camera.position.distanceTo(this.cameraTarget || new THREE.Vector3(0, 0, 0));

    // 최소/최대 거리 설정 (index.html과 유사한 범위)
    const minDist = 50;
    const maxDist = 2000;

    // 거리에 따른 로그 스케일 계산 (1x ~ 5x 범위)
    const logMin = Math.log(minDist);
    const logMax = Math.log(maxDist);
    const logDist = Math.log(Math.max(minDist, Math.min(maxDist, distance)));
    const ratio = (logDist - logMin) / (logMax - logMin);

    // 거리가 멀어질수록 더 크게 표시 (최소 1x, 최대 5x)
    const dynamicFactor = 1 + ratio * 4; // 1 ~ 5
    return baseScale * dynamicFactor;
  }

  /**
   * 지구 모드 표시 상태 업데이트
   * 체크박스 상태에 따라 평면 또는 구 표시
   */
  updateGlobeModeVisibility() {
    this.planeGroup.visible = !this.globeMode;      // 지구 모드 OFF → 평면 표시
    this.sphereGroup.visible = this.globeMode;      // 지구 모드 ON → 구 표시
    console.log(`✅ 렌더링 모드: ${this.globeMode ? '🌍 지구' : '📍 평면'}`);
  }

  /**
   * 지구 모드 토글
   * localStorage에 상태 저장하여 다음 로드 시에도 유지
   */
  toggleGlobeMode(enable) {
    // enable이 명시되지 않으면 현재 상태의 반대로 토글
    if (enable !== undefined) {
      this.globeMode = enable;
    } else {
      this.globeMode = !this.globeMode;
    }

    // localStorage에 저장하여 지속성 유지
    localStorage.setItem('globeMode', this.globeMode.toString());

    // 표시 상태 업데이트
    this.updateGlobeModeVisibility();

    // 체크박스 상태도 동기화
    const globeToggle = document.getElementById('globeToggle');
    if (globeToggle) {
      globeToggle.checked = this.globeMode;
    }
  }

  /**
   * 정리
   */
  dispose() {
    this.clearPolygons();
    this.renderer.dispose();
  }
}

/**
 * 글로벌 렌더러 인스턴스
 */
let globalRenderer = null;

function initializeMapRenderer(containerSelector, options = {}) {
  globalRenderer = new MapRenderer(containerSelector, options);
  return globalRenderer;
}

function getMapRenderer() {
  return globalRenderer;
}

/**
 * 내보내기
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MapRenderer,
    initializeMapRenderer,
    getMapRenderer
  };
}

// 브라우저 환경에서 전역 할당
if (typeof window !== 'undefined') {
  window.MapRenderer = MapRenderer;
  window.initializeMapRenderer = initializeMapRenderer;
  window.getMapRenderer = getMapRenderer;
}
