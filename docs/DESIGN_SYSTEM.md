# Design System — Gabarito+

Identidade visual: **SaaS azul e branco**, com glassmorphism discreto, superfícies
claras, cantos arredondados e sombras suaves. A legibilidade de formulários,
tabelas e leituras OMR tem prioridade sobre efeitos.

## Tokens

| Token | Valor | Uso |
|---|---:|---|
| `brand-500` / `primary` | `#1769F5` | Ações principais, seleção, destaques |
| `brand-600` / `primary-600` | `#1552C0` | Hover de ações, estados ativos |
| `secondary-500` | `#3B82F6` | Gradientes e acentos |
| fundo | `#F4F7FD` | Fundo geral |
| superfície | `#FFFFFF` | Cards, tabelas, formulários |
| superfície vidro | `rgba(255,255,255,0.75)` | Header, sidebar, cartões de destaque |
| texto primário | `#172B4D` | Títulos e conteúdo |
| texto secundário | `#71809A` | Descrições, rótulos auxiliares |
| borda | `#E2EAF5` | Bordas e divisórias |
| sucesso | `#16B981` | Acertos, status positivo |
| aviso | `#F59E0B` | Revisões, duplicidade |
| erro | `#EF4444` | Exclusão, falhas |

Fonte principal: **Inter**.

## Formas e sombras

- Botões e campos: `10px` (`rounded-[10px]`).
- Cartões e painéis: `16px` (`rounded-2xl`).
- Sombras suaves: `shadow-soft`, `shadow-glass`, `shadow-card`.

## Classes base

| Classe | Uso |
|---|---|
| `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-success`, `.btn-danger` | Botões |
| `.btn-sm`, `.btn-icon` | Variações de botão |
| `.card` | Superfície sólida para formulários, tabelas e conteúdo |
| `.card-glass` | Superfície translúcida para destaque |
| `.card-hover` | Interação de cards clicáveis |
| `.panel` | Bloco interno com borda e padding consistente |
| `.stat-card` | Indicador com ícone, valor, rótulo e hint |
| `.quick-card` | Ação rápida clicável |
| `.input`, `.label`, `.field-helper`, `.field-error` | Formulários |
| `.table-shell`, `.table-scroll`, `.table-th`, `.table-td` | Tabelas |
| `.badge-*`, `.callout-*`, `.empty-state` | Status e mensagens |
| `.app-bg`, `.glass` | Fundo e superfícies translúcidas |

## Componentes reutilizados

- `Button`, `Input`, `Select`, `Field`
- `Card`, `CardHeader`, `CardBody`
- `PageHeader`, `Breadcrumbs`
- `Badge`, `StatCard`, `EmptyState`, `Skeleton`
- `DataTable`, `Pagination`
- `Modal`, `Popover`, `Tabs`, `Toast`, `Tooltip`
- `ThemeToggle`, `Avatar`
- `AppShell`, `Sidebar`, `Topbar`, `BottomNav`
- `EditorTopBar`, `EditorMobilePanels`
- `CaptureViewport`, `ReaderSettingsPanel`
- `AiAssistPanel`, `ManualReviewPanel`, `ResultSummaryPanel`
- `BatchQueuePanel`, `MultiPageBatchModal`
- `AlunoEditModal` (edição de aluno do catálogo)
  
### Ciclo de vida da avaliação (telas novas)

- `AvaliacoesPage` — central com status, progresso e próxima ação por
  avaliação, filtros e criação a partir de prova existente.
- `AvaliacaoDetailPage` — as 6 etapas com ação contextual, bloqueios
  explicados, mudança manual autorizada, turmas participantes, leituras
  registradas e auditoria.
- `ProvasPage` — catálogo de provas (estrutura reutilizável).

## Regras de uso

- Não usar glassmorphism em formulários densos, tabelas, overlays de leitura OMR
  ou áreas de captura.
- Não criar botões sem ação.
- Não exibir indicadores fictícios: valores só aparecem quando há dados reais.
- Tabelas devem ter cabeçalho claro, rolagem horizontal no mobile e ações
  Destrutivas visualmente separadas.
- O editor do Gabarito Personalizado e o leitor OMR priorizam a área útil,
  mantendo a legibilidade da imagem.
