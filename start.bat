@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

echo ========================================
echo   ACC ATD v2 서버 시작
echo ========================================
echo.

:: 스크립트 위치로 이동
cd /d "%~dp0"

:: 포트 설정
set BACKEND_PORT=7300
set FRONTEND_PORT=7301

:: 기존 포트 사용 프로세스 종료
echo [1/3] 기존 프로세스 종료...
echo       포트 %BACKEND_PORT% 확인...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%BACKEND_PORT%" ^| findstr "LISTENING"') do (
    echo       PID %%a 종료 중...
    taskkill /F /PID %%a >nul 2>&1
)
echo       포트 %FRONTEND_PORT% 확인...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%FRONTEND_PORT%" ^| findstr "LISTENING"') do (
    echo       PID %%a 종료 중...
    taskkill /F /PID %%a >nul 2>&1
)
echo       완료
echo.

:: 폴더 확인
echo [2/3] 프로젝트 확인...
if not exist "app" (
    echo       [오류] app 폴더가 없습니다.
    pause
    exit /b 1
)
if not exist "app\node_modules" (
    echo       [오류] app\node_modules 폴더가 없습니다.
    echo       폐쇄망 환경에서는 node_modules가 포함된 배포본을 사용하세요.
    pause
    exit /b 1
)
if not exist "backend" (
    echo       [오류] backend 폴더가 없습니다.
    pause
    exit /b 1
)
if not exist "backend\node_modules" (
    echo       [오류] backend\node_modules 폴더가 없습니다.
    echo       폐쇄망 환경에서는 node_modules가 포함된 배포본을 사용하세요.
    pause
    exit /b 1
)
echo       완료
echo.

:: 서버 시작
echo [3/3] 서버 시작...
echo       Backend:  http://localhost:%BACKEND_PORT%
echo       Frontend: http://localhost:%FRONTEND_PORT%
echo.

:: 백엔드 서버를 새 창에서 시작
start "ACC ATD Backend" cmd /c "cd /d %~dp0backend && node api-server.js"

:: 잠시 대기 후 프론트엔드 시작
ping -n 3 127.0.0.1 >nul 2>&1

:: 프론트엔드 서버 시작
cd app
echo ========================================
echo   종료하려면 Ctrl+C 또는 stop.bat 실행
echo ========================================
echo.

npm run dev
