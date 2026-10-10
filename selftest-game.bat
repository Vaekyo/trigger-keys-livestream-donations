@echo off
rem Tes input di Valorant (Practice Range). Diagnosa saja, tidak mengakali apa pun.
cd /d "%~dp0"
.venv\Scripts\python -m app.selftest game
pause
