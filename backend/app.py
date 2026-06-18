# -*- coding: utf-8 -*-
"""
ACC ATD v2 - Backend API Server
Oracle 11g 연결 지원
"""
import os
import sys
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

# 현재 디렉토리를 기준으로 .env 파일 로드
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

app = Flask(__name__)
CORS(app)

# DB 연결 인스턴스 (lazy initialization)
_db = None

def get_db():
    """Oracle DB 연결 인스턴스 반환 (싱글톤)"""
    global _db
    if _db is None:
        try:
            from db_connector import OracleDBConnector
            _db = OracleDBConnector()
            print("[INFO] Oracle DB 연결 성공")
        except Exception as e:
            print(f"[WARNING] Oracle DB 연결 실패: {e}")
            _db = None
    return _db


@app.route('/api/health', methods=['GET'])
def health_check():
    """서버 상태 확인"""
    db = get_db()
    db_status = "connected" if db and db.test_connection() else "disconnected"
    return jsonify({
        "status": "ok",
        "database": db_status
    })


@app.route('/api/db/test', methods=['GET'])
def test_db_connection():
    """DB 연결 테스트"""
    db = get_db()
    if db is None:
        return jsonify({
            "success": False,
            "message": "DB 연결이 초기화되지 않았습니다. .env 파일을 확인하세요."
        }), 500

    try:
        result = db.test_connection()
        return jsonify({
            "success": result,
            "message": "연결 성공" if result else "연결 실패"
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500


@app.route('/api/db/query', methods=['POST'])
def execute_query():
    """SQL 쿼리 실행 (SELECT만 허용)"""
    db = get_db()
    if db is None:
        return jsonify({"error": "DB 연결 없음"}), 500

    data = request.get_json()
    query = data.get('query', '').strip()

    # SELECT 쿼리만 허용
    if not query.upper().startswith('SELECT'):
        return jsonify({"error": "SELECT 쿼리만 허용됩니다"}), 400

    try:
        conn = db.get_connection()
        cursor = conn.cursor()
        cursor.execute(query)

        columns = [col[0] for col in cursor.description]
        results = [dict(zip(columns, row)) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return jsonify({
            "success": True,
            "columns": columns,
            "data": results,
            "count": len(results)
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


if __name__ == '__main__':
    host = os.getenv('FLASK_HOST', '0.0.0.0')
    port = int(os.getenv('FLASK_PORT', 7300))
    debug = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'

    print(f"""
================================================================================
  ACC ATD v2 - Backend API Server
================================================================================
  URL: http://localhost:{port}
  Debug: {debug}
================================================================================
""")

    app.run(host=host, port=port, debug=debug)
