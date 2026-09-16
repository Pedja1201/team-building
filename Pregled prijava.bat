@echo off
cd /d "%~dp0"
python registrations_gui.py
if errorlevel 1 pause
