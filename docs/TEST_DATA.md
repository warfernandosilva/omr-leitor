# Base de teste isolada — Gabarito+

Base descartável para validar o redesign com dados realistas, sem tocar no banco de produção.

## Criar ou recriar a base

Na pasta `omr-backend`:

```bat
.\.venv\Scripts\python.exe tools\seed_demo.py --reset
```

O banco padrão é:

```text
omr-backend/data/dev-demo.db
```

Para apagar por completo, remova também:

```text
omr-backend/data/dev-demo.db-wal
omr-backend/data/dev-demo.db-shm
```

## Subir o backend com a base isolada

Na pasta `omr-backend`, defina `OMR_DB_PATH` antes de iniciar:

```powershell
$env:OMR_DB_PATH = "$PWD\data\dev-demo.db"
.\.venv\Scripts\python.exe main.py
```

Confirme em:

```text
http://localhost:8010/api/health
```

O campo `db` deve apontar para:

```text
sqlite:///.../omr-backend/data/dev-demo.db
```

Se apontar para Postgres ou `omr.db`, o backend não está usando a base isolada.

## Subir o frontend

Em outro terminal:

```bat
cd omr-app
npm run dev
```

Abra:

```text
http://localhost:5173
```

## Usuários de teste

| Perfil | E-mail | Senha |
|---|---|---|
| Administrador | `demo@example.com` | `Demo1234` |
| Professor | `professor@example.com` | `Demo1234` |

## Dados criados

- 2 usuários;
- 3 turmas:
  - `5 ANO A`
  - `5 ANO B`
  - `5 ANO C`
- 94 alunos no catálogo;
- 3 provas:
  - `5 ANO A - ATIVIDADE DEMO`
  - `5 ANO B - REVISÃO DEMO`
  - `5 ANO C - PERSONALIZADO DEMO`
- 94 gabaritos;
- 1 Gabarito Personalizado ativo, com imagem e versão 1;
- resultados variados:
  - corrigidos;
  - lidos;
  - gerados;
  - com dupla marcação;
  - com leitura incerta;
  - com QR não lido.

## Como fazer o frontend enxergar as provas do seed

O backend já tem as provas, mas o frontend mantém cache local. Depois de entrar com `demo@example.com`:

1. Abra **Provas e avaliações**.
2. Clique em **Atualizar do servidor**.
3. As provas seeded passam a aparecer na lista local.

Depois disso, valide:

- Painel inicial;
- Turmas;
- Alunos;
- Provas e avaliações;
- Gabaritos;
- Gerar cartões-resposta;
- Gabarito personalizado;
- Gerenciar avaliação;
- Resultados;
- Relatórios.

## Limitações atuais do seed

- A tela **Revisões pendentes** depende do cache local do navegador. Para testá-la com dados do seed, é preciso corrigir um cartão no app e deixá-lo com pendência, ou usar um resultado local já existente.
- A base não substitui testes automatizados de leitura OMR. Ela serve para validar interface, listagens, filtros, relatórios e exportação.
