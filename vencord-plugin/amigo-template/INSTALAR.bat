@echo off
chcp 65001 >nul
title Roxy Room x Vencord - Instalador
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-amigo.ps1"
if errorlevel 1 (
    echo.
    echo [ERRO] A instalacao encontrou um problema acima.
)
echo.
pause
