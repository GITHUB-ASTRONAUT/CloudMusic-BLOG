@echo off
chcp 65001 >nul
title PURPLE MUSIC - start
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
echo.
echo Press any key to close this window. The servers keep running in background.
pause >nul
