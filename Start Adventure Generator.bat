@echo off
setlocal
title Adventure Generator
cd /d "%~dp0"

set "URL=http://localhost:7880"
rem Health checks use the IPv4 address: "localhost" tries IPv6 first and answers ~2 s late.
set "HEALTH=http://127.0.0.1:7880/api/health"
set "PNPM=npx --yes pnpm@12.15.0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node 24 or newer from https://nodejs.org and run this again.
  pause
  exit /b 1
)

rem Already running? Just open it.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%HEALTH%' | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo Adventure Generator is already running.
  start "" "%URL%"
  exit /b 0
)

rem Quick when nothing changed; picks up new dependencies after an update.
echo Installing dependencies...
call %PNPM% install
if errorlevel 1 goto failed

echo Building the web app...
call %PNPM% build
if errorlevel 1 goto failed

rem Open the browser once the server answers.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 60; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%HEALTH%' | Out-Null; Start-Process '%URL%'; break } catch { Start-Sleep -Seconds 1 } }"

echo.
echo Adventure Generator: %URL%
echo Close this window (or press Ctrl+C) to stop it.
echo.
call %PNPM% start
goto :eof

:failed
echo.
echo Something went wrong; see the messages above.
pause
exit /b 1
