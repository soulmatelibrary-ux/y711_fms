/**
 * 3D Map Service - 메인 초기화 & 제어 로직
 */

class MapService {
    constructor() {
        this.renderer = null;
        this.transformer = null;
        this.loadingSpinner = null;
        this.mapContainer = null;
        this.currentTheme = 'dark';  // 현재 테마 추적
        this.coastlinesData = null;  // 해안선 데이터 저장 (재렌더링용)
        this.stats = {
            sectors: 0,
            fixpoints: 0,
            routes: 0
        };
    }

    /**
     * 서비스 초기화
     */
    async initialize() {
        console.log('🗺️ Map Service 초기화 시작...');

        try {
            // DOM 요소 캐싱
            this.mapContainer = document.getElementById('map-container');
            this.loadingSpinner = document.querySelector('.loading-spinner');

            // 1. 좌표 변환기 초기화 (먼저 초기화!)
            if (!window.initializeCoordinateTransformer) {
                throw new Error('CoordinateTransformer 로드 실패');
            }

            this.transformer = initializeCoordinateTransformer();
            console.log('✅ CoordinateTransformer 초기화 완료');
            console.log('   위치:', this.transformer.getCameraPosition());

            // 2. MapRenderer 초기화 (transformer가 이미 준비된 후)
            if (!window.MapRenderer) {
                throw new Error('MapRenderer 로드 실패');
            }

            this.renderer = new MapRenderer('#map-container', {
                theme: 'dark'
            });
            console.log('✅ MapRenderer 초기화 완료');

            // 3. MapRenderer의 transformer 동기화
            if (this.renderer && this.renderer.transformer) {
                console.log('✅ Renderer transformer 확인:', this.renderer.transformer ? '존재' : '없음');
            }

            // 데이터 로드
            await this.loadData();

            // 로딩 스피너 숨김
            this.loadingSpinner.style.display = 'none';

            // 이벤트 리스너 설정
            this.setupEventListeners();

            // 통계 업데이트
            this.updateStats();

            console.log('✅ Map Service 초기화 완료!');

        } catch (error) {
            console.error('❌ Map Service 초기화 실패:', error);
            this.showError(`초기화 실패: ${error.message}`);
        }
    }

    /**
     * 데이터 로드 (API로부터)
     */
    async loadData() {
        console.log('📍 데이터 로드 중...');

        try {
            // 1. 해안선 로드 (모든 coastline 파일)
            console.log('  • 해안선 로드 중...');
            const coastlinesResponse = await fetch('/api/map/geo/coastlines?regions=korea,japan,china,northkorea,east-asia');
            if (!coastlinesResponse.ok) throw new Error('해안선 데이터 로드 실패');
            const coastlinesData = await coastlinesResponse.json();
            console.log(`    ✅ ${coastlinesData.features.length} 해안선 로드 완료`);

            // 2. 섹터 로드
            console.log('  • 섹터 로드 중...');
            const sectorsResponse = await fetch('/api/map/geo/sectors');
            if (!sectorsResponse.ok) throw new Error('섹터 데이터 로드 실패');
            const sectorsData = await sectorsResponse.json();
            this.stats.sectors = sectorsData.features.length;
            console.log(`    ✅ ${sectorsData.features.length} 섹터 로드 완료`);

            // 3. 지점 로드
            console.log('  • 지점 로드 중...');
            const fixpointsResponse = await fetch('/api/map/geo/fixpoints?limit=500');
            if (!fixpointsResponse.ok) throw new Error('지점 데이터 로드 실패');
            const fixpointsData = await fixpointsResponse.json();
            this.stats.fixpoints = fixpointsData.features.length;
            console.log(`    ✅ ${fixpointsData.features.length} 지점 로드 완료`);

            // 4. 항로 로드
            console.log('  • 항로 로드 중...');
            const routesResponse = await fetch('/api/map/geo/routes?limit=200');
            if (!routesResponse.ok) throw new Error('항로 데이터 로드 실패');
            const routesData = await routesResponse.json();
            this.stats.routes = routesData.features.length;
            console.log(`    ✅ ${routesData.features.length} 항로 로드 완료`);

            // 렌더러에 데이터 전달
            this.renderCoastlines(coastlinesData);
            this.renderSectors(sectorsData);
            this.renderFixpoints(fixpointsData);
            this.renderRoutes(routesData);

        } catch (error) {
            console.error('❌ 데이터 로드 실패:', error);
            throw error;
        }
    }

    /**
     * 해안선 렌더링 (테마에 따라 색상 변경)
     */
    renderCoastlines(geojsonData) {
        console.log('🎨 해안선 렌더링...');

        // 해안선 데이터 저장 (테마 변경 시 재렌더링을 위해)
        this.coastlinesData = geojsonData;

        try {
            // 테마에 따른 해안선 색상 결정
            // 어두운 모드: 회색계열 (밝은 색)
            // 밝은 모드: 어두운 색상
            let coastlineColor;
            if (this.currentTheme === 'dark') {
                coastlineColor = 0xcccccc;  // 밝은 회색
            } else {
                coastlineColor = 0x2a2a2a;  // 어두운 회색
            }

            // 모든 지역의 해안선을 같은 색으로 렌더링
            const featuresByRegion = {};
            for (const feature of geojsonData.features || []) {
                const region = feature.properties?.region_name || 'unknown';
                if (!featuresByRegion[region]) {
                    featuresByRegion[region] = [];
                }
                featuresByRegion[region].push(feature);
            }

            // 각 region별로 렌더링 (east-asia 제외 - 중복 방지)
            for (const [region, features] of Object.entries(featuresByRegion)) {
                if (region === 'east-asia') {
                    console.log(`  • ${region} 스킵됨 (중복 방지)`);
                    continue;
                }

                console.log(`  • ${region} 렌더링 중 (테마: ${this.currentTheme}, 색상: #${coastlineColor.toString(16)}, ${features.length} features)`);
                this.renderer.renderGeoJSONAsLines(
                    { type: 'FeatureCollection', features: features },
                    coastlineColor
                );
            }

            console.log('✅ 해안선 렌더링 완료');

        } catch (error) {
            console.error('❌ 해안선 렌더링 실패:', error);
        }
    }

    /**
     * 해안선 라벨 생성 (좌표 변환 안전성 개선)
     */
    addCoastlineLabels(geojsonData) {
        if (!geojsonData || !geojsonData.features) return;

        for (const feature of geojsonData.features) {
            const label = feature.properties?.region_label;
            if (!label) continue;

            try {
                // 각 좌표 배열의 중심점 찾기
                let centerLat = 0, centerLon = 0, count = 0;
                const coords = feature.geometry.coordinates;

                if (feature.geometry.type === 'MultiPolygon') {
                    for (const polygon of coords) {
                        for (const ring of polygon) {
                            for (const [lon, lat] of ring) {
                                centerLon += lon;
                                centerLat += lat;
                                count++;
                            }
                        }
                    }
                } else if (feature.geometry.type === 'Polygon') {
                    for (const ring of coords) {
                        for (const [lon, lat] of ring) {
                            centerLon += lon;
                            centerLat += lat;
                            count++;
                        }
                    }
                }

                if (count > 0) {
                    centerLon /= count;
                    centerLat /= count;

                    // 좌표 유효성 검사
                    if (!isNaN(centerLat) && !isNaN(centerLon)) {
                        const transformed = this.transformer.transform(centerLat, centerLon, 0);

                        // 변환된 좌표 검증
                        if (!isNaN(transformed.x) && !isNaN(transformed.z)) {
                            const position = new THREE.Vector3(transformed.x, 0.5, transformed.z);
                            this.createLabel(position, label, 0xcccccc);
                        }
                    }
                }
            } catch (error) {
                console.warn(`⚠️ 라벨 생성 오류 (${label}):`, error);
            }
        }
    }

    /**
     * 해안선 경로 그리기 (라벨 포함)
     */
    drawCoastlinePath(ring, label = null) {
        if (!ring || ring.length < 2) return;

        const points = ring.map(([lon, lat]) => {
            const transformed = this.transformer.transform(lat, lon, 0);
            return new THREE.Vector3(transformed.x, 0.5, transformed.z);
        });

        if (points.length < 2) return;

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: 0xcccccc,
            linewidth: 1,
            depthTest: true
        });

        const line = new THREE.Line(geometry, material);
        line.userData.isCoastline = true;
        if (label) {
            line.userData.label = label;
        }
        this.renderer.planeGroup.add(line);

        // 라벨 표시 (중심점에)
        if (label && points.length > 10) {
            const centerPoint = points[Math.floor(points.length / 2)];
            this.createLabel(centerPoint, label, 0xcccccc);
        }
    }

    /**
     * 텍스트 라벨 생성 (Sprite 기반 - MapRenderer 패턴 참조)
     */
    createLabel(position, text, color) {
        try {
            // 위치 유효성 검사
            if (!position || typeof position.x !== 'number' || typeof position.z !== 'number' ||
                isNaN(position.x) || isNaN(position.z)) {
                console.warn('⚠️ 라벨 위치 오류:', position);
                return;
            }

            // Canvas를 사용한 텍스트 렌더링 (기존 코드 참조)
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = 512;
            canvas.height = 128;

            // 투명 배경
            context.fillStyle = 'rgba(255, 255, 255, 0)';
            context.fillRect(0, 0, canvas.width, canvas.height);

            // 텍스트 렌더링
            const fontSize = 28;
            context.font = `Bold ${Math.round(fontSize)}px Arial`;
            context.fillStyle = '#cccccc';  // 밝은 회색
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(String(text).substring(0, 20), canvas.width / 2, canvas.height / 2);

            // Sprite 생성 (PlaneGeometry 대신 Sprite 사용)
            const texture = new THREE.CanvasTexture(canvas);
            const spriteMaterial = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                opacity: 0.95
            });
            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.position.set(position.x, 3, position.z);  // 지면 위에 표시
            sprite.scale.set(150, 37.5, 1);  // 고정 크기
            sprite.userData.isLabel = true;
            this.renderer.planeGroup.add(sprite);
        } catch (error) {
            console.error('❌ 라벨 생성 실패:', error);
        }
    }

    /**
     * 섹터 렌더링
     */
    renderSectors(geojsonData) {
        console.log('🎨 섹터 렌더링...', geojsonData.features?.length, '개 features');

        try {
            let polygonCount = 0;
            for (const feature of geojsonData.features) {
                const coords = feature.geometry.coordinates;
                const props = feature.properties;
                const geomType = feature.geometry.type;

                console.log(`  📍 ${props.sector_id}: geometry type = ${geomType}`);

                // Polygon → 폐곡선
                if (geomType === 'Polygon') {
                    const ring = coords[0];
                    console.log(`    🔷 Ring 크기: ${ring?.length || 0} 점`);
                    this.drawSectorBoundary(ring, props);
                    polygonCount++;
                } else {
                    console.log(`    ⚠️  Polygon이 아님: ${geomType}`);
                }
            }

            console.log(`✅ 섹터 렌더링 완료: ${polygonCount}/${geojsonData.features.length} Polygon`);

        } catch (error) {
            console.error('❌ 섹터 렌더링 실패:', error);
        }
    }

    /**
     * 섹터 경계 그리기 (LineBasicMaterial로 다각형 렌더링)
     */
    drawSectorBoundary(ring, properties) {
        if (!ring || ring.length < 3) {
            console.warn(`  ⚠️  섹터 ${properties.sector_id}: ring 데이터 없음`);
            return;
        }

        try {
            // 좌표 형식: [lat, lon]을 3D 점으로 변환
            const points3D = [];

            for (const [lat, lon] of ring) {
                const transformed = this.transformer.transform(lat, lon, 0);

                // NaN 값 검증
                if (isNaN(transformed.x) || isNaN(transformed.z)) {
                    console.warn(`  ⚠️  좌표 변환 실패: [${lat}, ${lon}]`);
                    continue;
                }

                points3D.push(new THREE.Vector3(transformed.x, 0.5, transformed.z));
            }

            if (points3D.length < 3) {
                console.warn(`  ⚠️  섹터 ${properties.sector_id}: 유효한 점 부족 (${points3D.length}/${ring.length})`);
                return;
            }

            // 폐곡선 생성 (끝점 = 시작점)
            const closedPoints = [...points3D, points3D[0]];

            // BufferGeometry 생성
            const geometry = new THREE.BufferGeometry();
            geometry.setFromPoints(closedPoints);

            // LineBasicMaterial - 밝은 색상
            const material = new THREE.LineBasicMaterial({
                color: 0xffff00,  // 노란색 (밝고 선명)
                linewidth: 1,
                transparent: true,
                opacity: 0.9
            });

            // Line 생성 및 추가
            const line = new THREE.Line(geometry, material);
            line.userData = {
                isSector: true,
                isMapLine: true,  // 해안선 필터링에서 제외하기 위해 추가
                sectorId: properties.sector_id,
                altitudeStart: properties.altitude_start,
                altitudeEnd: properties.altitude_end
            };

            this.renderer.planeGroup.add(line);

            console.log(`  ✅ 섹터 선 추가: ${properties.sector_id} (${closedPoints.length}개 점)`);

        } catch (error) {
            console.error(`  ❌ 섹터 오류 (${properties.sector_id}):`, error);
        }
    }

    /**
     * 지점 렌더링
     */
    renderFixpoints(geojsonData) {
        console.log('🎨 지점 렌더링...');

        try {
            for (const feature of geojsonData.features) {
                const coords = feature.geometry.coordinates;
                const props = feature.properties;

                const worldPos = this.transformer.transform(coords[1], coords[0], 0);

                // NaN 검증 - 유효한 좌표만 처리
                if (isNaN(worldPos.x) || isNaN(worldPos.z)) {
                    console.warn(`⚠️ 지점 ${props.fixpoint_id} 좌표 오류`);
                    continue;
                }

                // 구체 생성
                const sphereGeometry = new THREE.SphereGeometry(1.5, 8, 8);
                const sphereMaterial = new THREE.MeshBasicMaterial({
                    color: 0xff6600,
                    opacity: 0.9,
                    transparent: true
                });

                const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
                sphere.position.set(worldPos.x, 0.5, worldPos.z);
                sphere.userData = {
                    isFixpoint: true,
                    fixpointId: props.fixpoint_id,
                    fixpointName: props.fixpoint_name
                };

                this.renderer.planeGroup.add(sphere);

                // 라벨 텍스트 (Sprite)
                this.drawFixpointLabel(worldPos, props.fixpoint_name);
            }

            console.log('✅ 지점 렌더링 완료');

        } catch (error) {
            console.error('❌ 지점 렌더링 실패:', error);
        }
    }

    /**
     * 지점 라벨 그리기
     */
    drawFixpointLabel(worldPos, labelText) {
        // 위치 유효성 검사
        if (!worldPos || isNaN(worldPos.x) || isNaN(worldPos.z)) {
            console.warn('⚠️ 라벨 위치 오류:', worldPos);
            return;
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        // 투명 배경
        context.fillStyle = 'rgba(255, 255, 255, 0)';
        context.fillRect(0, 0, canvas.width, canvas.height);

        // 텍스트 - 얇은 글꼴로 수정
        context.font = '14px Arial';  // Bold 제거, 크기 축소
        context.fillStyle = '#cccccc';  // 밝은 회색으로 수정
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(labelText, canvas.width / 2, canvas.height / 2);

        // Sprite 생성
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.85
        });

        const sprite = new THREE.Sprite(spriteMaterial);
        // 위치 조정: 지점 위쪽에 표시 (겹침 줄이기)
        sprite.position.set(worldPos.x, 3, worldPos.z);
        sprite.scale.set(30, 8, 1);  // 크기 축소

        this.renderer.planeGroup.add(sprite);
    }

    /**
     * 항로 렌더링
     */
    renderRoutes(geojsonData) {
        console.log('🎨 항로 렌더링...');

        try {
            for (const feature of geojsonData.features) {
                const coords = feature.geometry.coordinates;
                const props = feature.properties;

                const points = coords
                    .map(([lon, lat]) => {
                        const transformed = this.transformer.transform(lat, lon, 0);
                        // NaN 검증 - 유효한 좌표만 포함
                        if (isNaN(transformed.x) || isNaN(transformed.z)) {
                            return null;
                        }
                        return new THREE.Vector3(transformed.x, 0.5, transformed.z);
                    })
                    .filter(p => p !== null);

                if (points.length < 2) continue;

                const geometry = new THREE.BufferGeometry().setFromPoints(points);
                const material = new THREE.LineDashedMaterial({
                    color: 0x00ccff,  // 하늘색
                    linewidth: 2,
                    dashSize: 3,
                    gapSize: 2,
                    transparent: true,
                    opacity: 0.8
                });

                const line = new THREE.Line(geometry, material);
                line.computeLineDistances();
                line.userData = {
                    isRoute: true,
                    routeId: props.route_id,
                    routeName: props.route_name
                };

                this.renderer.planeGroup.add(line);
            }

            console.log('✅ 항로 렌더링 완료');

        } catch (error) {
            console.error('❌ 항로 렌더링 실패:', error);
        }
    }

    /**
     * 이벤트 리스너 설정
     */
    setupEventListeners() {
        console.log('⚙️ 이벤트 리스너 설정 중...');

        // 섹터 토글 - isSector 태그된 라인 숨김/표시
        document.getElementById('toggle-sectors').addEventListener('change', (e) => {
            if (this.renderer && this.renderer.planeGroup) {
                this.renderer.planeGroup.children.forEach(child => {
                    if (child.userData && child.userData.isSector) {
                        child.visible = e.target.checked;
                    }
                });
            }
            console.log(`👁️ 섹터 ${e.target.checked ? '표시' : '숨김'}`);
        });

        // 해안선 토글 - isMapLine 태그된 라인 중 해안선만 숨김/표시
        document.getElementById('toggle-coastlines').addEventListener('change', (e) => {
            if (this.renderer && this.renderer.planeGroup) {
                this.renderer.planeGroup.children.forEach(child => {
                    // isMapLine이면서 isSector가 아닌 것 = 해안선
                    if (child.userData && child.userData.isMapLine && !child.userData.isSector) {
                        child.visible = e.target.checked;
                    }
                });
            }
            console.log(`👁️ 해안선 ${e.target.checked ? '표시' : '숨김'}`);
        });

        // 지점 토글 - isFixpoint 태그된 구체와 라벨 숨김/표시
        document.getElementById('toggle-fixpoints').addEventListener('change', (e) => {
            if (this.renderer && this.renderer.planeGroup) {
                this.renderer.planeGroup.children.forEach(child => {
                    // 지점 구체 또는 라벨 스프라이트
                    if (child.userData && (child.userData.isFixpoint || child.userData.isLabel)) {
                        child.visible = e.target.checked;
                    }
                });
            }
            console.log(`👁️ 지점 ${e.target.checked ? '표시' : '숨김'}`);
        });

        // 카메라 제어 - 초기화
        document.getElementById('reset-camera-btn').addEventListener('click', () => {
            if (this.renderer) {
                this.renderer.resetView();
                console.log('🔄 카메라 초기화');
            }
        });

        // 카메라 제어 - 확대
        document.getElementById('zoom-in-btn').addEventListener('click', () => {
            if (this.renderer) {
                const distance = this.renderer.camera.position.distanceTo(this.renderer.cameraTarget);
                const direction = this.renderer.camera.position.clone().sub(this.renderer.cameraTarget).normalize();
                const newDistance = Math.max(distance * 0.8, 50);  // 80% 축소 (확대)
                this.renderer.camera.position.copy(this.renderer.cameraTarget.clone().add(direction.multiplyScalar(newDistance)));
                console.log('🔍 카메라 확대');
            }
        });

        // 카메라 제어 - 축소
        document.getElementById('zoom-out-btn').addEventListener('click', () => {
            if (this.renderer) {
                const distance = this.renderer.camera.position.distanceTo(this.renderer.cameraTarget);
                const direction = this.renderer.camera.position.clone().sub(this.renderer.cameraTarget).normalize();
                const newDistance = Math.min(distance * 1.2, 1750);  // 120% 증가 (축소)
                this.renderer.camera.position.copy(this.renderer.cameraTarget.clone().add(direction.multiplyScalar(newDistance)));
                console.log('🔍 카메라 축소');
            }
        });

        // 테마 토글 - 어두운 모드/밝은 모드
        document.getElementById('dark-mode').addEventListener('change', (e) => {
            const newTheme = e.target.checked ? 'dark' : 'light';
            this.currentTheme = newTheme;  // 현재 테마 업데이트

            if (this.renderer) {
                this.renderer.setTheme(newTheme);
            }

            // 해안선 재렌더링 (테마에 따라 색상 변경)
            if (this.coastlinesData) {
                console.log(`🎨 테마 변경 → ${newTheme === 'dark' ? '어두운 모드' : '밝은 모드'} (해안선 재렌더링)`);
                // planeGroup에서 기존 해안선 제거
                this.renderer.clearCoastlines();
                // 새로운 색상으로 해안선 재렌더링
                this.renderCoastlines(this.coastlinesData);
            }
        });

        console.log('✅ 이벤트 리스너 설정 완료');
    }

    /**
     * 통계 업데이트
     */
    updateStats() {
        document.getElementById('stat-sectors').textContent = this.stats.sectors;
        document.getElementById('stat-fixpoints').textContent = this.stats.fixpoints;
        document.getElementById('stat-routes').textContent = this.stats.routes;
        document.getElementById('map-info-text').textContent = '✅ 지도 로딩 완료';
    }

    /**
     * 에러 표시
     */
    showError(message) {
        const infoText = document.getElementById('map-info-text');
        if (infoText) {
            infoText.textContent = `❌ ${message}`;
            infoText.style.color = '#e74c3c';
        }
    }
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 페이지 로드 완료, Map Service 초기화...');
    const mapService = new MapService();
    await mapService.initialize();
});
