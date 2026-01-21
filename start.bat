@echo off
setlocal
cd /d %~dp0

echo ==========================================
echo   Y711 FMS (Flow Management System)
echo ==========================================

IF NOT EXIST node_modules (
    echo [1/2] Installing dependencies...
    call npm install
) ELSE (
    echo [1/2] node_modules already exists. Skipping install...
    echo (Run 'npm install' manually if you have issues)
)

echo [2/2] Starting development server...
echo.
echo Please wait until the URL (e.g., http://localhost:7300) appears below.
echo Press Ctrl+C and follow prompts to stop the server.
echo.

call npm run dev

pause
