@echo off
setlocal
title Samarth Care - Android SMS Relay
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.13 or newer, then open this file again.
  pause
  exit /b 1
)
echo Checking the paired USB phone and private relay settings...
call npm run phone:check
if errorlevel 1 (
  echo.
  echo Reconnect the phone, start SMS Gateway Local Server and check the setup above.
  pause
  exit /b 1
)
echo.
echo Processing only approved requests from Samarth Care through the selected SIM.
echo Keep this window and the phone connection open during the demonstration.
echo Close this window to stop processing new requests.
echo.
call npm run android:relay
if errorlevel 1 (
  echo.
  echo The relay stopped. Inspect its saved delivery status before requesting another SMS.
  pause
  exit /b 1
)
