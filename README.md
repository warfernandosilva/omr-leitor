# OMR Correção — Cartões-resposta A4 (1448×2048, ArUco DICT_4X4_50)

![CI](https://github.com/warfernandosilva/omr-leitor/actions/workflows/ci.yml/badge.svg)

Sistema de correção de cartões-resposta com marcadores ArUco, QR por aluno e leitura por câmera. Frontend React + Vite, backend FastAPI + OpenCV.

## Pré-requisitos
- Node 20+ (`node -v`)
- Python 3.10+ (`python --version`)
- Postgres opcional (senão usa SQLite `omr-backend/data/omr.db`)

## Quick start (dev)
```bat
:: Web (navegador) - 2 terminais ou use start-omr.bat
start-omr.bat
:: abre http://localhost:5173  e  http://localhost:8010/api/health
:: no celular mesma Wi-Fi: http://<IP-DO-PC>:5173  (IP mostrado no .bat)

:: Desktop Electron (dev)
cd omr-app
npm install
npm run dev              # terminal 1: Vite 5173
npm run electron:dev     # terminal 2: Electron -> http://localhost:5173 (spawn backend python)
:: ou atalho:
iniciar-desktop.bat
```

## Como usar
1. **Login** — primeiro usuário vira `admin`.
2. **Nova Prova** — define `PORTUGUÊS/MATEMÁTICA`, `questões/disciplina` (22 padrão), `escala 0-10`.
3. **Cadastrar Gabarito** — informe A/B/C/D por questão.
4. **Importar Alunos** (`xlsx` com coluna `Nome`) → **Gerar gabaritos** → **Baixar PDF** (reportlab, 1 página por aluno com QR `OMR-AAAA-NNNNNN` + ArUco 4 cantos).
5. **Imprimir** a 100% (sem “fit to page”), papel branco fosco, laser 300dpi.
6. **Corrigir Cartão** — `Capturar com Câmera` ou `Enviar Imagem` (boa luz, cartão plano, 4 cantos visíveis). Overlay verde=acerto, vermelho=erro, laranja=duplicada (retificada `1448×2048`).
7. **Resultados / Dashboard** — ranking, média/mediana, histograma 0-10, acerto por questão, export CSV/XLSX.

## Gerar .exe

### A) Instalador com backend junto (offline total, recomendado)
```bat
cd omr-backend
build-backend-exe.bat   :: PyInstaller --onefile → dist\main.exe (log em build.log)
cd ..\omr-app
npm run electron:build  :: vite build + electron-builder --win --x64
:: saída: omr-app/dist_electron/OMR Correcao Setup 0.0.0.exe
```
`extraResources` (`package.json:build.extraResources`) embute `dist/main.exe` em `resources/backend/`; `electron/main.cjs` spawna o `.exe` quando `app.isPackaged`.

### B) Portable sem instalador
Em `package.json:build.win.target` troque `nsis` por `portable` e `npm run electron:build` → `OMR Correcao 0.0.0.exe` solto.

### C) Sem empacotar backend (requer Python no destino)
Use `iniciar-desktop.bat` ou distribua com `start-omr.bat` — o Electron em dev spawna `python main.py`.

## Banco de dados
- `DATABASE_URL` em `omr-backend/.env` → Postgres (`postgresql+psycopg://postgres:senha@localhost:5432/omr`). Se vazio, cai em `omr-backend/data/omr.db` SQLite (veja `database.py:19`, `DB_LABEL` em `GET /api/health`).
- Para multi-PC compartilhem o mesmo Postgres; com SQLite cada PC é isolado — use `Export XLSX`.

## Troubleshooting
- **Tela branca no .exe** — faltava `vite.config.ts:base './'` (já corrigido); refaça `electron:build`.
- **Backend não empacotado** — rode `build-backend-exe.bat` antes de `electron:build`.
- **Celular não loga em 192.168.x.x** — libere firewall: `netsh advfirewall firewall add rule ... localport=8010/5173`, mesma Wi-Fi, e `CORS_ORIGIN_REGEX` em `main.py:50` já libera `192.168.*`.
- **Câmera ao vivo no celular (captura automática)** — o Chrome exige HTTPS: use `ngrok http 5173` no PC e abra a URL https no celular (o proxy `/api→8010` já funciona com host ngrok). Sem HTTPS, cai no fallback de upload (sem auto-captura). Na tela de correção: aponte para o cartão, aguarde travar (vibra+bip), confira a prévia e toque em Enviar.
- **Login via ngrok falha ("failed to fetch")** — checklist: 1) `ngrok http 5173` (não 8010); 2) backend `:8010` rodando (`/api/health` ok no PC); 3) URL https **do dia** + 'Visit Site' clicado; 4) use o botão **Testar conexão** na tela de login — ele diz se a API está alcançável. O app já envia `ngrok-skip-browser-warning` para liberar a API do aviso do ngrok.
- **Gabarito do PC não aparece no celular** — o servidor é a fonte oficial: cadastre o gabarito com backend rodando (a tela confirma "✔ Salvo no servidor"); no celular, abra **Corrigir Cartão** (puxa sozinho) ou toque **⟳ Atualizar do servidor**; use a **mesma conta** nos dois aparelhos (`/api/exams` filtra por dono).
- **Círculos desalinhados** — só a 1ª linha batia quando `questionsPerSubject !=22`; agora `CorrectCardPage.tsx:836` usa `questionYFor(n)` e `rectified_image` (`main.py:381`) para overlay 1:1.
- **Cache Electron** `Unable to create cache` — silenciado via `%TEMP%\omr-electron-userdata` em `electron/main.cjs`.

## Estrutura
```
omr-app/        # React + Vite + Tailwind, páginas Home/NewExam/Generate/Roster/Manage/RegisterKey/Correct/Results/Dashboard
omr-backend/omr/ # template.py (1448×2048), detector.py (ArUco), reader.py (CLAHE+blur 35), grading.py
start-omr.bat / iniciar.bat / iniciar-desktop.bat / build-desktop.bat
```
