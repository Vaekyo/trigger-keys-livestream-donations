@echo off
cd /d "%~dp0"
if not exist .venv (
  echo [setup] membuat virtualenv...
  rem Prefer Python 3.13, 3.12 or 3.11, otherwise fall back to what is installed
  set "PY="
  for %%v in (3.13 3.12 3.11) do if not defined PY py -%%v -c "pass" >nul 2>&1 && set "PY=py -%%v"
  if not defined PY py -3 -c "pass" >nul 2>&1 && set "PY=py -3"
  if not defined PY set "PY=python"
  call echo [setup] pakai %%PY%%
  call %%PY%% -m venv .venv || (echo Python belum terinstall. Install Python 3.13 dari python.org & pause & exit /b 1)
  .venv\Scripts\python -m pip install --upgrade pip >nul
  .venv\Scripts\python -m pip install -r requirements.txt || (pause & exit /b 1)
)
if not exist .env copy .env.example .env >nul
.venv\Scripts\python -m app
pause
