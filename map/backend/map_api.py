"""
3D 지도 서비스 API
GeoJSON 형식의 지리정보 데이터를 제공하는 REST API
"""

from flask import Blueprint, request, jsonify
import json
import logging

# Flask Blueprint 생성 (다른 앱에서 import할 때 사용)
map_api = Blueprint('map_api', __name__, url_prefix='/api/map')

# 로거 설정
logger = logging.getLogger(__name__)


def create_map_routes(db_manager):
    """
    데이터베이스 매니저를 받아서 지도 API 라우트를 생성합니다.

    사용 방법:
        from map.backend.map_api import create_map_routes
        create_map_routes(db_manager)
    """

    @map_api.route('/geo/coastlines', methods=['GET'])
    def get_coastlines():
        """해안선 & 경계 데이터 제공 (GeoJSON FeatureCollection)"""
        try:
            regions_param = request.args.get('regions', 'korea,japan,china,northkorea,east-asia')
            regions = [r.strip() for r in regions_param.split(',')]
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            features = []

            for region in regions:
                cursor.execute('''SELECT id, region_name, region_type, geojson_coordinates, feature_properties
                    FROM geo_coastlines WHERE region_name = ?''', (region,))
                row = cursor.fetchone()
                if row:
                    try:
                        coords = json.loads(row[3])
                        feature_props = json.loads(row[4]) if row[4] else []

                        if isinstance(coords, list) and len(coords) > 0:
                            for idx, polygon in enumerate(coords):
                                polygon_coords = polygon
                                props_data = feature_props[idx] if idx < len(feature_props) else {}

                                region_label = props_data.get('NAME_1') or \
                                              props_data.get('nam') or \
                                              props_data.get('nam_ja') or \
                                              props_data.get('name') or \
                                              props_data.get('shapeName') or \
                                              f"{row[1]}_{idx}"

                                feature = {
                                    'type': 'Feature',
                                    'geometry': {'type': 'Polygon', 'coordinates': polygon_coords},
                                    'properties': {
                                        'region_name': row[1],
                                        'region_label': region_label,
                                        'region_type': row[2],
                                        'properties': props_data
                                    }
                                }
                                features.append(feature)
                    except (json.JSONDecodeError, IndexError, TypeError) as e:
                        logger.warning(f"Error processing coastline {region}: {e}")
                        continue

            conn.close()
            return jsonify({'type': 'FeatureCollection', 'features': features}), 200

        except Exception as e:
            logger.error(f"Failed to get coastlines: {e}")
            return jsonify({'status': 'error', 'message': 'Failed to retrieve coastline data'}), 500


    @map_api.route('/geo/sectors', methods=['GET'])
    def get_sectors():
        """통제 섹터 데이터 제공 (GeoJSON FeatureCollection)"""
        try:
            alt_min = request.args.get('altitude_min', type=int, default=0)
            alt_max = request.args.get('altitude_max', type=int, default=999999)
            conn = db_manager.get_connection()
            cursor = conn.cursor()

            cursor.execute('''SELECT id, sector_id, sector_name, boundary_points, geojson_polygon,
                       altitude_start, altitude_end, controller_unit, frequency_vhf
                FROM geo_sectors
                WHERE altitude_start <= ? AND altitude_end >= ?
                ORDER BY sector_id''', (alt_max, alt_min))

            rows = cursor.fetchall()
            features = []

            for row in rows:
                try:
                    geojson_polygon = json.loads(row[4]) if row[4] else None
                    feature = {
                        'type': 'Feature',
                        'geometry': geojson_polygon,
                        'properties': {
                            'sector_id': row[1],
                            'sector_name': row[2],
                            'altitude_start': row[5],
                            'altitude_end': row[6],
                            'controller_unit': row[7],
                            'frequency_vhf': row[8]
                        }
                    }
                    features.append(feature)
                except (json.JSONDecodeError, TypeError):
                    continue

            conn.close()
            return jsonify({'type': 'FeatureCollection', 'features': features}), 200

        except Exception as e:
            logger.error(f"Failed to get sectors: {e}")
            return jsonify({'status': 'error', 'message': 'Failed to retrieve sector data'}), 500


    @map_api.route('/geo/fixpoints', methods=['GET'])
    def get_fixpoints():
        """항로 지점 데이터 제공 (GeoJSON FeatureCollection)"""
        try:
            types_param = request.args.get('types', '')
            limit = request.args.get('limit', type=int, default=500)
            conn = db_manager.get_connection()
            cursor = conn.cursor()

            sql = '''SELECT id, fixpoint_id, fixpoint_name, fixpoint_type,
                       latitude, longitude, elevation_ft, frequency_khz, region
                FROM geo_fixpoints'''
            params = []

            if types_param:
                types_list = [t.strip() for t in types_param.split(',')]
                placeholders = ','.join('?' * len(types_list))
                sql += f' WHERE fixpoint_type IN ({placeholders})'
                params.extend(types_list)

            sql += f' LIMIT {limit}'
            cursor.execute(sql, params)
            rows = cursor.fetchall()
            features = []

            for row in rows:
                feature = {
                    'type': 'Feature',
                    'geometry': {'type': 'Point', 'coordinates': [float(row[5]), float(row[4])]},
                    'properties': {
                        'fixpoint_id': row[1],
                        'fixpoint_name': row[2],
                        'fixpoint_type': row[3],
                        'elevation_ft': row[6],
                        'frequency_khz': row[7],
                        'region': row[8]
                    }
                }
                features.append(feature)

            conn.close()
            return jsonify({'type': 'FeatureCollection', 'features': features}), 200

        except Exception as e:
            logger.error(f"Failed to get fixpoints: {e}")
            return jsonify({'status': 'error', 'message': 'Failed to retrieve fixpoint data'}), 500


    @map_api.route('/geo/routes', methods=['GET'])
    def get_routes():
        """표준 항로 데이터 제공 (GeoJSON FeatureCollection)"""
        try:
            types_param = request.args.get('types', '')
            limit = request.args.get('limit', type=int, default=200)
            conn = db_manager.get_connection()
            cursor = conn.cursor()

            sql = '''SELECT id, route_id, route_name, route_type, waypoint_sequence, geojson_linestring
                FROM geo_routes'''
            params = []

            if types_param:
                types_list = [t.strip() for t in types_param.split(',')]
                placeholders = ','.join('?' * len(types_list))
                sql += f' WHERE route_type IN ({placeholders})'
                params.extend(types_list)

            sql += f' LIMIT {limit}'
            cursor.execute(sql, params)
            rows = cursor.fetchall()
            features = []

            for row in rows:
                try:
                    geojson_linestring = json.loads(row[5]) if row[5] else None
                    waypoints = json.loads(row[4]) if row[4] else []
                    feature = {
                        'type': 'Feature',
                        'geometry': geojson_linestring,
                        'properties': {
                            'route_id': row[1],
                            'route_name': row[2],
                            'route_type': row[3],
                            'waypoints': waypoints
                        }
                    }
                    features.append(feature)
                except (json.JSONDecodeError, TypeError):
                    continue

            conn.close()
            return jsonify({'type': 'FeatureCollection', 'features': features}), 200

        except Exception as e:
            logger.error(f"Failed to get routes: {e}")
            return jsonify({'status': 'error', 'message': 'Failed to retrieve route data'}), 500

    return map_api
