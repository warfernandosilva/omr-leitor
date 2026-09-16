# Plano: Migrar OMR para Python Backend + React Frontend

## Arquitetura Final

```
omr-app/                  (React frontend — mantido, atualizado)
  src/
    pages/GenerateCardPage.tsx   → renderiza novo layout (DICT_4X4_50, 110px)
    pages/CorrectCardPage.tsx    → envia imagem para Python API
    utils/api.ts                 → novo: chamadas REST ao backend

omr-backend/               (Python — NOVO)
  main.py                  → FastAPI server
  omr/
    template.py            → gera cartão A4 (PDF/PNG) com ArUco 4x4
    detector.py            → detecta ArUco DICT_4X4_50 (IDs 0-3)
    reader.py              → lê bolhas após warp perspective
    grading.py             → compara respostas com gabarito
  requirements.txt
```

## Fase 1: Backend Python (omr-backend/)

### 1.1 Setup
- Criar `omr-backend/` ao lado de `omr-app/`
- `pip install fastapi uvicorn opencv-python numpy reportlab Pillow`
- Criar `requirements.txt`

### 1.2 `omr/template.py` — Gerador de Cartão
- Canvas A4 = 2480×3508 px (300 DPI)
- 4 marcadores ArUco DICT_4X4_50, IDs 0-3, tamanho ~110×110 px
  - ID 0: canto superior-esquerdo (~90px das bordas)
  - ID 1: canto superior-direito
  - ID 2: canto inferior-direito
  - ID 3: canto inferior-esquerdo
- Caixas Aluno/Turma conforme spec (x≈90-1520, y≈155-330)
- Linha divisória vertical x≈810 (y≈700 até y≈2020)
- Títulos "PORTUGUÊS" (x≈550, y≈590) e "MATEMÁTICA" (x≈1160, y≈590)
- Headers A B C D (y≈660)
- 22 questões por matéria, bolhas com:
  - Português: A≈395, B≈495, C≈595, D≈695
  - Matemática: A≈1005, B≈1105, C≈1205, D≈1305
  - Y inicial ≈745, espaçamento ≈66px, raio ≈20px
- Funções: `generate_png()`, `generate_pdf()`

### 1.3 `omr/detector.py` — Detector ArUco
- Usa `cv2.aruco.DICT_4X4_50`
- `detect_markers(image)` → retorna 4 centros (TL, TR, BR, BL)
- Valida geometria: convexidade, proporção, tamanho mínimo
- Retorna corners detectados + centros

### 1.4 `omr/reader.py` — Leitor OMR
Pipeline:
1. Detectar 4 ArUco → extrair cantos
2. `cv2.getPerspectiveTransform` + `cv2.warpPerspective` → imagem retificada (2480×3508)
3. Para cada uma das 44 questões × 4 bolhas:
   - Extrair ROI circular (raio≈20px)
   - Binarizar (Otsu ou threshold fixo)
   - Calcular intensidade média / proporção de pixels escuros
4. Score composto (como no TS): intensidade, darkRatio, contrast
5. Classificar: marcada (>40%), em branco, dupla marcação
6. Retornar `OMRResult`

### 1.5 `omr/grading.py` — Correção
- Recebe respostas lidas + gabarito
- Calcula acertos/erros/em branco/dupla por matéria
- Nota conforme escala (0-10, 0-100, count)

### 1.6 `main.py` — API FastAPI
Endpoints:
- `POST /api/omr/process` — recebe imagem (multipart), retorna JSON com respostas
- `POST /api/card/generate` — recebe dados do exame, retorna PDF do cartão
- `GET /api/health` — status

CORS habilitado para `localhost:5173` (Vite dev server).

## Fase 2: Atualizar React Frontend

### 2.1 `src/utils/api.ts` — Novo
- `processImage(file: File)` → POST multipart para Python API
- `generateCard(data)` → POST para gerar PDF
- URL base: `http://localhost:8000`

### 2.2 `src/pages/GenerateCardPage.tsx` — Atualizar
- Trocar renderização DOM por chamada à API Python que gera o PDF
- Ou manter renderização local mas com novas coordenadas do spec
- Marcadores ArUco 4x4 (IDs 0-3) em 110px ao invés de 7x7 (IDs 10-13) em 210px

### 2.3 `src/pages/CorrectCardPage.tsx` — Atualizar
- Substituir chamada `processImage()` do `omr-engine.ts` por chamada à API Python
- Enviar imagem como FormData multipart
- Receber JSON com respostas

### 2.4 `src/utils/omr-engine.ts` — Remover ou manter como fallback
- O engine TS puro pode ficar como fallback offline
- Mas o fluxo principal será via Python API

## Fase 3: Layout do Cartão (coordenadas exatas do spec)

| Elemento | Coordenadas |
|----------|------------|
| Canvas | 2480 × 3508 px (A4 300 DPI) |
| ArUco markers | ~110×110 px, ~90px das bordas |
| ID 0 (TL) | centro ≈ (145, 145) |
| ID 1 (TR) | centro ≈ (2335, 145) |
| ID 2 (BR) | centro ≈ (2335, 3363) |
| ID 3 (BL) | centro ≈ (145, 3363) |
| Aluno box | x: 90-1520, y: 155-235 |
| Turma box | x: 90-810, y: 250-330 |
| Divisor | x≈810, y: 700-2020 |
| Título PORT | x≈550, y≈590 |
| Título MAT | x≈1160, y≈590 |
| Headers ABCD | y≈660 |
| Q1 y | ≈745 |
| Espaçamento | ≈66px entre questões |
| Raio bolha | ≈20px |
| PORT A/B/C/D x | 395/495/595/695 |
| MAT A/B/C/D x | 1005/1105/1205/1305 |

## Ordem de Implementação

1. Instalar dependências Python (`pip install fastapi uvicorn pillow reportlab`)
2. Criar `omr-backend/omr/template.py` — gerar cartão PNG
3. Criar `omr-backend/omr/detector.py` — detectar ArUco 4x4
4. Criar `omr-backend/omr/reader.py` — ler bolhas pós-warp
5. Criar `omr-backend/omr/grading.py` — corrigir
6. Criar `omr-backend/main.py` — FastAPI
7. Testar backend isoladamente (gerar cartão → preencher → foto → processar)
8. Criar `omr-app/src/utils/api.ts` — chamadas REST
9. Atualizar `GenerateCardPage.tsx` — novo layout
10. Atualizar `CorrectCardPage.tsx` — usar Python API
11. Teste end-to-end

## Verificação
- Gerar cartão PNG → verificar que ArUco são detectáveis
- Preencher cartão manualmente → tirar foto → processar → verificar respostas
- Rodar todos os testes legacy do TS (omr-synthetic, omr-real-card) para garantir que o fallback funciona
- Teste end-to-end: criar prova → gerar cartão → preencher → foto → corrigir → ver resultado
