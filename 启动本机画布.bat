@echo off
REM ASCII-only + CRLF. UTF-8 Chinese / LF-only breaks cmd.exe.
cd /d "%~dp0"

if /I not "%~1"=="--hidden" (
  wscript //nologo "%~dp0scripts\start-desktop-hidden.vbs" "%~f0"
  exit /b 0
)

set NEXT_PUBLIC_LOCAL_DESKTOP=1
set NEXT_PUBLIC_ADMIN_AUTH_DISABLED=true
set JUMENG_DESKTOP_PORT=3456
set JUMENG_DESKTOP_SILENT=1

if not exist "data\" mkdir data
set LOG=%CD%\data\desktop-start.log
echo [%date% %time%] start silent >> "%LOG%"

set "PORTABLE_NODE=%CD%\runtime\node\node.exe"
set "PORTABLE_NPM=%CD%\runtime\node\npm.cmd"

if exist "%PORTABLE_NODE%" (
  set "PATH=%CD%\runtime\node;%PATH%"
  set "NODE_EXE=%PORTABLE_NODE%"
  set "NPM_CMD=%PORTABLE_NPM%"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [%date% %time%] ERROR: Node not found >> "%LOG%"
    wscript //nologo "%~dp0scripts\desktop-alert.vbs" "Node not found. Use the full package with runtime\node, or install Node.js LTS."
    exit /b 1
  )
  set "NODE_EXE=node"
  set "NPM_CMD=npm"
)

if not exist "node_modules\" (
  echo [%date% %time%] npm install ... >> "%LOG%"
  call "%NPM_CMD%" install >> "%LOG%" 2>&1
  if errorlevel 1 (
    echo [%date% %time%] ERROR: npm install failed >> "%LOG%"
    wscript //nologo "%~dp0scripts\desktop-alert.vbs" "npm install failed. See data\desktop-start.log"
    exit /b 1
  )
)

call "%NODE_EXE%" scripts\start-browser.mjs >> "%LOG%" 2>&1
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo [%date% %time%] ERROR: exit %EXITCODE% >> "%LOG%"
  wscript //nologo "%~dp0scripts\desktop-alert.vbs" "Start failed. See data\desktop-start.log"
)
exit /b %EXITCODE%