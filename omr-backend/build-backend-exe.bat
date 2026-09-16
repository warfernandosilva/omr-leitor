@echo off
chcp 65001 >nul
echo ============================================
echo   OMR Backend - PyInstaller
echo ============================================
echo.

set PY=python
where python >nul 2>&1 || set PY=python3
where %PY% >nul 2>&1 || set PY=py
where %PY% >nul 2>&1 || (echo [ERRO] Python nao encontrado & pause & exit /b 1)

echo Usando: %PY%
%PY% -m PyInstaller --version >nul 2>&1
if errorlevel 1 (
  echo Instalando pyinstaller...
  %PY% -m pip install pyinstaller
  if errorlevel 1 (echo Falha ao instalar pyinstaller & pause & exit /b 1)
)

echo Limpando builds antigos...
rmdir /s /q build 2>nul
rmdir /s /q dist 2>nul
del /q main.spec 2>nul
del /q build.log 2>nul

echo Gerando exe (pode levar 2-5 min na primeira vez)...
%PY% -m PyInstaller --noconfirm --onefile --name main --add-data "omr;omr" --hidden-import=psycopg --hidden-import=sqlalchemy --hidden-import=sqlalchemy.sql.default_comparator --hidden-import=cv2 --hidden-import=PIL --hidden-import=qrcode --hidden-import=reportlab --hidden-import=jose --hidden-import=bcrypt --hidden-import=multipart --hidden-import=pyzbar --hidden-import=pyzbar.pyzbar --collect-all reportlab --collect-all qrcode --collect-all pyzbar main.py > build.log 2>&1

if exist dist\main.exe (
  echo.
  echo ============================================
  echo   OK: dist\main.exe gerado
  echo   Agora: cd ..\omr-app ^&^& npm run electron:build
  echo ============================================
  type build.log
) else (
  echo.
  echo ============================================
  echo   FALHOU - veja build.log
  echo ============================================
  if exist build.log type build.log
  if not exist build.log echo Nenhum log - pyinstaller nem executou.
)
pause
