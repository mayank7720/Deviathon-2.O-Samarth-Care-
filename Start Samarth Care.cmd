@echo off
setlocal
title Samarth Care - Supabase Sign-in
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.13 or newer, then open this file again.
  pause
  exit /b 1
)
echo Checking whether Samarth Care is already running...
powershell -NoProfile -Command "try { $result=Invoke-RestMethod -Uri 'http://127.0.0.1:5173/api/auth' -TimeoutSec 4; if ($result.authMode -eq 'supabase') { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  echo Samarth Care is already running with Supabase sign-in.
  start "" "http://127.0.0.1:5173/"
  exit /b 0
)
if not exist "node_modules\vinext" (
  echo Installing application dependencies...
  call npm ci
  if errorlevel 1 goto failed
)
echo Preparing the Supabase sign-in configuration...
call npm run supabase:configure
if errorlevel 1 goto failed
echo.
echo Open the Local URL printed below in your browser.
echo Sign in with your assigned account, then select a role.
echo Keep this window open while demonstrating Samarth Care.
echo.
call npm run dev:supabase -- --host 127.0.0.1 --port 5173
exit /b %errorlevel%
:failed
echo.
echo Setup could not finish. The error above identifies the failed step.
pause
exit /b 1
