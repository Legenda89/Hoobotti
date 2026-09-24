@echo off
title Hoobot dev
cd /d "%~dp0"
if not exist package.json (
  echo package.json puuttuu. Siirra tama .bat Hoobot14-kansioon.
  pause
  exit /b 1
)
echo.
echo Kehityspalvelin: http://localhost:5656
echo (Sulje ikkuna lopettaaksesi.)
echo.
npm run dev
pause
