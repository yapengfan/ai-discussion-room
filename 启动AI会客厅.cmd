@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22+ is required. Please install Node.js and try again.
  pause
  exit /b 1
)
set OPEN_ROOM=1
node server.mjs
if errorlevel 1 echo Startup failed. See the message above, then run this file again.
pause
