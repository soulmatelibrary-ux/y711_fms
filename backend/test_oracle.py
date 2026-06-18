# -*- coding: utf-8 -*-
"""Oracle DB 테스트 - EXFIXTIME 분석"""
import oracledb

ORACLE_CLIENT_PATH = r"C:\oraclexe\app\oracle\product\11.2.0\server\bin"
USER = "cssown"
PASSWORD = "cssadmin"
DSN = "127.0.0.1:1521/xe"

try:
    oracledb.init_oracle_client(lib_dir=ORACLE_CLIENT_PATH)
    conn = oracledb.connect(user=USER, password=PASSWORD, dsn=DSN)
    cursor = conn.cursor()

    # EXFIXTIME, EXFIXROUTE 컬럼 구조 확인
    print("=== EXFIXTIME/EXFIXROUTE 컬럼 정보 ===")
    cursor.execute("""
        SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH
        FROM USER_TAB_COLUMNS
        WHERE TABLE_NAME = 'ATFM_FLIGHTPLAN'
          AND COLUMN_NAME IN ('EXFIXTIME', 'EXFIXROUTE')
    """)
    for row in cursor.fetchall():
        print(f"  {row[0]}: {row[1]}({row[2]})")

    # EXFIXTIME, EXFIXROUTE 샘플 데이터
    print("\n=== EXFIXTIME/EXFIXROUTE 샘플 (RKSS/RKTU/RKJJ/RKJK -> RKPC) ===")
    cursor.execute("""
        SELECT CALLSIGN, DEPT_AIRPORT_CD, EOBT, EXFIXTIME, EXFIXROUTE
        FROM ATFM_FLIGHTPLAN
        WHERE DEPT_AIRPORT_CD IN ('RKSS', 'RKTU', 'RKJJ', 'RKJK')
          AND DEST_AIRPORT_CD = 'RKPC'
          AND ISOLD = 'F'
        ORDER BY EOBD DESC, EOBT DESC
    """)

    results = cursor.fetchall()
    print(f"조회 결과: {len(results)}건\n")

    for row in results[:10]:
        callsign = row[0] or ''
        dept = row[1] or ''
        eobt = str(row[2]) if row[2] else ''
        exfixtime = row[3] or ''
        exfixroute = row[4] or ''
        print(f"--- {callsign} ({dept}, EOBT:{eobt}) ---")
        print(f"  EXFIXTIME:  {exfixtime}")
        print(f"  EXFIXROUTE: {exfixroute}")
        print()

    cursor.close()
    conn.close()

except Exception as e:
    print(f"오류: {e}")
    import traceback
    traceback.print_exc()
