@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

echo ========================================
echo   ACC ATD v2 서버 종료
echo ========================================
echo.

:: 포트 설정
set BACKEND_PORT=7300
set FRONTEND_PORT=7301

set FOUND=0

:: 백엔드 포트 종료
echo 백엔드 포트 %BACKEND_PORT% 종료 중...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%BACKEND_PORT%" ^| findstr "LISTENING"') do (
    echo   PID %%a 종료...
    taskkill /F /PID %%a >nul 2>&1
    set FOUND=1
)

:: 프론트엔드 포트 종료
echo 프론트엔드 포트 %FRONTEND_PORT% 종료 중...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%FRONTEND_PORT%" ^| findstr "LISTENING"') do (
    echo   PID %%a 종료...
    taskkill /F /PID %%a >nul 2>&1
    set FOUND=1
)

echo.
if !FOUND!==0 (
    echo 실행중인 서버가 없습니다.
) else (
    echo 서버가 종료되었습니다.
)

echo.
echo ========================================
pause
