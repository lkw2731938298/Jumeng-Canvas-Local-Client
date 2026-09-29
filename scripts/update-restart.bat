@echo off
REM Update restart (ASCII-only + CRLF): stop server -> npm install -> start again.
REM Launched hidden by /api/local/update via start-desktop-hidden.vbs after files are replaced.
cd /d "%~dp0.."

if not exist "data\" mkdir data
set LOG=%CD%\data\desktop-start.log
echo [%date% %time%] update restart >> "%LOG%"

REM Let the update API finish its HTTP response first.
ping -n 3 127.0.0.1 >nul

set PORT=%JUMENG_DESKTOP_PORT%
if "%PORT%"=="" set PORT=3456
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr LISTENING') do (
  echo [%date% %time%] update: taskkill PID %%a >> "%LOG%"
  taskkill /F /T /PID %%a >nul 2>nul
)
ping -n 3 127.0.0.1 >nul

set "PORTABLE_NODE=%CD%\runtime\node\node.exe"
set "PORTABLE_NPM=%CD%\runtime\node\npm.cmd"
if exist "%PORTABLE_NODE%" (
  set "PATH=%CD%\runtime\node;%PATH%"
  set "NODE_EXE=%PORTABLE_NODE%"
  set "NPM_CMD=%PORTABLE_NPM%"
) else (
  set "NODE_EXE=node"
  set "NPM_CMD=npm"
)

echo [%date% %time%] update: npm install ... >> "%LOG%"
call "%NPM_CMD%" install >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [%date% %time%] ERROR: npm install failed during update >> "%LOG%"
  wscript //nologo "%~dp0desktop-alert.vbs" "Update: npm install failed. See data\desktop-start.log"
  exit /b 1
)

set NEXT_PUBLIC_LOCAL_DESKTOP=1
set NEXT_PUBLIC_ADMIN_AUTH_DISABLED=true
set JUMENG_DESKTOP_PORT=%PORT%
set JUMENG_DESKTOP_SILENT=1
REM The existing browser tab reloads itself; do not open another one.
set JUMENG_NO_OPEN_BROWSER=1

echo [%date% %time%] update: starting server >> "%LOG%"
call "%NODE_EXE%" scripts\start-browser.mjs >> "%LOG%" 2>&1
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo [%date% %time%] ERROR: restart exit %EXITCODE% >> "%LOG%"
  wscript //nologo "%~dp0desktop-alert.vbs" "Restart after update failed. See data\desktop-start.log"
)
exit /b %EXITCODE%
