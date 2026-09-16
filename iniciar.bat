@echo off
title OMR - Correcao de Cartoes-Resposta
echo ========================================
echo   OMR - Correcao de Cartoes-Resposta
echo ========================================
echo.

set "PATH=C:\Users\Intel\AppData\Local\Temp\opencode\node\node-v20.11.0-win-x64;%PATH%"

echo Iniciando servidor de desenvolvimento...
echo Acesse: http://localhost:5173
echo.
echo Pressione CTRL+C para parar o servidor.
echo.

cd /d "%~dp0omr-app"
npm run dev
pause
