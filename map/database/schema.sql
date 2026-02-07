-- 3D 지도 서비스 데이터베이스 스키마
-- 4개의 지리정보 테이블 포함

-- ============================================================================
-- 1. 해안선 데이터 (geo_coastlines)
-- ============================================================================
CREATE TABLE IF NOT EXISTS geo_coastlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region_name TEXT NOT NULL UNIQUE,      -- 지역명 (korea, japan, china 등)
    region_type TEXT,                      -- 지역 타입 (coastline 등)
    geojson_coordinates TEXT NOT NULL,     -- Polygon 좌표 배열 (JSON)
    feature_properties TEXT,                -- GeoJSON feature properties (JSON)
    source_file TEXT,                      -- 원본 파일명
    feature_count INTEGER,                 -- 피처 개수
    file_size_kb INTEGER,                  -- 파일 크기
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_geo_coastlines_region
ON geo_coastlines(region_name);


-- ============================================================================
-- 2. 통제 섹터 데이터 (geo_sectors)
-- ============================================================================
CREATE TABLE IF NOT EXISTS geo_sectors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sector_id TEXT NOT NULL UNIQUE,        -- 섹터 ID (DG, ES1 등)
    sector_name TEXT,                      -- 섹터명
    boundary_points TEXT,                  -- 경계선 점 목록 (JSON)
    geojson_polygon TEXT,                  -- GeoJSON Polygon (JSON)
    altitude_start INTEGER,                -- 시작 고도 (ft)
    altitude_end INTEGER,                  -- 종료 고도 (ft)
    controller_unit TEXT,                  -- 관제 부서명
    frequency_vhf REAL,                    -- VHF 주파수
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_geo_sectors_id
ON geo_sectors(sector_id);

CREATE INDEX IF NOT EXISTS idx_geo_sectors_altitude
ON geo_sectors(altitude_start, altitude_end);


-- ============================================================================
-- 3. 항로 지점 데이터 (geo_fixpoints)
-- ============================================================================
CREATE TABLE IF NOT EXISTS geo_fixpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fixpoint_id TEXT NOT NULL UNIQUE,      -- 지점 ID (MASTA, MUGUS 등)
    fixpoint_name TEXT,                    -- 지점명
    fixpoint_type TEXT,                    -- 지점 타입 (WAYPOINT, NAVAID 등)
    latitude REAL NOT NULL,                -- 위도
    longitude REAL NOT NULL,               -- 경도
    elevation_ft INTEGER,                  -- 고도 (ft)
    frequency_khz REAL,                    -- 주파수 (kHz)
    region TEXT,                           -- 지역 (RKRR 등)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_geo_fixpoints_id
ON geo_fixpoints(fixpoint_id);

CREATE INDEX IF NOT EXISTS idx_geo_fixpoints_location
ON geo_fixpoints(latitude, longitude);

CREATE INDEX IF NOT EXISTS idx_geo_fixpoints_region
ON geo_fixpoints(region);


-- ============================================================================
-- 4. 항로 데이터 (geo_routes)
-- ============================================================================
CREATE TABLE IF NOT EXISTS geo_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id TEXT NOT NULL UNIQUE,         -- 항로 ID (A582, M215 등)
    route_name TEXT,                       -- 항로명
    route_type TEXT,                       -- 항로 타입 (AIRWAY 등)
    waypoint_sequence TEXT,                -- 경유지점 목록 (JSON)
    geojson_linestring TEXT NOT NULL,      -- GeoJSON LineString (JSON)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_geo_routes_id
ON geo_routes(route_id);

CREATE INDEX IF NOT EXISTS idx_geo_routes_type
ON geo_routes(route_type);
