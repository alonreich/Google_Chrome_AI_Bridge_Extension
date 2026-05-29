@echo off
cd /d "%~dp0"
echo Starting Chrome Bridge server on http://127.0.0.1:5000
node server.js
pause
