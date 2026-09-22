@echo off
chcp 65001 >nul
title OMR System - Backend + Frontend
color 0A

echo ============================================
echo   OMR SYSTEM - Iniciando servicos
echo ============================================
echo.

REM --- Backend Python (porta 8010) ---
echo [1/2] Iniciando Backend Python (FastAPI)...
cd /d "%~dp0omr-backend"

REM Mata processos anteriores na porta 8010 (somente python/uvicorn)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8010" ^| findstr "LISTENING"') do (
    for /f "tokens=1" %%b in ('tasklist /fi "PID eq %%a" /fo csv /nh 2^>nul ^| findstr /i "python"') do (
        echo     Encerrando processo antigo PID %%a na porta 8010...
        taskkill /f /pid %%a >nul 2>&1
    )
)

REM Verifica python disponível
where python >nul 2>&1 || (echo [ERRO] python nao encontrado no PATH & pause & exit /b 1)

REM Usa .venv local (cria + instala deps se preciso)
if not exist "%~dp0omr-backend\.venv\Scripts\python.exe" (
    echo     Criando .venv do backend...
    python -m venv "%~dp0omr-backend\.venv" || (echo [ERRO] falha ao criar .venv & pause & exit /b 1)
)
echo     Instalando dependencias...
call "%~dp0omr-backend\.venv\Scripts\activate.bat"
pip install -r "%~dp0omr-backend\requirements.txt" || (echo [AVISO] falha parcial no pip - tentando continuar...)

start "OMR Backend" cmd /k "cd /d "%~dp0omr-backend" && .venv\Scripts\python main.py"

REM Espera o backend subir
echo     Aguardando backend (ate 20s)...
set "READY="
for /l %%i in (1,1,20) do (
    ping -n 1 -w 1000 127.0.0.1 >nul 2>&1
    curl -s http://localhost:8010/api/health >nul 2>&1 && set READY=1 && goto backend_up
)
:backend_up
if defined READY (
    echo     Backend OK em http://localhost:8010
) else (
    echo     [AVISO] Backend pode nao ter subido a tempo. Verifique a janela 'OMR Backend'.
)
echo.

REM --- Frontend React (porta 5173) ---
echo [2/2] Iniciando Frontend React (Vite)...
cd /d "%~dp0omr-app"
start "OMR Frontend" cmd /k "cd /d "%~dp0omr-app" && npm run dev"

echo.
echo ============================================
echo   Pronto! Abra no navegador:
echo     Frontend : http://localhost:5173
echo     Backend  : http://localhost:8010/api/health
echo ============================================
echo.
echo Acesso via celular (mesma Wi-Fi):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=* delims= " %%b in ("%%a") do (
        echo     Celular  : http://%%b:5173
        goto ip_done
    )
)
:ip_done
echo     Se a camera nao abrir no celular, ative em chrome://flags
echo     #unsafely-treat-insecure-origin-as-secure ou use ngrok http 5173
echo.
echo Fechar esta janela NAO fecha os servicos.
echo Para encerrar, feche as janelas 'OMR Backend' e 'OMR Frontend'.
echo.
pause