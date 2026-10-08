@echo off
rem Contoh: simulate.bat 5000 --name Budi --message "halo"
cd /d "%~dp0"
.venv\Scripts\python -m app.simulate %*
