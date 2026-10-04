# Deploy no ZimaOS — Tailscale (principal) e Cloudflare Tunnel (alternativa)

Guia para publicar o **OMR Leitor** a partir do ZimaOS.

| Caminho | Endereço | Quem acessa | Exige domínio |
|---|---|---|---|
| **A. Tailscale** (recomendado) | `https://<zima>.<tailnet>.ts.net` | só você e quem você autorizar | **não** |
| **B. Cloudflare Tunnel** (alternativa) | `https://app.seudominio.com` | qualquer pessoa com o link | sim |

Em ambos os casos o app também fica disponível na **rede local** em `http://<ip-do-zima>:8080`.

Tempo estimado: ~15 min no caminho A; ~40–60 min no caminho B (a maior parte é propagação de DNS).

---

# Caminho A — Tailscale (recomendado)

Sem domínio, sem DNS, sem porta aberta no roteador. O Tailscale roda **no host do ZimaOS** e
publica o frontend com **HTTPS automático** — é esse HTTPS que libera a **câmera ao vivo** no celular.

## A0. Instalar a stack do app (no ZimaOS)

1. App Store → **Custom Install**.
2. Cole o conteúdo de **`docker-compose.zimaos-store.yml`** (imagens GHCR do backend/frontend + Postgres).
3. **Substitua os 3 marcadores `TRECHO_*` no próprio YAML** antes de colar (o ZimaOS **não** interpola variáveis — nem em `ports`, nem em `environment:`):
   - `TRECHO_SENHA_DO_POSTGRES_48_HEX` → **duas vezes** (serviço `db` e `DATABASE_URL` do backend; têm que ser idênticas);
   - `TRECHO_SEGREDO_JWT_64_HEX` → o segredo do JWT.
   Gere com `openssl rand -hex 24` / `openssl rand -hex 32` (ou o comando PowerShell no cabeçalho do YAML).
4. A porta já vem **literal** (`"8080:80"`). Se 8080 estiver ocupada, edite o número antes de colar e use o mesmo valor no `tailscale serve` (A3).
5. **Install → Start**. Aguarde ~1–2 min (o backend espera o Postgres subir).
6. **Confira:** `curl http://<ip-do-zima>:8080/api/health` → `{"status":"ok","db":"postgres",...}`. Se retornar **502**, o backend não subiu: veja o troubleshooting.

## A1. Instalar o Tailscale no ZimaOS

- **Opção 1 — App Store:** procure **Tailscale**, instale e abra uma vez.
- **Opção 2 — Terminal** (SSH ou terminal web em `http://<ip-do-zima>:7681/`):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

> Atalho: o script `zimaos-tailscale.sh` (neste repositório) faz o check/install/up/serve por você.

## A2. Autenticar e ativar o MagicDNS

```bash
tailscale up --accept-dns=true      # mostra uma URL de login; conclua no navegador
```

Depois, **uma vez**, no painel web do Tailscale: **DNS → MagicDNS → Enabled**. Isso dá o nome
`https://<zima>.<seu-tailnet>.ts.net` em vez de um IP `100.x` (que não tem HTTPS).

## A3. Publicar com HTTPS

```bash
tailscale serve --bg http://localhost:8080
```

Resposta esperada (URL varia):

```
Available within your tailnet:
https://zima-casa.tail1234.ts.net/
  └── proxying to http://localhost:8080
```

## A4. Acessar

1. No celular (e no PC), instale o app **Tailscale** e entre na **mesma conta/rede**.
2. Abra `https://<zima>.<seu-tailnet>.ts.net`.
3. Crie o primeiro usuário — ele vira **admin** automaticamente. Guarde bem essa conta.
4. Teste a **câmera ao vivo** em *Corrigir Cartão* (deve abrir a câmera; com `http://` cairia no fallback de upload).

## A5. Verificar

```bash
curl -fsS https://<zima>.<seu-tailnet>.ts.net/api/health   # deve retornar status ok + db
tailscale status                                          # devices conectados
```

## A6. Operação do dia a dia

- **Atualizar após nova versão:** no ZimaOS, pare e reinstale/atualize o app pelo Custom Install (as imagens `:latest` são republicadas pelo CI a cada push na `main` que passar nos testes).
- **Nunca apague o banco:** `docker compose down` **sem `-v`**. Os dados vivem nos volumes `pgdata` (Postgres), `omr-data` (uploads) e `omr-backups`.
- **Backup do app:** usuário admin → tela Admin → **Baixar backup** (dump JSON portátil). Guarde fora do servidor — o dump contém hashes de senha.
- **Tirar o app do ar no tailnet:** `tailscale serve --https=443 off` (ou `reset`).

### Avisos importantes (caminho A)

- **Não use `tailscale funnel`** — ele exporia o app na internet aberta. `serve` é rede privada.
- **ACLs:** por padrão o tailnet deixa todos os seus aparelhos acessarem a porta publicada (`8080`). Se compartilhar o node com outra conta Tailscale, essa pessoa alcança o app (mas precisa de usuário/senha).
- **`serve` não é proxy reverso de internet:** só quem está no tailnet chega no endereço `ts.net`.
- **`serve` aponta para `localhost:8080`:** se mudar `FRONTEND_PORT`, refaça `tailscale serve --bg http://localhost:<nova-porta>`.

## A7. Script auxiliar (`zimaos-tailscale.sh`)

Copie para o ZimaOS (ou rode do repositório clonado) e use:

```bash
./zimaos-tailscale.sh check     # o que já está instalado/configurado
./zimaos-tailscale.sh install   # instala o Tailscale (requer root)
./zimaos-tailscale.sh up        # autentica e mostra a URL de login
./zimaos-tailscale.sh serve     # publica com HTTPS e mostra a URL
./zimaos-tailscale.sh status    # URL + status + saúde da API
./zimaos-tailscale.sh doctor    # diagnóstico completo
```

---

# Caminho B — Cloudflare Tunnel (link público, com domínio)

Use se **outras pessoas precisam abrir o app sem instalar nada** (link público). Exige domínio
próprio — um endereço `sites.google.com/...` **não serve** para o túnel.

## B1. Domínio

1. Registre um domínio: para `.com.br`, use o **Registro.br** (~R$ 40–60/ano); para `.com`/alternativos, Cloudflare Registrar ou outro registrador.
2. Painel Cloudflare → **Add a domain** → o Cloudflare mostra **2 nameservers** (`xxx.ns.cloudflare.com`).
3. Troque os nameservers no registrador pelos 2 da Cloudflare (no Registro.br: conta → domínio → **DNS** → informe os 2 nameservers e salve).
4. Aguarde a zona ficar **Active**. Confira: https://www.whatsmydns.net → tipo `NS`.

## B2. Criar o túnel

1. Cloudflare **Zero Trust → Networks → Tunnels → Create tunnel → Cloudflared**, nome `zima-omr`.
2. Na tela **Install and run a connector**, **copie o token** (`CLOUDFLARE_TUNNEL_TOKEN`).
3. Aba **Public Hostnames → Add a public hostname**:
   - **Subdomain:** `app` (→ `app.seudominio.com`)
   - **Domain:** seu domínio
   - **Service Type:** `HTTP`
   - **URL:** `frontend:80`
4. **Save** — o CNAME no DNS é criado sozinho.

## B3. Instalar no ZimaOS

1. App Store → **Custom Install**.
2. Cole **`docker-compose.zimaos-cloudflare.yml`** (mesma stack + serviço `cloudflared`).
3. Preencha no formulário: `POSTGRES_PASSWORD`, `JWT_SECRET` e `CLOUDFLARE_TUNNEL_TOKEN`.
4. **Install → Start**. Verifique: `https://app.seudominio.com/api/health`.

> Se quiser os dois (Tailscale **e** link público), instale o `...zimaos-cloudflare.yml` e rode `tailscale serve --bg http://localhost:8080` — são complementares e não conflitam.

## B4. Botão no Google Sites (porta de entrada)

1. Abra seu site em `sites.google.com` → **Editar**.
2. **Inserir → Botão**, texto ex.: **"Abrir o corretor"**, link: `https://app.seudominio.com`.
3. **Publicar** e teste em aba anônima.

> Opcional: apontar `www.seudominio` para o próprio Sites em Sites → Configurações → **Domínios personalizados** (só se quiser aposentar o `sites.google.com`).

## B5. Cloudflare: regras recomendadas

- **Cache Rule "bypass" para `/api/*`** — a API nunca deve ser cacheada (a SPA já vem com `no-store`).
- **Não abra portas no roteador** — o túnel é de saída (funciona atrás de CGNAT/NAT duplo).
- Limite de upload do plano Free (100 MB) > restore 50 MB / nginx 55 MB — OK.
- (Opcional) **Cloudflare Access** para uma tela de e-mail OTP antes da app — só se quiser login duplo.

---

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `https://<zima>...ts.net` não abre (caminho A) | MagicDNS desligado ou app Tailscale fora | Ative DNS → MagicDNS; confira `tailscale status` no celular e no ZimaOS |
| `tailscale serve` não responde | Frontend não está na porta 8080 | `curl http://localhost:8080/api/health`; se mudar `FRONTEND_PORT`, refaça o `serve` |
| Tailscale pediu login de novo | Token expirado/revogado | `tailscale up` de novo e conclua a URL |
| Login "failed to fetch" no celular | Cache antigo ou DNS propagando | Limpe o cache / aguarde; teste `/api/health` no navegador do celular |
| Erro 1033 no domínio (caminho B) | Hostname não aponta para o túnel | Confira Public Hostname `app.seudominio.com → http://frontend:80` |
| **502** em `/api/health` (app abre, API muda) | Container do **backend** não subiu — quase sempre é YAML colado sem trocar os `TRECHO_*` (backend morre sem `JWT_SECRET`) ou Postgres unhealthy | No terminal do ZimaOS: `docker ps -a` e `docker logs <container-do-backend> --tail 50`. Reinstale o app com os marcadores substituídos |
| Login diz "Sem resposta da API em http://<ip>:8010" | Bundle antigo, com o palpite de porta 8010 embutido | Atualize a imagem (reinicie o app no Custom Install para puxar o `:latest` novo) e limpe o cache do navegador — a porta 8010 **não** é publicada; a API responde em `/api` do próprio frontend |
| `Invalid hostPort` ao instalar | ZimaOS não interpola variável em `ports` | Os YAMLs do ZimaOS já vêm com porta literal `8080:80` e **sem** interpolação; use esses arquivos (ou edite o número) em vez de `docker-compose.yml` |
| `cloudflared` reiniciando (caminho B) | Token com espaço/quebra | Recole o token limpo e reinstale |
| Túnel "Unhealthy" no dashboard (B) | QUIC/UDP bloqueado | O YAML já usa `--protocol http2`; veja o log do container |
| `Invalid hostPort: $FRONTEND_PORT` ao instalar | ZimaOS não interpola variável em `ports` | Os YAMLs do ZimaOS já vêm com a porta literal `8080:80`; use esses arquivos (ou edite o número) em vez de `docker-compose.yml` |
| `TRECHO_*` ficou no YAML após instalar | Marcador não substituído | Pare o app, corrija os 3 marcadores e reinstale. Senão o banco fica com senha "TRECHO..." e o backend não sobe |
| `POSTGRES_PASSWORD`/`JWT_SECRET` não aparecem no formulário | Formulário não detectou as variáveis | Substitua os marcadores `${...}` direto no YAML colado, antes de instalar |
| Porta 8080 em uso no ZimaOS | Conflito com outro app | Troque para `8081` no `ports` do YAML e refaça `tailscale serve --bg http://localhost:8081` |
| Câmera não abre (só upload) | Endereço sem HTTPS | Use `https://...ts.net` (A) ou `https://app.seudominio.com` (B) |

---

## Alternativa só-LAN (sem Tailscale nem Cloudflare)

Use `docker-compose.zimaos-store.yml` no Custom Install e acesse apenas `http://<ip-do-zima>:8080`.
Sem HTTPS, a **câmera ao vivo não funciona** (fallback de upload) e não há acesso remoto.