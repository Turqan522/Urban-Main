@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required. Install Node.js and try again.
  pause
  exit /b 1
)
if not exist "node_modules\.bin\vinext.cmd" (
  call npm.cmd run install:ci
  if errorlevel 1 goto failed
)
call npm.cmd run build
if errorlevel 1 goto failed
call npm.cmd run setup:local
if errorlevel 1 goto failed
echo Open http://127.0.0.1:4173 in your browser. Keep this window open.
call npm.cmd start -- --port 4173
if errorlevel 1 goto failed
exit /b 0

:failed
echo Startup failed. See the error above.
pause
exit /b 1
