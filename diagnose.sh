#!/bin/bash

# Y711 FMS 포트 및 네트워크 진단 스크립트

echo "═══════════════════════════════════════════════════════════"
echo "  Y711 FMS 진단 도구"
echo "═══════════════════════════════════════════════════════════"
echo ""

# 1. 포트 확인
echo "🔍 [1/4] 포트 상태 확인..."
echo ""

echo "  포트 7300 상태:"
if lsof -i :7300 >/dev/null 2>&1; then
    echo "    ✅ 사용 중 (포트 7300이 점유됨)"
    lsof -i :7300 | tail -1
else
    echo "    ⚠️  사용 가능 (현재 사용되지 않음)"
fi

echo ""
echo "  포트 7301 상태:"
if lsof -i :7301 >/dev/null 2>&1; then
    echo "    ✅ 사용 중 (포트 7301이 점유됨)"
    lsof -i :7301 | tail -1
else
    echo "    ⚠️  사용 가능 (현재 사용되지 않음)"
fi

echo ""

# 2. 네트워크 확인
echo "🔍 [2/4] 네트워크 연결 확인..."
echo ""

echo "  localhost (127.0.0.1) 연결 테스트:"
if curl -s http://localhost:7301/ >/dev/null 2>&1; then
    echo "    ✅ 접속 가능"
else
    echo "    ❌ 접속 불가"
fi

echo ""

# 3. 외부 접속 확인
echo "🔍 [3/4] 외부 네트워크 확인..."
echo ""

if ping -c 1 8.8.8.8 >/dev/null 2>&1; then
    echo "  인터넷 연결: ✅ 정상"
else
    echo "  인터넷 연결: ❌ 불가"
fi

echo ""

# 4. 공유기 설정 확인
echo "🔍 [4/4] 로컬 IP 및 공유기 설정..."
echo ""

# macOS에서 IP 주소 가져오기
LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)

if [ -z "$LOCAL_IP" ]; then
    echo "  로컬 IP: ⚠️  감지 불가"
else
    echo "  로컬 IP: $LOCAL_IP"
    echo ""
    echo "  공유기 포트 포워딩 설정:"
    echo "    - 외부 포트: 7301"
    echo "    - 내부 포트: 7301"
    echo "    - 내부 IP: $LOCAL_IP"
fi

echo ""

# 5. 권장 조치
echo "═══════════════════════════════════════════════════════════"
echo "  📋 권장 조치"
echo "═══════════════════════════════════════════════════════════"
echo ""

if ! lsof -i :7301 >/dev/null 2>&1; then
    echo "  1️⃣  서버 시작:"
    echo "     ./start.sh"
    echo ""
fi

echo "  2️⃣  공유기 확인:"
echo "     192.168.0.1 또는 192.168.1.1 에서 포트 포워딩 설정"
echo "     - 외부 포트 7301 → 내부 포트 7301 (이 컴퓨터의 IP)"
echo ""

echo "  3️⃣  접속 테스트:"
echo "     로컬:   http://localhost:7301/"
echo "     외부:   http://ssenalabs.iptime.org:7301/"
echo ""

echo "  4️⃣  포트 변경이 필요하면:"
echo "     PORT=8080 node api-server.js"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo ""
