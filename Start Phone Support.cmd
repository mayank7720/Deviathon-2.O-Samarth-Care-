@echo off
setlocal
cd /d "%~dp0"
title Samarth Care - Incoming Phone Support
echo Starting the private incoming-SMS receiver.
echo Keep the paired phone and this window online.
echo Only signed care-related messages from the configured SIM are forwarded.
echo.
node scripts/phone-intake-receiver.mjs --check
if errorlevel 1 goto failed
node scripts/phone-intake-receiver.mjs --pair
if errorlevel 1 goto failed
node scripts/phone-intake-receiver.mjs --register
if errorlevel 1 goto failed
node scripts/phone-intake-receiver.mjs
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo Phone support could not start. Review the private configuration and local website.
pause
