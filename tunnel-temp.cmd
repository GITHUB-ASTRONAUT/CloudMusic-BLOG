@echo off
chcp 65001 >nul
title PURPLE MUSIC - temporary public URL
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tunnel-temp.ps1" %*
echo.
echo Tunnel closed. Press any key to exit.
pause >nul
