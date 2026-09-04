@echo off
chcp 65001 >nul
title PURPLE MUSIC - stop
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1" %*
echo.
echo Press any key to close this window.
pause >nul
