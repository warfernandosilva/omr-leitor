# Relatório final — reestruturação do fluxo operacional

## 1. Funcionalidades preservadas

- **Motor OMR intacto**: `omr-backend/omr/` (detector, readers sae/saev/herby/
  simulado, preprocess, rectify, thresholds, vote, second_opinion, grading) não
  foi tocado. A leitura continua usando os mesmos leitores de produção.
- **APIs existentes**: `/api/omr/*`, `/api/card/*`, `/api/exams/*`,
  `/api/turmas/*`, `/api/gabaritos/*` mantêm contrato e comportamento. As
  rotas novas são aditivas.
- **Autenticação e permissões**: JWT, `owner_clause`, `require_owner_or_admin`
  e `require_turma_owner_or_admin` seguem sendo a fronteira de acesso — as
  rotas novas as usam.
- **QR Code e `codigo_unico`**: vínculo cartão → aluno → avaliação preservado;
  reimpressão não cria identificador novo.
- **Histórico de correções**: resultados e lápides de prova excluída
  (`deleted_exams`) intactos.
- **Banco de testes OMR** (lab_*), **backup/restore** e **admin/usuários**
  inalterados em comportamento.
- **Dados existentes**: o backfill criou uma `provas` para cada avaliação já
  existente sem mover alunos, gabaritos, QR ou resultados.

## 2. Funcionalidades modificadas

| Onde | Antes | Depois |
|---|---|---|
| `avaliacoes` | prova e avaliação na mesma linha | prova (estrutura) + avaliação (aplicação) |
| Menu lateral | Gerenciamento / Avaliações / Correção OMR / Análises / Sistema | Painel / Gestão escolar / Avaliações / Correção OMR / Análises e desempenho / Administração |
| Painel inicial | indicadores básicos | centro operacional com contadores do servidor, alertas acionáveis e "Continue de onde parou" |
| Gabarito oficial | sobrescrito in-place | versionado (`gabarito_versoes`), com histórico |
| Revisões pendentes | heurística no localStorage do navegador | fila real do servidor (`leituras` pendentes), com ação de revisão auditada |
| Correção manual | override só local | auditado no servidor (`revisoes_manuais`: autor, data, antes/depois) |
| Relatórios | CSV/XLSX | CSV/XLSX + PDF (ReportLab) por turma/avaliação e boletim do aluno |
| Turmas | nome e alunos | + ano letivo, arquivar/reativar e filtro |
| Alunos | catálogo global | + situação (ativo/inativo/transferido) e histórico por avaliação |

## 3. Novas funcionalidades

- **Ciclo de vida da avaliação** com 11 estados e 6 etapas visuais
  (`workflow/status.py` no servidor, espelhado em `src/utils/workflow.ts`),
  incluindo próxima ação contextual e bloqueios explicados.
- **Gerenciar avaliações** (lista) e **Detalhe da avaliação** (painel de
  etapas, ações contextuais, mudança manual autorizada, timeline).
- **Provas reutilizáveis** (`/api/provas`, duplicar, usar em avaliação) — uma
  prova serve N avaliações sem misturar participantes nem identificadores.
- **Multi-turma real** (`avaliacao_turmas`): avaliação atende 1..N turmas.
- **Publicação de resultados** com gate (zero leituras pendentes).
- **Leituras auditáveis** com reprocessamento (`parent_id`) que preserva o
  histórico e não deixa pendência fantasma.
- **Resumo operacional** (`/api/operacao/resumo`) alimentando o painel.
- **Histórico do aluno** por avaliação (notas, status, ano letivo).
- **Migração resiliente**: cada coluna nova é aplicada isoladamente; falha em
  uma não impede o boot do sistema.

## 4. Alterações no banco de dados

Tabelas novas: `provas`, `avaliacao_turmas`, `gabarito_versoes`, `leituras`,
`revisoes_manuais`, `auditoria`.
Colunas novas: `avaliacoes.prova_id/status/ano_letivo/descricao/
resultados_publicados_em/publicado_por`, `turmas.ano_letivo/arquivada`,
`alunos.situacao`, `turma_alunos.situacao`.
Migração: `_ensure_coluna` (aditiva, tolerante a falha) +
`_backfill_provas` (idempotente). BOOLEAN usa `DEFAULT false` em Postgres e
`0` em SQLite — o `0` era rejeitado pelo Postgres e interrompia a migração.

## 5. Integrações realizadas

Prova → avaliação → turmas → alunos → cartões (QR) → leituras → revisão →
publicação → relatórios, com o mesmo identificador (`external_id`) ligando
prova do frontend, avaliação, gabaritos e resultados.

## 6. Testes executados

- Backend: **431 passed, 1 skipped** (suíte completa).
  - `test_workflow_status.py` (10): motor puro.
  - `test_avaliacoes.py` (9): criação, reuso, versão, transição, publicação,
    isolamento.
  - `test_migracao_provas.py` (3): banco novo, idempotência, backfill.
  - `test_relatorios_pdf.py` (5): PDF turma/aluno/vazio/404/403.
  - `test_aceitacao_fluxo.py` (9): os 8 cenários do enunciado ponta a ponta +
    isolamento entre usuários.
  - `test_turmas.py` (18): arquivamento, filtro, ano letivo, situação.
- Frontend: **340 testes vitest** (25 novos: espelho do fluxo + cliente HTTP).
- `tsc`, `eslint --max-warnings 0` e `npm run build` verdes.
- Regressão OMR direcionada: 126 passed.
- Validação visual no navegador (seed `dev-demo.db`): menu novo, painel
  operacional, gerenciar avaliações, detalhe com etapas, provas, turmas
  (ano letivo/arquivar), alunos (situação/histórico), relatórios com PDF e
  mobile sem overflow horizontal.

## 7. Problemas identificados e resolvidos

1. **Migração interrompia no Postgres**: `DEFAULT 0` em coluna BOOLEAN é
   rejeitado — resolvido com DDL por dialeto e migração tolerante a falha.
2. **`Query` no corpo da função** (não na assinatura) era ignorado pelo
   FastAPI — o filtro de arquivadas não filtrava nada; corrigido e coberto
   por teste.
3. **`revisoes_manuais.leitura_id` nulo**: o INSERT acontecia antes do flush
   da leitura — reordenado.
4. **Pendência fantasma**: cartão reprocessado mantinha a leitura antiga
   pendente na contagem — agora só a leitura mais recente de cada cartão
   conta.
5. **Timeline sem auditoria de leitura**: revisões manuais não apareciam no
   histórico da avaliação — incluídas.
6. **`/operacao/resumo` sem `/api`**: prefixo faltante no cliente novo.

## 8. Funcionalidades que ainda dependem de implementação

- **Leitura por câmera real em celular**: a validação usou seed, testes de
  integração e regressão OMR; falta testar com câmera real em aparelho.
- **Resultados 100% no servidor**: o cache local ainda é usado como fallback
  offline; a migração completa do frontend para o servidor como fonte única
  pode seraprofundada (hoje o servidor já é a fonte oficial quando acessível).
- **Multi-instituição**: o isolamento é por usuário/dono; não há camada de
  organização/instituição.
- **Versionamento de prova**: a prova é reutilizável e duplicável, mas ainda
  não tem versões próprias (só o gabarito da avaliação é versionado).
