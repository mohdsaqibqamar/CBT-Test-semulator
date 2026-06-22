@echo off
title NEET/JEE CBT Mock Test Simulator
echo =======================================================
echo     NEET/JEE COMPUTER-BASED TEST (CBT) SIMULATOR
echo =======================================================
echo.
echo [1/2] Checking local directories...
if not exist "backend\app.py" (
    echo [ERROR] Backend folder structure not found! Please run inside the correct folder.
    pause
    exit /b 1
)

echo [2/2] Launching Local Server and App...
echo.
echo Server log stream:
echo -------------------------------------------------------
.\venv\Scripts\python.exe backend\app.py
echo -------------------------------------------------------
echo.
if %errorlevel% neq 0 (
    echo [ERROR] Application crashed or terminated with error code: %errorlevel%
    pause
)
