@echo off
REM Stop local harness (ASCII-only + CRLF).
cd /d "%~dp0"
set PORT=%JUMENG_DESKTOP_PORT%
if "%PORT%"=="" set PORT=3456

echo Stopping LISTENING on port %PORT% ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr LISTENING') do (
  echo   taskkill PID %%a
  taskkill /F /PID %%a >nul 2>nul
)
echo Done.
pause