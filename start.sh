#!/bin/bash

# Y711 FMS (Flow Management System) - macOS Start Script

echo "=========================================="
echo "  Y711 FMS (Flow Management System)"
echo "=========================================="
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "[1/2] Installing dependencies..."
    npm install
else
    echo "[1/2] node_modules already exists. Skipping install..."
    echo "(Run 'npm install' manually if you have issues)"
fi

echo "[2/2] Starting development server..."
echo ""
echo "Please wait until the URL (e.g., http://localhost:7300) appears below."
echo "Press Ctrl+C to stop the server."
echo ""

npm run dev
