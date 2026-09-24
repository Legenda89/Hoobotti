@echo off
title Hoobot simulaatio
cd /d "%~dp0"
if not exist package.json (
  echo package.json puuttuu. Siirra tama .bat Hoobot14-kansioon.
  pause
  exit /b 1
)
echo.
echo Simulaatio-UI: http://localhost:5657
echo (Sulje ikkuna lopettaaksesi.)
echo.
npm run simulate:serve
pause
