@echo off
chcp 65001 > nul
title Enviando Roxy Room para o GitHub...
echo ====================================================
echo       Enviando Roxy Room para o GitHub
echo ====================================================
echo.
echo Conectando ao repositorio: https://github.com/mariocesarflore/Roxy-Room.git
echo.
echo Se o navegador abrir pedindo login do GitHub, clique em 'Sign in with your browser' / 'Authorize'.
echo.
git push -u origin main
if %ERRORLEVEL% EQU 0 (
    echo.
    echo ====================================================
    echo   [SUCESSO] O codigo foi enviado para o GitHub!
    echo ====================================================
) else (
    echo.
    echo ====================================================
    echo   [ERRO] Ocorreu uma falha no envio.
    echo ====================================================
)
echo.
pause
