@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-backend.ps1"
exit /b %errorlevel%
