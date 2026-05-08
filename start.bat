@echo off
chcp 65001 >nul
title sing-box gateway

setlocal
set BASE=%~dp0
set PY=python
set CONFIG=%BASE%config.json
set IPS=%BASE%IP.txt

echo ============================================
echo   sing-box gateway
echo ============================================
echo.

if not exist "%BASE%sing-box.exe" (
    echo [ERROR] sing-box.exe not found:
    echo   %BASE%
    pause
    exit /b 1
)

echo [1/2] Generating config from IP.txt...
%PY% "%BASE%generate_config.py" --ip-file "%IPS%" --output "%CONFIG%" --port-map "%BASE%port-map.csv"
set GEN_EXIT=%ERRORLEVEL%

if "%GEN_EXIT%"=="0" goto START

if "%GEN_EXIT%"=="2" (
    echo [STOP] IP.txt is empty, missing, invalid, or all entries are expired.
    pause
    exit /b 0
)

if "%GEN_EXIT%"=="3" (
    echo [STOP] IP.txt has entries, but all proxy health checks failed.
    pause
    exit /b 0
)

echo [ERROR] Failed to generate config. Exit code: %GEN_EXIT%
pause
exit /b %GEN_EXIT%

:START
echo [2/2] Starting sing-box...
echo Use ports listed in port-map.csv.
echo Press Ctrl+C to stop.
echo.

"%BASE%sing-box.exe" run -c "%CONFIG%"
pause
