#!/usr/bin/env sh
# Acesso privado ao OMR no ZimaOS via Tailscale (roda no HOST do ZimaOS, por SSH ou terminal web).
# A stack do app é a mesma: Custom Install com docker-compose.zimaos-store.yml (porta 8080).
# Este script só cuida do Tailscale: instala, autentica e publica o frontend com HTTPS.
#
# Uso: ./zimaos-tailscale.sh <comando>
#   check     mostra o que já existe (não altera nada)
#   install   instala o Tailscale no host (instalador oficial; requer root)
#   up        sobe o Tailscale e mostra a URL de login (ativa DNS Magic)
#   serve     publica o app em https://<host>.<tailnet>.ts.net -> http://localhost:$FRONTEND_PORT
#   unserve   remove a publicação HTTPS
#   status    mostra URL, status do túnel e saúde da API
#   doctor    diagnostico completo (Tailscale + porta + /api/health)
#
# Ative o MagicDNS uma vez no painel web do Tailscale (DNS -> MagicDNS -> Enabled).

set -eu

PORT="${FRONTEND_PORT:-8080}"
HEALTH="http://localhost:${PORT}/api/health"

ts() {
  if command -v tailscale >/dev/null 2>&1; then
    tailscale "$@"
  elif [ -x /usr/local/bin/tailscale ]; then
    /usr/local/bin/tailscale "$@"
  else
    echo "ERRO: tailscale nao instalado. Rode: $0 install" >&2
    exit 1
  fi
}

# Nome DNS desta maquina no tailnet (ex.: zima-casa.tail1234.ts.net)
self_dns() {
  ts status --json 2>/dev/null \
    | sed -n 's/.*"DNSName":"\([^"]*\)".*/\1/p' \
    | head -n 1
}

cmd_check() {
  echo "== Tailscale =="
  if command -v tailscale >/dev/null 2>&1; then
    echo "binario: $(command -v tailscale)"
  elif [ -x /usr/local/bin/tailscale ]; then
    echo "binario: /usr/local/bin/tailscale"
  else
    echo "binario: AUSENTE (rode: $0 install)"
  fi
  echo
  echo "== Servico =="
  if command -v systemctl >/dev/null 2>&1; then
    systemctl is-active tailscaled >/dev/null 2>&1 \
      && echo "tailscaled: ativo" \
      || echo "tailscaled: inativo (rode: $0 up)"
  else
    echo "systemctl: indisponivel neste host"
  fi
  echo
  echo "== App (porta ${PORT}) =="
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 5 "${HEALTH}" && echo \
      || echo "sem resposta em ${HEALTH} (o app esta instalado/rodando no ZimaOS?)"
  else
    echo "curl ausente; verifique a porta ${PORT} com: ss -ltn | grep :${PORT}"
  fi
}

cmd_install() {
  [ "$(id -u)" = "0" ] || { echo "ERRO: rode como root (sudo $0 install)" >&2; exit 1; }
  echo "Instalando o Tailscale pelo instalador oficial..."
  curl -fsSL https://tailscale.com/install.sh | sh
  echo
  echo "OK. Agora rode: sudo $0 up"
}

cmd_up() {
  echo "Ativando o Tailscale (vai exibir uma URL de login):"
  ts up --accept-dns=true || true
  echo
  echo "Se a URL de login nao aparecer, rode: sudo tailscale up --accept-dns=true"
  echo "Depois ative o MagicDNS no painel web do Tailscale (DNS -> MagicDNS)."
}

cmd_serve() {
  echo "Publicando http://localhost:${PORT} com HTTPS automatico..."
  ts serve --bg "http://localhost:${PORT}"
  dns="$(self_dns)"
  echo
  if [ -n "${dns}" ]; then
    echo "Acesso privado (privado no tailnet): https://${dns}"
  else
    echo "Acesso: https://<host>.<tailnet>.ts.net  (MagicDNS desligado? ative no painel web)"
  fi
  echo "LAN (mesma rede):     http://<ip-do-zima>:${PORT}"
  echo
  echo "Nao use 'tailscale funnel' aqui: o app ficaria publico na internet aberta."
}

cmd_unserve() {
  echo "Removendo a publicacao HTTPS do Tailscale..."
  ts serve --https=443 off 2>/dev/null || ts serve reset
  echo "OK."
}

cmd_status() {
  dns="$(self_dns)"
  [ -n "${dns}" ] && echo "URL:  https://${dns}" || echo "URL:  (sem DNS Magic ativo)"
  ts status 2>/dev/null | head -n 5 || true
  echo
  echo -n "API:  "
  curl -fsS --max-time 5 "${HEALTH}" 2>/dev/null || echo "sem resposta"
  echo
}

cmd_doctor() {
  cmd_check
  echo
  echo "== Serve =="
  ts serve status 2>/dev/null || echo "sem publicacao ativa (rode: $0 serve)"
  echo
  echo "== Dica camera =="
  echo "A camera ao vivo exige HTTPS: use https://<host>.<tailnet>.ts.net, nunca http://<ip>:${PORT}."
}

case "${1:-}" in
  check)   cmd_check ;;
  install) cmd_install ;;
  up)      cmd_up ;;
  serve)   cmd_serve ;;
  unserve) cmd_unserve ;;
  status)  cmd_status ;;
  doctor)  cmd_doctor ;;
  *)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac