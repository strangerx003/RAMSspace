@echo off
title RAMSspace
cd /d "%~dp0"

echo ============================================
echo    RAMSspace - Starting
echo ============================================
echo.

REM Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed.
    echo Install LTS from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Install dependencies on first run
if not exist node_modules (
    echo Installing dependencies - first run only...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

REM Production build when missing
if not exist .next\standalone\server.js (
    echo Building production bundle - first run only...
    call npm run build
    if errorlevel 1 (
        echo [ERROR] Build failed.
        pause
        exit /b 1
    )
)

echo Starting RAMSspace on port 3000...
start "RAMspace" cmd /c "node .next\standalone\server.js"

echo Waiting for server...
set /a tries=0
:WAIT
powershell -Command "Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    set /a tries+=1
    if %tries% GEQ 30 (
        echo [ERROR] Server did not start. Check the RAMSspace window for errors.
        pause
        exit /b 1
    )
    timeout /t 2 /nobreak >nul
    goto WAIT
)

echo.
echo ============================================
echo    RAMspace is ready!
echo    http://localhost:3000
echo ============================================
echo.

start "" "http://localhost:3000"
exit /b 0
