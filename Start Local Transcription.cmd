@echo off
setlocal
title Samarth Care - Local Transcription
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.13 or newer, then open this file again.
  pause
  exit /b 1
)
powershell -NoProfile -Command "try { $result=Invoke-RestMethod -Uri 'http://127.0.0.1:8766/health' -TimeoutSec 4; if ($result.engine -eq 'faster-whisper') { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  echo The local transcription service is already running.
  echo Use Voice notes and transcripts in Samarth Care.
  pause
  exit /b 0
)
echo Starting the paired local speech service.
echo Keep this window open while transcribing consented audio.
echo Open Voice notes and transcripts in the local Samarth Care website.
echo.
call npm run speech:start
if errorlevel 1 (
  echo.
  echo The service could not start. Check the setup message above.
  pause
  exit /b 1
)
