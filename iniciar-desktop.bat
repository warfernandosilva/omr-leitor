@echo off
chcp 65001 >nul
title OMR Desktop - Electron
color 0B
echo ============================================
echo   OMR Desktop - Iniciando app Electron
echo ============================================
echo.

REM Verifica Node
where node >nul 2>&1 || (echo [ERRO] Node nao encontrado. Instale Node 20+ & pause & exit /b 1)
REM Verifica Python
where python >nul 2>&1 || where python3 >nul 2>&1 || (echo [ERRO] Python nao encontrado. Instale Python 3.10+ & pause & exit /b 1)

echo [1/2] Iniciando frontend Vite em segundo plano...
start "OMR Vite" cmd /k "cd /d "%~dp0omr-app" && npm run dev"

echo     Aguardando Vite (http://localhost:5173) ate 15s...
for /l %%i in (1,1,15) do (
  ping -n 1 -w 1000 127.0.0.1 >nul 2>&1
  curl -s http://localhost:5173 >nul 2>&1 && goto vite_up
)
:vite_up
echo     Vite OK.

echo [2/2] Abrindo app desktop (Electron)...
cd /d "%~dp0omr-app"
set ELECTRON_START_URL=http://localhost:5173
npx electron .

echo.
echo App fechado. Para encerrar o Vite, feche a janela "OMR Vite".
pause
