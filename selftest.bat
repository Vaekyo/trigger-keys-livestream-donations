@echo off
rem Tes input keyboard + mouse di desktop (TUTUP Valorant dulu)
cd /d "%~dp0"
.venv\Scripts\python -m app.selftest
pause
