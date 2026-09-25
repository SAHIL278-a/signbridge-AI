@echo off
cd /d "%~dp0"
start "SignBridge API" cmd /k "python backend\app.py 8000"
start "SignBridge Frontend" cmd /k "python -m http.server 8080 --directory frontend"
timeout /t 2 >nul
start http://localhost:8080
