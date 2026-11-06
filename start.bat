@echo off
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" goto :run

echo [HUG-DB] Creating virtual environment (.venv)...
py -m venv .venv
if errorlevel 1 python -m venv .venv

echo [HUG-DB] Installing dependencies...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\pip.exe" install -r requirements.txt

:run
echo [HUG-DB] Starting HUG Card Database Management Tool (http://127.0.0.1:8000)...
start "" "http://127.0.0.1:8000"
".venv\Scripts\python.exe" -m uvicorn hugdb.main:app --host 127.0.0.1 --port 8000
pause
