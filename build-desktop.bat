@echo off
chcp 65001 >nul
title OMR Desktop - Build Installer
color 0B
echo ============================================
echo   OMR Desktop - Gerando instalador .exe
echo ============================================
echo.

where node >nul 2>&1 || (echo [ERRO] Node nao encontrado & pause & exit /b 1)

cd /d "%~dp0omr-app"
echo Instalando dependencias...
call npm install || (echo Falha no npm install & pause & exit /b 1)

echo Gerando build + installer...
call npm run electron:build || (echo Falha no build & pause & exit /b 1)

echo.
echo ============================================
echo   Instalador gerado em omr-app\dist_electron\
echo   Execute o .exe para instalar.
echo ============================================
pause
