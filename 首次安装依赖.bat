@echo off
REM Install deps with portable Node (ASCII-only + CRLF).
cd /d "%~dp0"

set "PORTABLE_NODE=%CD%\runtime\node\node.exe"
set "PORTABLE_NPM=%CD%\runtime\node\npm.cmd"

if not exist "%PORTABLE_NODE%" (
  echo Portable Node missing. Trying system node to download...
  where node >nul 2>nul
  if errorlevel 1 (
    echo ERROR: Need runtime\node or a temporary system Node.
    echo Or use the full share zip that already includes runtime\node.
    pause
    exit /b 1
  )
  call node scripts\ensure-portable-node.mjs
  if errorlevel 1 (
    echo ERROR: failed to download portable Node
    pause
    exit /b 1
  )
)

set "PATH=%CD%\runtime\node;%PATH%"
echo Using: %PORTABLE_NODE%
call "%PORTABLE_NODE%" -v
echo Installing dependencies...
call "%PORTABLE_NPM%" install
if errorlevel 1 (
  echo ERROR: npm install failed
  pause
  exit /b 1
)
echo OK. Next: double-click the start bat.
pause