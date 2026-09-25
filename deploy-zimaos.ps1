# Deploy do OMR Leitor no ZimaOS via SSH (build local no servidor).
# Uso: .\deploy-zimaos.ps1 [-ZimaHost 192.168.1.219] [-ZimaUser root] [-RemoteDir /DATA/AppData/omr-leitor] [-SkipBuild]
# Pré-requisitos no PC: OpenSSH (scp/ssh) + tar (padrão no Windows 10+).

param(
  [string]$ZimaHost = "192.168.1.219",
  [int]$SshPort = 22,
  [string]$ZimaUser = "root",
  [string]$RemoteDir = "/DATA/AppData/omr-leitor",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Target = "$ZimaUser@$ZimaHost"
$SshOpts = @("-p", $SshPort)
# A senha do ZimaOS será pedida no terminal a cada conexão SSH (3x).
# Alternativa sem SSH direto: suba os arquivos pelo app Files do ZimaOS
# e rode os comandos do passo 2/3 no terminal web http://192.168.1.219:7681/

Write-Host "== 1/3 Enviando codigo para ${Target}:${RemoteDir} ..." -ForegroundColor Cyan
# Leva compose + Dockerfiles + código, sem .git / node_modules / builds / dados locais.
# O .env (senhas) vai junto; se preferir, crie-o depois no servidor.
$tarArgs = @(
  "-C", $ProjectDir, "-cf", "-",
  "--exclude=.git", "--exclude=node_modules", "--exclude=dist",
  "--exclude=__pycache__", "--exclude=*.pyc",
  "--exclude=omr-backend/data", "--exclude=*.db",
  "docker-compose.yml", ".env", "omr-app", "omr-backend"
)
$sshMkdir = "mkdir -p $RemoteDir && tar -xf - -C $RemoteDir"
tar @tarArgs | ssh @SshOpts $Target $sshMkdir

Write-Host "== 2/3 Build + subida no ZimaOS ..." -ForegroundColor Cyan
$remoteScript = @"
set -e
cd $RemoteDir
[ -f .env ] || { echo 'ERRO: .env nao encontrado em $RemoteDir'; exit 1; }
docker compose build
docker compose up -d
"@
ssh @SshOpts $Target $remoteScript

if ($SkipBuild) { exit 0 }

Write-Host "== 3/3 Aguardando saude dos servicos ..." -ForegroundColor Cyan
$checkScript = @"
cd $RemoteDir
for i in `$(seq 1 24); do
  if curl -sf http://localhost:8080/api/health >/dev/null; then echo 'HEALTHY'; break; fi
  sleep 10
done
curl -s http://localhost:8080/api/health; echo
docker compose ps
"@
ssh @SshOpts $Target $checkScript

Write-Host "OK! Acesse http://192.168.1.219:8080" -ForegroundColor Green
