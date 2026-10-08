@echo off
cd /d "%~dp0"
if not exist .venv (
  echo [setup] membuat virtualenv...
  py -3 -m venv .venv || python -m venv .venv || (echo Python belum terinstall. Install Python 3.11+ dari python.org & pause & exit /b 1)
  .venv\Scripts\python -m pip install --upgrade pip >nul
  .venv\Scripts\python -m pip install -r requirements.txt || (pause & exit /b 1)
)
if not exist .env copy .env.example .env >nul
.venv\Scripts\python -m app
pause
