# Levantamento — FormRead Answer Sheet Generator

Fonte: <https://formread.org/answer-sheet-generator> (acessado em 2026-11-03, deslogado, plano gratuito).
Método: navegação com Playwright, lendo a árvore de acessibilidade e o DOM do editor (classes `ss-*`).
Cobertura: todas as abas, grupos, inspetores e diálogos do gerador. Recursos pagos foram registrados pelo que a tela mostra; upload de PDF como fundo e importação de Excel não foram executados (só o aceite de arquivos foi verificado).

---

## 1. Modelo de negócio (o que é grátis e o que é pago)

| Recurso | Situação |
|---|---|
| Criar a folha, mexer no layout, importar lista, baixar PDF | **Grátis, sem conta** |
| "AI designer" (descrever a folha e a IA monta) | Pago — abre painel com paywall |
| "Create reading template" (folha vira template lido pelo FormRead: respostas, ID e QR em planilha) | Pago — abre paywall / pede login |
| Transcrição/nota de resposta escrita | Pago (mencionado no inspetor de Written answer) |

Textos de paywall observados:

- **AI sheet designer** — "Describe the sheet, the AI builds it". Exemplo: *"40 questions A to D in 2 columns, a 6-digit student ID and a QR code with each student's ID."* Promete: monta/corrige o layout, organiza lista colada em colunas, põe nomes e QR em cada folha. Rodapé: *"The generator itself is free: design, add your list and download the PDF without an account."*
- **Create reading template** — "Read these sheets automatically. With a FormRead plan this design becomes a ready reading template: scan the filled sheets and get every answer, ID and QR code in a spreadsheet." Botões: `Log in`, `See plans`.

---

## 2. Tela inicial (landing do gerador)

Título: *"Create an answer sheet in a minute"*. Descrição: *"Design it like a Word document: move anything, add text, pictures, bubbles, names and QR codes, and download a printable PDF. FormRead then reads the scans for you."*

Quatro modelos prontos (cards com prévia em miniatura):

| Modelo | Conteúdo |
|---|---|
| **Quiz** | 20 questões, A–D, com `Name: / Class: / Date:` e QR |
| **Exam** | Student ID (grade de dígitos) + 50 questões A–E, QR |
| **Survey** | 10 afirmações com nota 1–5 + linha de comentários |
| **Blank sheet** | Folha em branco |

Extras:

- **"Continue my last sheet →"** — retoma a folha salva no navegador (autosave local).
- **"Describe it to the AI"** — mesmo paywall do AI designer.
- Clicar em outro modelo com trabalho não salvo pede confirmação: *"Start a new sheet? It replaces the sheet saved in this browser."* (diálogo nativo `confirm`).

---

## 3. Cabeçalho do editor

| Item | Comportamento |
|---|---|
| **Undo (Ctrl+Z) / Redo (Ctrl+Y)** | Histórico da edição; desabilitam quando não há o que desfazer/refazer |
| **Sheet name** (caixa de texto) | Nome do arquivo baixado (`Exam.pdf` etc.) |
| **"Saved in this browser" / "Saving…"** | Autosave em `localStorage`; não há botão "salvar" nem conta |
| **AI designer** | Paywall (painel lateral direito) |
| **Create reading template** | Paywall / login; antes roda a validação (ver §9) |
| **Download PDF** | Gera o PDF no navegador (client-side), sem diálogo |

`File` (a esquerda das abas) **não é aba**: volta para a tela inicial (modelos + "Continue my last sheet"). A folha continua salva.

---

## 4. Abas fixas

Ordem: `File` · `Home` · `Insert` · `Layout` · `List` · `View` — mais **abas contextuais** que aparecem conforme o objeto selecionado.

### 4.1 Home

Cinco grupos:

- **Clipboard** — `Paste`, `Cut`, `Copy`, `Duplicate` (os três últimos só habilitam com objeto selecionado).
- **Font** — seletor de fonte, tamanho, `Increase font size`, `Decrease font size`, `Bold (Ctrl+B)`, `Italic (Ctrl+I)`, `Underline (Ctrl+U)`, `Font color`, `Highlight / fill`.
- **Paragraph** — `Align left`, `Center`, `Align right`, `Top`, `Middle`, `Bottom`, `Line spacing` (1.0, 1.15, 1.20, 1.50, 2.0, 2.50).
- **Arrange** — `Bring to front`, `Send to back`, `Rotate 90°`, `Align` (menu: Align on the page → left/center/right/top/middle/bottom), `Lock`, `Tidy up` (title: *"Stack everything neatly so nothing overlaps"*).
- **Editing** — `Select all`, `Delete`.

Sem seleção, os grupos de fonte/parágrafo/arrange ficam desabilitados. Com um objeto selecionado habilitam e refletem o estado (ex.: Bold `aria-pressed=true`).

### 4.2 Insert

| Grupo | Botões | O que faz |
|---|---|---|
| **Text** | `Text box`, `Title`, `Insert field` (title: *"Insert a column of your list"*) | Caixa de texto livre; título; insere `{{coluna}}` da lista já importada |
| **Illustrations** | `Picture`, `Shapes`, `QR code` | Imagem, formas, QR |
| **Answer sections (read by FormRead)** | `Multiple choice`, `True / False`, `Written answer`, `Name & fields`, `Marking instructions` | Blocos que o motor do FormRead reconhece |

Detalhes:

- **Picture** — upload múltiplo, aceita `image/png, image/jpeg, image/gif, image/webp`.
- **Shapes** — menu: `Rectangle`, `Rounded rectangle`, `Circle / ellipse`, `Line`, `Dashed line`.
- **QR code** — conteúdo é texto/campo (ex.: `{{student_id}}`), botão para inserir coluna da lista; só largura é configurável ("Use a column of your list so every sheet gets its own code").
- **True / False** — cria um bloco Multiple choice com preset T/F (10 questões, 2 colunas por padrão).
- **Insert field** sem lista abre popover `Add a list…`; com lista mostra `{{name}}`, `{{student_id}}`, `{{class}}`, `Edit list…`. Escolher um campo cria uma caixa de texto já preenchida com o campo (renderiza o valor da linha em prévia).

### 4.3 Layout

| Grupo | Opções |
|---|---|
| **Page setup** | `Letter` → Letter 8.5 × 11 in / **A4 210 × 297 mm**; `Orientation` → Portrait / Landscape |
| **Bubbles (OMR fonts)** | Estilo `Circle` / `Square` / `Rectangle` (galeria com prévia) + `Size` mm (**3–8 mm, passo 0,5**; padrão 5) |
| **Sheet font** | Fonte de números e rótulos: padrão Arial, Times New Roman, Courier New + Google Fonts (Roboto, Open Sans, Lato, Montserrat, Poppins, Nunito, Oswald, Merriweather, Lora, Playfair Display, Roboto Mono, Comic Neue, Patrick Hand, Caveat) + OMR Bubbles / Squares / Rectangles |
| **Background** | `Use my own sheet` (title: *"Put QR codes and names on a sheet you already have (PDF or image)"*) → abre seletor de arquivo `application/pdf,image/png,image/jpeg`; com fundo aplicado vira `Replace my sheet` + `Remove sheet` |
| **Start over** | `Templates` → menu com Quiz / Exam / Survey / Blank sheet (recomeça a folha) |

Ao subir uma imagem, ela entra como `<img>` de fundo ocupando a página inteira (Letter), atrás dos elementos. O status passou a avisar "1 thing to check" quando o fundo/objetos cobriram as bolhas.

### 4.4 List

| Grupo | Itens |
|---|---|
| **Start** | `Import list` / `Edit list` |
| **Write & insert fields** | `Insert field` (dropdown com as colunas) |
| **Preview results** | `Preview results` (toggle), navegação `‹ 1 / 2 ›` + nome da linha atual, botão `N sheets` no grupo Finish |
| **Finish** | `Download PDF` |

Importação:

- Painel **"Your list (one sheet per row)"** — *"Students, IDs, classes… Each row becomes its own sheet with its own name and QR code."*
- Entrada por **arrastar/soltar ou escolher arquivo** (`CSV/TXT/XLSX/XLS`) **ou colar** no textarea.
- A primeira linha precisa ter os nomes das colunas (ex.: `name, student_id, class`).
- Lista carregada mostra `N rows · M columns`, `Remove list`, a legenda `Columns you can put on the sheet` com `{{name}}`, `{{student_id}}`, `{{class}}` (*"Use them in any text or QR code block. Each sheet gets the values of its row."*) e a tabela da lista.

Prévia: o rodapé passa a mostrar `Sheet i of N`, `‹ Previous sheet` / `Next sheet ›` e `Nome · ID`; qualquer bloco com `{{campo}}` (texto ou QR) renderiza o valor daquela linha. O ribbon ganha o contador `1 / 2` e o nome da linha.

Download com lista: gera **um único PDF com uma folha por linha** (baixou `Exam.pdf` com 2 páginas). Sem lista, `Download PDF` abre um popover **"How many copies?"** (*"Add a list to print a different name or QR code on every sheet."*) com `Cancel` / `Download`.

### 4.5 View

| Grupo | Itens |
|---|---|
| **Zoom** | `Zoom out`, percentual atual (`125%`) → menu 50% / 75% / 100% / 125% / 150% / 200%, `Zoom in`, `Page width`; slider de zoom no rodapé |
| **Show** | `Margins` (guia tracejado das margens), `Reading areas` (contorno tracejado menta nos blocos que o FormRead lê), `Snap` (ímã, ligado por padrão) |

Rodapé (status bar): tamanho/orientação · validação (`Ready to read` ou `N things to check`) · folha atual (`Sheet 1 of 2`) · nome da linha · zoom.

---

## 5. Inspetor **Multiple choice** (aba contextual)

| Campo | Faixa / opções |
|---|---|
| **Questions** | 1–200 |
| **Start at** | 0–9999 |
| **Columns** (horizontal) / **Rows** (vertical) | 1–8 |
| **Orientation** | `Horizontal` (*"Options side by side, questions down the page"*) / `Vertical` |
| **Numbering** | `1.` `1)` `(1)` `1` `Q1` `Q1.` `1:` `No numbers` e **custom** (usa `#` como marcador) |
| **Answer options** | Um caractere por bolha; vazio = bolha em branco; o caractere pequeno embaixo é o que o FormRead registra. Presets: `A–D`, `A–E`, `True / False`, `Yes / No`, `Rating`, `4 blank`, `5 blank`, `Digits (0–9)`. Botão `+` adiciona opção; `×` remove |
| **Bubble size** | 3–8 mm |
| **Heading** | Texto acima do bloco |
| **Write-in boxes** | Caixas para o aluno escrever a resposta |
| **Size & position** | X, Y, W, H (mm) + `Fit to content` |

Ao inserir `True / False`, o preset vira 2 opções (T/F) com 10 questões e 2 colunas.

## 6. Outros inspetores

- **Text box** (`Box style`): `Fill`, `Outline`, `Weight` 0–5 mm, `Corners` 0–40 mm, `Padding` 0–20 mm; `Size & position`: X, Y, W, H + `Fit to content`; grupo extra `From your list` → inserir coluna.
- **Title** — entra como caixa de texto já selecionada, em edição (mesmo inspetor de Text box).
- **Name & fields** — `Edit fields` abre editor de pares **Label + valor** (valor vazio = linha para o aluno escrever; preenchido = texto fixo), `+ Add field`, `Fill from a list…` (popover: *"Leave the value empty for a line students write on, or fill it from your list to print each name."*), `Columns` 1–3.
- **Shape format** — `Rectangle` / `Ellipse` / `Line`; `Fill`, `Outline`, `Dashed`, `Weight` 0–5 mm, `Corners` 0–40 mm, `Rotate` −360…360; X/Y/W/H + `Fit to content`.
- **Marking instructions** — labels `Title` (default "Instructions"), `Right way`, `Wrong way` + posição. Desenha o exemplo de preenchimento correto/errado.
- **QR code** — conteúdo (texto/campo) + largura; X/Y/W/H.
- **Written answer** — `Question or heading` + toggle `Writing lines`; nota: *"FormRead's AI can transcribe or grade what students write here."*

---

## 7. Edição no canvas

- Selecionar: clique no objeto; aparece caixa de transformação (`moveable-control-box`) com alças de redimensionar/girar.
- Mover/redimensionar com `Snap` ligado encaixa em guias; setas do teclado também movem (comportamento observado no canvas).
- `Delete` apaga o objeto selecionado; `Select all` seleciona tudo; `Tidy up` reorganiza para não sobrepor.
- `Lock` trava o objeto (some a alça; desbloqueio pelo mesmo botão).
- Desfazer/refazer cobrem inserções, exclusões, upload de fundo e alterações de layout.
- Duplo clique em texto/título entra em edição inline (`.ss-text-editor`).

---

## 8. Validação (preflight)

O rodapé mostra `Ready to read` (verde) ou `N things to check`. Clicar lista os problemas; ex.:

> *"Multiple choice 1–50" overlaps "{{name}}". Anything on top of bubbles can be read as an answer.*

Regras observadas: blocos de resposta não podem se sobrepor nem ficar cobertos por texto/forma/imagem; com pendências, `Create reading template` é bloqueado por alerta nativo. `Download PDF` continua liberado.

---

## 9. Notas técnicas úteis (para o omr-leitor)

- Bolhas são **caracteres de fonte OMR** (Arial/Times/Courier ou OMR Bubbles/Squares/Rectangles), tamanho 3–8 mm; o layout é em **mm sobre página Letter/A4**, com margem de 15 mm (X/Y padrão dos blocos).
- O bloco Multiple choice guarda: questões, início, colunas/linhas, orientação, numeração (com `#`), lista de opções (1 caractere cada) e tamanho de bolha — praticamente o mesmo modelo do Gabarito Personalizado do omr-leitor.
- Campos `{{coluna}}` são resolvidos **por folha** (uma linha da lista = uma folha), inclusive dentro do QR.
- "Reading areas" mostra os retângulos que o leitor considera; a checagem de sobreposição é a mesma que bloqueia o template.
- Escrita livre e transcrição/nota por IA existem, mas são recurso pago e dependem do template criado no FormRead.
- O PDF é gerado no cliente (sem servidor), e a folha fica salva no `localStorage` do navegador.

---

## 10. Lacunas deste levantamento

- Paywalls de `AI designer` e `Create reading template` não foram ultrapassados (exigem conta/plano).
- Upload de **PDF** como fundo não foi testado (só PNG); importação de **XLSX/XLS** também não (só texto colado).
- Modelos Quiz/Exam/Survey foram lidos pela tela inicial; não foram abertos individualmente além do Exam.
