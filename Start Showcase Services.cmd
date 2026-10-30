@echo off
setlocal
cd /d "%~dp0"
title SwasthSync - Showcase Services
echo Starting the paired phone and local transcription services.
echo No telephone call is placed by this launcher.
echo.
node scripts/showcase-services.mjs --start
echo.
echo Website: https://swasthsync.vercel.app/
echo Keep the laptop, USB phone and SMS Gateway running during the showcase.
pause
