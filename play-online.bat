@echo off
rem The Other Side - run on this PC and share an internet link (no router setup needed)
cd /d "%~dp0"
title The Other Side - online

where node >nul 2>nul
if errorlevel 1 goto nonode

if exist node_modules goto run
echo Installing game files. This happens only the first time...
call npm install --omit=dev
if errorlevel 1 goto fail

:run
start "The Other Side - SERVER - keep this window open" cmd /k node server.js
timeout /t 2 /nobreak >nul
echo.
echo ================================================================
echo   Wait a few seconds. An address like
echo       https://something.trycloudflare.com
echo   will appear in the box below.
echo   Open it in your browser and send the same address to your friend.
echo   Keep BOTH black windows open while you play.
echo ================================================================
echo.
call npx --yes cloudflared tunnel --no-autoupdate --url http://localhost:3000
goto end

:nonode
echo.
echo [!] Node.js is not installed on this PC.
echo     Install the LTS version from https://nodejs.org
echo     then double-click this file again.
start "" https://nodejs.org
goto end

:fail
echo.
echo [!] Something went wrong while installing. Check your internet connection and try again.

:end
pause
