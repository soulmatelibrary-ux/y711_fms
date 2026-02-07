#!/usr/bin/env python3
"""
지도 서비스 지리정보 마이그레이션 스크립트
GeoJSON/CSV 파일들을 데이터베이스로 이관

사용법:
  python3 database/migrate_geojson.py
"""

import json
import csv
import sqlite3
from pathlib import Path
import sys
from datetime import datetime

# 프로젝트 루트
PROJECT_DIR = Path(__file__).parent.parent
DB_PATH = PROJECT_DIR / 'database' / 'similarity_detector.db'
AIRSPACE_DATA_DIR = PROJECT_DIR / 'Tmp' / 'airspace' / 'data'

# 폴백: 원래 경로가 없으면 Tmp 경로 시도
if not AIRSPACE_DATA_DIR.exists():
    AIRSPACE_DATA_DIR = Path('/Users/sein/Desktop/airspace/data')

def init_db():
    """DB 연결 및 초기화"""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def migrate_coastlines(conn):
    """해안선 데이터 마이그레이션 (GeoJSON → geo_coastlines)"""
    print("\n📍 해안선 데이터 마이그레이션 중...")

    cursor = conn.cursor()

    # 최고 품질의 해안선 파일 사용
    files = {
        'korea-provinces.geojson': 'korea',           # 한국 (상세, 14.7MB)
        'japan-coastline.geojson': 'japan',           # 일본 (최고 품질, 12.7MB, 47개)
        'china-provinces.geojson': 'china',           # 중국 (34개)
        'northkorea-provinces.geojson': 'northkorea', # 북한 (11개)
        'coastline.geojson': 'east-asia'              # 동아시아 통합 (412KB, 2개)
    }

    for filename, region_name in files.items():
        filepath = AIRSPACE_DATA_DIR / filename

        if not filepath.exists():
            print(f"  ⚠️  파일 없음: {filename}")
            continue

        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                geojson = json.load(f)

            # GeoJSON의 feature들의 geometry coordinates와 properties를 수집
            if geojson.get('features'):
                features = geojson['features']
                all_coords = []
                all_props = []  # properties 수집

                for feature in features:
                    if feature.get('geometry'):
                        geom_type = feature['geometry'].get('type')
                        coords = feature['geometry'].get('coordinates', [])
                        props = feature.get('properties', {})

                        # Geometry 타입에 따라 다르게 처리
                        if geom_type == 'MultiPolygon':
                            # MultiPolygon: [[[[lon,lat],...]], ...]
                            # 각 polygon을 개별 polygon으로 저장
                            all_coords.extend(coords)
                        elif geom_type == 'Polygon':
                            # Polygon: [[[lon,lat],...], ...]
                            # 하나의 polygon으로 저장 (ring들의 배열)
                            all_coords.append(coords)
                        # LineString 등 다른 타입은 무시

                        # Properties 저장 (지역명 등)
                        all_props.append(props)

                coordinates_json = json.dumps(all_coords)
                properties_json = json.dumps(all_props)
                file_size_kb = filepath.stat().st_size // 1024
                feature_count = len(features)

                # 기존 데이터 제거
                cursor.execute('DELETE FROM geo_coastlines WHERE region_name = ?', (region_name,))

                # 새 데이터 삽입
                cursor.execute('''
                    INSERT INTO geo_coastlines
                    (region_name, region_type, geojson_coordinates, feature_properties, source_file, feature_count, file_size_kb)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    region_name,
                    'coastline',
                    coordinates_json,
                    properties_json,
                    filename,
                    feature_count,
                    file_size_kb
                ))

                print(f"  ✅ {region_name:15} - {feature_count:4} features, {file_size_kb:7} KB")

        except Exception as e:
            print(f"  ❌ {filename}: {str(e)}")

    conn.commit()
    print("  ✅ 해안선 마이그레이션 완료!")

def migrate_sectors(conn):
    """섹터 데이터 마이그레이션 (sector.csv → geo_sectors)"""
    print("\n📍 섹터 데이터 마이그레이션 중...")

    cursor = conn.cursor()
    csv_path = AIRSPACE_DATA_DIR / 'sector.csv'

    if not csv_path.exists():
        print(f"  ⚠️  파일 없음: sector.csv")
        return

    try:
        sectors = {}

        # CSV 읽기
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # 컬럼명이 대문자임
                sector_id = row.get('SECTOR_ID') or row.get('id')

                if sector_id not in sectors:
                    sectors[sector_id] = {
                        'points': [],
                        'alt_start': int(row.get('alt_start', 0)),
                        'alt_end': int(row.get('alt_end', 999999))
                    }

                # 좌표 추가 (LAT, LON은 대문자)
                try:
                    lat = float(row.get('LAT') or row.get('latitude'))
                    lon = float(row.get('LON') or row.get('longitude'))
                    sectors[sector_id]['points'].append([lat, lon])
                except (ValueError, KeyError, TypeError):
                    continue

        # DB 저장
        cursor.execute('DELETE FROM geo_sectors')

        for sector_id, data in sectors.items():
            if not data['points']:
                continue

            # GeoJSON Polygon 생성
            coordinates = [data['points']]  # exterior ring

            # 시작점과 끝점이 같아야 폐곡선
            if data['points'][0] != data['points'][-1]:
                coordinates[0].append(data['points'][0])

            geojson_polygon = json.dumps({
                'type': 'Polygon',
                'coordinates': coordinates
            })

            cursor.execute('''
                INSERT INTO geo_sectors
                (sector_id, boundary_points, geojson_polygon, altitude_start, altitude_end)
                VALUES (?, ?, ?, ?, ?)
            ''', (
                sector_id,
                json.dumps(data['points']),
                geojson_polygon,
                data['alt_start'],
                data['alt_end']
            ))

        conn.commit()
        print(f"  ✅ {len(sectors):3} 섹터 마이그레이션 완료!")

    except Exception as e:
        print(f"  ❌ sector.csv: {str(e)}")

def migrate_fixpoints(conn):
    """지점 데이터 마이그레이션 (aip_fixpoints.geojson → geo_fixpoints)"""
    print("\n📍 지점 데이터 마이그레이션 중...")

    cursor = conn.cursor()
    geojson_path = AIRSPACE_DATA_DIR / 'aip_fixpoints.geojson'

    if not geojson_path.exists():
        print(f"  ⚠️  파일 없음: aip_fixpoints.geojson")
        return

    try:
        with open(geojson_path, 'r', encoding='utf-8') as f:
            geojson = json.load(f)

        cursor.execute('DELETE FROM geo_fixpoints')

        count = 0
        for feature in geojson.get('features', []):
            try:
                props = feature.get('properties', {})
                coords = feature.get('geometry', {}).get('coordinates', [])

                if not coords or len(coords) < 2:
                    continue

                fixpoint_id = props.get('FIXPOINT_ID') or props.get('NAME') or f"FP{count}"

                cursor.execute('''
                    INSERT INTO geo_fixpoints
                    (fixpoint_id, fixpoint_name, fixpoint_type, latitude, longitude, region)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (
                    fixpoint_id,
                    props.get('NAME'),
                    'WAYPOINT',
                    float(coords[1]),  # latitude
                    float(coords[0]),  # longitude
                    'RKRR'
                ))

                count += 1

            except Exception as e:
                continue

        conn.commit()
        print(f"  ✅ {count:3} 지점 마이그레이션 완료!")

    except Exception as e:
        print(f"  ❌ aip_fixpoints.geojson: {str(e)}")

def migrate_routes(conn):
    """항로 데이터 마이그레이션 (aip_routes.geojson → geo_routes)"""
    print("\n📍 항로 데이터 마이그레이션 중...")

    cursor = conn.cursor()
    geojson_path = AIRSPACE_DATA_DIR / 'aip_routes.geojson'

    if not geojson_path.exists():
        print(f"  ⚠️  파일 없음: aip_routes.geojson")
        return

    try:
        with open(geojson_path, 'r', encoding='utf-8') as f:
            geojson = json.load(f)

        cursor.execute('DELETE FROM geo_routes')

        count = 0
        for feature in geojson.get('features', []):
            try:
                props = feature.get('properties', {})
                geometry = feature.get('geometry', {})

                if geometry.get('type') != 'LineString':
                    continue

                coords = geometry.get('coordinates', [])
                if not coords:
                    continue

                route_id = props.get('ENR_NM') or props.get('NAME') or f"RT{count}"

                # GeoJSON LineString 생성
                geojson_linestring = json.dumps({
                    'type': 'LineString',
                    'coordinates': coords
                })

                # 경유지점 목록 추출
                waypoints = []

                cursor.execute('''
                    INSERT INTO geo_routes
                    (route_id, route_name, route_type, waypoint_sequence, geojson_linestring)
                    VALUES (?, ?, ?, ?, ?)
                ''', (
                    route_id,
                    props.get('NAME'),
                    'AIRWAY',
                    json.dumps(waypoints),
                    geojson_linestring
                ))

                count += 1

            except Exception as e:
                continue

        conn.commit()
        print(f"  ✅ {count:3} 항로 마이그레이션 완료!")

    except Exception as e:
        print(f"  ❌ aip_routes.geojson: {str(e)}")

def main():
    """메인 마이그레이션 함수"""
    print("=" * 80)
    print("🗺️  지도 서비스 지리정보 마이그레이션 시작")
    print("=" * 80)
    print(f"\n📂 소스 디렉토리: {AIRSPACE_DATA_DIR}")
    print(f"💾 대상 데이터베이스: {DB_PATH}\n")

    try:
        # DB 연결
        conn = init_db()

        # 각 데이터셋 마이그레이션
        migrate_coastlines(conn)
        migrate_sectors(conn)
        migrate_fixpoints(conn)
        migrate_routes(conn)

        # 마이그레이션 결과 확인
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM geo_coastlines')
        coastlines_count = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM geo_sectors')
        sectors_count = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM geo_fixpoints')
        fixpoints_count = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM geo_routes')
        routes_count = cursor.fetchone()[0]

        print("\n" + "=" * 80)
        print("✅ 마이그레이션 완료!")
        print("=" * 80)
        print(f"\n📊 결과 요약:")
        print(f"  • 해안선 레코드:  {coastlines_count:3}")
        print(f"  • 섹터 레코드:     {sectors_count:3}")
        print(f"  • 지점 레코드:     {fixpoints_count:3}")
        print(f"  • 항로 레코드:     {routes_count:3}")
        print()

        conn.close()
        return 0

    except Exception as e:
        print(f"\n❌ 오류 발생: {str(e)}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == '__main__':
    sys.exit(main())
