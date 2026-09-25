@echo off
title OMR - Correcao de Cartoes-Resposta
echo ========================================
echo   OMR - Correcao de Cartoes-Resposta
echo ========================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado no PATH.
  echo Instale o Node 20+ em https://nodejs.org e rode de novo.
  pause
  exit /b 1
)

echo Iniciando servidor de desenvolvimento...
echo Acesse: http://localhost:5173
echo.
echo Pressione CTRL+C para parar o servidor.
echo.

cd /d "%~dp0omr-app"
npm run dev
pause
