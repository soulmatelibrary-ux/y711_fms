# Three.js NaN Error 해결 가이드

## 🔴 오류 메시지

```
THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN.
The "position" attribute is likely to have NaN values.
```

**발생 위치**: `map-renderer.js:1015` (animate 함수)

---

## 📋 오류 원인 분석

### 1️⃣ **근본 원인**

Three.js 3D 객체를 생성할 때 **유효하지 않은 좌표값**이 사용됨:

```javascript
// ❌ 문제 상황
const geometry = new THREE.BufferGeometry();
const positions = new Float32Array([
    NaN, NaN, NaN,     // ← NaN 값!
    undefined, 0, 10,  // ← undefined 변환된 NaN
    0, 10, 20
]);
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.computeBoundingSphere(); // ← NaN 반경 오류 발생
```

### 2️⃣ **발생 시나리오**

| 상황 | 원인 | 결과 |
|------|------|------|
| **항공편 데이터 없음** | 빈 배열로 geometry 생성 | NaN 좌표 |
| **좌표 계산 오류** | undefined + 숫자 = NaN | NaN 좌표 |
| **기하학적 변환 실패** | 위도/경도 파싱 실패 | NaN 좌표 |
| **카메라 초기화 오류** | 유효 범위 계산 실패 | NaN 반경 |

---

## ✅ 해결 방법

### 방법 1️⃣: 데이터 검증 추가 (권장)

```javascript
// map-renderer.js 또는 관련 렌더링 함수

function createGeometry(data) {
    // ✅ 데이터 유효성 검증
    if (!data || data.length === 0) {
        console.warn('⚠️ 항공편 데이터 없음. Geometry 생성 스킵.');
        return null;
    }

    // ✅ 좌표값 검증
    const validPositions = data.filter(item => {
        const hasValidCoords =
            Number.isFinite(item.x) &&
            Number.isFinite(item.y) &&
            Number.isFinite(item.z);

        if (!hasValidCoords) {
            console.warn(`⚠️ 유효하지 않은 좌표: ${JSON.stringify(item)}`);
        }
        return hasValidCoords;
    });

    if (validPositions.length === 0) {
        console.warn('⚠️ 유효한 좌표가 없음. Geometry 생성 스킵.');
        return null;
    }

    // ✅ Geometry 생성
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(validPositions.length * 3);

    validPositions.forEach((item, i) => {
        positions[i * 3] = item.x;
        positions[i * 3 + 1] = item.y;
        positions[i * 3 + 2] = item.z;
    });

    geometry.setAttribute('position',
        new THREE.BufferAttribute(positions, 3)
    );

    return geometry;
}
```

### 방법 2️⃣: computeBoundingSphere() 오류 처리

```javascript
// Geometry 생성 후

function safeComputeBoundingSphere(geometry) {
    try {
        // 무한 또는 NaN 체크
        const hasInvalidPositions = geometry.attributes.position.array
            .some(val => !Number.isFinite(val));

        if (hasInvalidPositions) {
            console.warn('⚠️ 유효하지 않은 position 값 감지. 스킵됨.');
            return;
        }

        // ✅ 안전하게 계산
        geometry.computeBoundingSphere();

        // 결과 검증
        if (geometry.boundingSphere && Number.isFinite(geometry.boundingSphere.radius)) {
            console.log(`✓ BoundingSphere 계산 성공: radius=${geometry.boundingSphere.radius}`);
        } else {
            console.warn('⚠️ BoundingSphere 반경이 NaN입니다.');
        }
    } catch (error) {
        console.error('❌ computeBoundingSphere 오류:', error);
    }
}
```

### 방법 3️⃣: Raycaster 안전성 개선

```javascript
// intersectsObject() 호출 전

function safeIntersectsObject(raycaster, object) {
    try {
        // 객체 유효성 검증
        if (!object || !object.geometry) {
            return [];
        }

        // Geometry 유효성 검증
        const positions = object.geometry.attributes?.position?.array;
        if (!positions || positions.length === 0) {
            return [];
        }

        // 좌표값 검증
        const hasInvalidValues = Array.from(positions)
            .some(val => !Number.isFinite(val));

        if (hasInvalidValues) {
            console.warn('⚠️ Object에 NaN 좌표가 있음. intersectsObject 스킵.');
            return [];
        }

        // ✅ 안전하게 교차 판정
        return raycaster.intersectObject(object);
    } catch (error) {
        console.error('❌ intersectsObject 오류:', error);
        return [];
    }
}
```

### 방법 4️⃣: animate 루프 보호

```javascript
// requestAnimationFrame 루프

let lastErrorTime = 0;
const errorThrottleMs = 5000; // 5초마다만 로그

function animate() {
    try {
        // ✅ 렌더링 로직
        renderer.render(scene, camera);
    } catch (error) {
        const now = Date.now();
        if (now - lastErrorTime > errorThrottleMs) {
            console.error('❌ 렌더링 오류:', error);
            lastErrorTime = now;
        }
    }

    requestAnimationFrame(animate);
}
```

---

## 🔧 즉시 적용 가능한 패치

### public/auth.js 추가

```javascript
// 부팅 시 실행
function initializeMapRenderer() {
    window.mapRendererSafe = {
        // NaN 값 필터링
        sanitizePositions: function(positions) {
            return positions.filter(val => Number.isFinite(val));
        },

        // Geometry 안전 생성
        createSafeGeometry: function(positions, indices) {
            if (!positions || positions.length === 0) return null;

            const safePositions = this.sanitizePositions(positions);
            if (safePositions.length < 3) return null; // 최소 3개 필요

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position',
                new THREE.BufferAttribute(safePositions, 3)
            );

            // 오류 방지
            if (safePositions.length > 0) {
                geometry.computeBoundingSphere?.();
            }

            return geometry;
        }
    };
}

// 앱 초기화 시 호출
initializeMapRenderer();
```

---

## 📊 오류 발생 체크리스트

오류 발생 시 확인 사항:

- [ ] **항공편 데이터 로드됨?**
  ```javascript
  console.log('Flights:', allFlights);
  console.log('Count:', allFlights.length);
  ```

- [ ] **좌표값이 유효한가?**
  ```javascript
  allFlights.forEach(f => {
      console.log(`${f.id}: x=${f.x}, y=${f.y}, z=${f.z}`);
  });
  ```

- [ ] **NaN 값이 있는가?**
  ```javascript
  const hasNaN = allFlights.some(f =>
      !Number.isFinite(f.x) ||
      !Number.isFinite(f.y) ||
      !Number.isFinite(f.z)
  );
  console.log('Has NaN:', hasNaN);
  ```

- [ ] **Geometry 속성이 있는가?**
  ```javascript
  if (mesh.geometry && mesh.geometry.attributes.position) {
      console.log('Position attribute exists ✓');
  }
  ```

---

## 🚀 최종 해결책: 렌더링 가드

```javascript
// map-renderer.js의 render 함수 시작 부분

function render() {
    // ① 데이터 검증
    if (!scene || !camera || !renderer) {
        console.warn('3D 렌더러 미초기화');
        return;
    }

    // ② Geometry 검증
    scene.traverse((obj) => {
        if (obj.geometry && obj.geometry.attributes.position) {
            const positions = obj.geometry.attributes.position.array;

            // NaN 값 검사
            if (Array.from(positions).some(v => !Number.isFinite(v))) {
                obj.visible = false; // 숨김
                console.warn(`⚠️ 숨김: ${obj.name} (NaN 좌표)`);
            }
        }
    });

    // ③ 렌더링
    try {
        renderer.render(scene, camera);
    } catch (error) {
        console.error('렌더링 실패:', error);
    }
}
```

---

## 📈 성능 영향

| 방법 | 성능 영향 | 추천도 |
|------|---------|--------|
| 데이터 검증 | 매우 낮음 | ⭐⭐⭐⭐⭐ |
| try-catch | 낮음 | ⭐⭐⭐⭐ |
| 오류 필터링 | 무시할 수준 | ⭐⭐⭐⭐⭐ |
| 객체 숨김 | 무시할 수준 | ⭐⭐⭐ |

---

## 🎯 권장 해결 순서

1. **즉시**: 콘솔 오류 필터링 (경고만 보이게)
2. **단기**: 데이터 검증 추가
3. **중기**: try-catch로 렌더링 보호
4. **장기**: 3D 렌더러 아키텍처 개선

---

## 📞 추가 리소스

- **Three.js 문서**: https://threejs.org/docs/
- **BufferGeometry**: https://threejs.org/docs/#api/en/core/BufferGeometry
- **Raycaster**: https://threejs.org/docs/#api/en/core/Raycaster

---

**상태**: 오류는 무해하지만, 콘솔을 깔끔하게 유지하기 위해 위의 방법들을 적용하세요. ✨
