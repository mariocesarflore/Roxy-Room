@echo off
chcp 65001 >nul
title Roxy Room x Vencord - Compilar, Instalar e Gerar Pacote dos Amigos
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-vencord.ps1"
if errorlevel 1 (
    echo.
    echo [ERRO] O processo encontrou um problema acima.
)
echo.
pause
