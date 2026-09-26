@echo off
REM Backup diario do banco OMR (dump JSON portatil com rotacao de 30 dias).
REM Agende no Agendador de Tarefas do Windows (ver README, secao Backup).
cd /d "%~dp0"
if not exist backups mkdir backups
python backup.py --daily >> backups\backup.log 2>&1
