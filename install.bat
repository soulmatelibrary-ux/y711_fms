@echo off
chcp 65001 >nul 2>&1
cls
echo ================================================================================
echo   ACC ATD v2 - 초기 설정 (폐쇄망용)
echo ================================================================================
echo.

cd /d "%~dp0"

echo [1/4] 임베디드 Python 확인...
if not exist "python\python.exe" (
    echo.
    echo [오류] python\python.exe 파일이 없습니다.
    echo.
    echo 다음 단계를 수행하세요:
    echo   1. https://www.python.org/downloads/windows/ 접속
    echo   2. Python 3.13.x - Windows embeddable package (64-bit) 다운로드
    echo   3. zip 파일 내용을 python\ 폴더에 압축 해제
    echo      (python\python.exe 파일이 존재해야 함)
    echo.
    pause
    exit /b 1
)
echo   OK: python\python.exe 확인됨
echo.

echo [2/4] site-packages 활성화...
for %%f in (python\python*._pth) do (
    powershell -NoProfile -Command ^
        "(Get-Content '%%f') -replace '#import site', 'import site' | Set-Content '%%f'"
    echo   OK: %%f 업데이트됨
)
echo.

echo [3/4] pip 설치...
if exist "python\Scripts\pip.exe" (
    echo   OK: pip 이미 설치됨
) else (
    python\python.exe get-pip.py --no-index --find-links offline_packages\python_packages
    if errorlevel 1 (
        echo [오류] pip 설치 실패
        pause
        exit /b 1
    )
    echo   OK: pip 설치 완료
)
echo.

echo [4/4] Python 패키지 설치...
python\python.exe -m pip install ^
    --no-index ^
    --find-links offline_packages\python_packages ^
    -r backend\requirements.txt
if errorlevel 1 (
    echo [오류] 패키지 설치 실패
    pause
    exit /b 1
)
echo   OK: 모든 패키지 설치 완료
echo.

echo ================================================================================
echo   설정 완료. start.bat을 실행하여 서버를 시작하세요.
echo ================================================================================
echo.
pause
