#!/bin/bash

# Y711 FMS (Flow Management System) - Start Script

echo "=========================================="
echo "  Y711 FMS (Flow Management System)"
echo "=========================================="
echo ""

# Kill any existing process on port 7301
echo "[0/4] Checking for existing processes on port 7301..."
EXISTING_PID=$(lsof -ti :7301 2>/dev/null)
if [ ! -z "$EXISTING_PID" ]; then
    echo "   ⚠️  Found existing process (PID: $EXISTING_PID)"
    echo "   Terminating process..."
    kill -9 $EXISTING_PID 2>/dev/null
    sleep 1
    echo "   ✓ Process terminated"
fi

echo ""
# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "[1/4] Installing dependencies..."
    npm install
else
    echo "[1/4] node_modules already exists. Skipping install..."
fi

echo "[2/4] Building production files..."
npm run build

echo ""
echo "[3/4] Preparing environment..."
export PORT=7301
echo "   Port: $PORT"
echo "   Environment: Production"

echo ""
echo "[4/4] Starting Y711 FMS Server..."
echo ""
echo "============================================"
echo "✅ Local:    http://localhost:7301"
echo "✅ External: http://ssenalabs.iptime.org:7301/"
echo "============================================"
echo ""
echo "Press Ctrl+C to stop the server."
echo ""

# 빌드된 파일을 포트 7301에서 실행
PORT=7301 node api-server.js
