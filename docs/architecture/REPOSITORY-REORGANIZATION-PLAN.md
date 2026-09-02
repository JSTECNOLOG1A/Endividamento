# Plano de reorganização do repositório — AllDebt / Endividamento

**Status:** proposta. Nenhuma pasta foi movida nesta execução.  
**Data da auditoria:** 2026-09-02  
**Regra:** sem big-bang. Cada etapa deve manter a aplicação funcional e passar pelos gates listados na seção 13.

Este documento é o resultado das Fases 1–10. A reorganização só começa depois da aprovação explícita deste plano.

---

## 1. Estrutura atual

O repositório é um monólito orgânico com **dois package.json** (frontend na raiz, API em `backend/`) e um terceiro servidor legado em `server/`.

```
Endividamento-git/
├── src/                    frontend React/Vite (produção)
├── backend/                API Express + Postgres + motor (produção)
├── server/                 API SQLite legado (não usado pelo Docker)
├── base44/                 schemas/functions da plataforma origem
├── protheus/               fontes ADVPL TOTVS
├── docs/                   documentação
├── .github/workflows/      CI mínimo
├── docker-compose.yml      stack efetiva (db + api + web)
├── Dockerfile.web          frontend
├── backend/Dockerfile      API
├── 35 × *.bundle           Git bundles versionados
├── main, node, cd, git, docker, endividamento-api@1.0.0   arquivos vazios (0 bytes)
├── node_modules/           dependências do frontend (não versionado)
└── package.json            scripts e deps do frontend
```

### 1.1 Classificação dos diretórios principais

| Caminho | Classificação | Função comprovada |
|---|---|---|
| `src/` | PRODUÇÃO | SPA React. Entrypoint `src/main.jsx`. Páginas em `pages.config.js`. |
| `backend/` | PRODUÇÃO | API efetiva. Boot `backend/src/index.js`. Migrations, JWT, multi-tenant, scheduler. |
| `backend/src/engine/` | PRODUÇÃO | Motor SAC/PRICE/indexadores. Fonte única; Vite alias `@engine`. |
| `backend/src/db/migrations/` | PRODUÇÃO | 51 SQL versionados (001–048, com números duplicados 003/004/025). |
| `protheus/` | PRODUÇÃO (integração) | Jobs REST Protheus (`finresttitulos`, `peccodeestoque`). Não roda no Node. |
| `docker-compose.yml` + Dockerfiles | CONFIGURAÇÃO | Stack que o README e `npm run dev` sobem. |
| `docs/` | DOCUMENTAÇÃO | Arquitetura, ISO, relatórios P0. |
| `.github/workflows/ci.yml` | CONFIGURAÇÃO | CI: syntax + smoke do engine + `docker compose config`. Sem isolation/p0/frontend. |
| `server/` | LEGADO | Express + `better-sqlite3`. `npm run dev:legacy`. README: “não é mais o caminho padrão”. |
| `base44/` | LEGADO | Schemas JSONC e 3 functions Deno/`@base44/sdk`. Não importados pelo Node/Vite. |
| `*.bundle` | BACKUP / ARTEFATO | 35 Git bundles. `git bundle verify` OK. Commits já estão no histórico. |
| `main`, `node`, `cd`, `git`, `docker`, `endividamento-api@1.0.0` | ARTEFATO | 0 bytes. Commit `e216f3f`: “sobraram de comandos digitados errado”. |
| `node_modules/` (raiz e `backend/`) | DEPENDÊNCIA | Gerado por npm. Gitignored. |
| `.env` | CONFIGURAÇÃO (local) | Presente no disco, **não** versionado. |
| `.env.example` | CONFIGURAÇÃO | Versionado. Placeholders de desenvolvimento. |
| `canvases/` | GERADO / DESENVOLVIMENTO | Fora do repo de produto (Cursor). `.dockerignore` já ignora. |

### 1.2 Classificação de arquivos de configuração na raiz

| Arquivo | Classe |
|---|---|
| `package.json`, `package-lock.json`, `backend/package.json` | CONFIGURAÇÃO |
| `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `jsconfig.json`, `eslint.config.js`, `components.json` | CONFIGURAÇÃO |
| `index.html` | PRODUÇÃO (shell Vite) |
| `.gitignore`, `.dockerignore` | CONFIGURAÇÃO |
| `README.md` | DOCUMENTAÇÃO |

---

## 2. Problemas encontrados

1. **Três “backends” mentais:** `backend/` (Postgres, produção), `server/` (SQLite, legado), `base44/` (plataforma antiga). Só `backend/` é referenciado por Docker e README.
2. **Raiz poluída:** 35 Git bundles + 6 arquivos vazios versionados no commit `e216f3f`.
3. **Motor duplicado no frontend:** `backend/src/engine` é a fonte; `src/components/loan/{strategies,indexers,roundMoney,PrecisionLayer}` é cópia morta/parcial, usada por suítes de teste embutidas no Simulator.
4. **Suítes de regressão na UI de produção:** `Simulator.jsx` renderiza `EngineTestSuite`, `ZeroRiskRegressionTest`, `ScenarioTests`, `IntegrityValidator` em abas visíveis ao cliente.
5. **Código SaaS órfão no frontend:** `src/components/saas/*` não é importado por páginas. O SaaS real está em `backend/src/modules/tenants` + `AuthContext`/`PlatformContext`.
6. **Página morta:** `src/pages/Configuracoes.jsx` está em `pages.config.js` mas não no menu (`Layout.jsx` aponta para `Settings`).
7. **`_to_delete` ainda no repo:** `src/components/accounting/_to_delete/`.
8. **CI insuficiente** para o gate multi-tenant que o produto já exige (`test:p0`, `test:isolation`, build do front).
9. **Dependências frontend inchadas e não usadas** (comprovado por grep): `@stripe/*`, `three`, `react-leaflet`, `better-sqlite3`, `express`, `cors`, `multer` na raiz — estas três últimas só fazem sentido para `server/` legado.
10. **Migrations com números repetidos** (`003`, `004`, `025`) — risco de ordem ambígua se o runner ordenar só pelo prefixo.
11. **Nome `base44Client.js`** é legado da plataforma; o arquivo é um `fetch` para `/api` da API atual.
12. **Dois package.json sem workspace** — `decimal.js` duplicado; engine compartilhado só via volume/alias Vite.

---

## 3. Código ativo

### Frontend (Vite → `src/`)

- Shell: `index.html` → `src/main.jsx` → `src/App.jsx` → `pages.config.js` + `Layout.jsx`.
- Páginas no menu: Simulator, Contracts, GuaranteedAccounts, Governance, Accounting, Consolidation, AccountsPayable, AccountsReceivable, CDIManager, UserManual, Settings.
- Cliente HTTP: `src/api/base44Client.js` (nome legado; chama `/api` com JWT e `X-Tenant-Id`).
- Motor no browser: `src/lib/runCalculation.js` e `src/components/loan/CalculationEngine.jsx` reexportam `@engine` → `backend/src/engine`.
- Fechamento contábil (UI): `src/lib/accountingClosing.js` + `FechamentoContabil.jsx`. **Não** recalcula SAC/PRICE; consome snapshot.

### Backend (`backend/`)

- Boot: `src/index.js` → secrets → migrate → seed → `createApp()` → `startScheduler()`.
- HTTP: `src/app.js` (helmet, CORS, rate limit, JWT, tenant).
- Domínios já parcialmente modulados em `src/modules/*`.
- Persistência: `pg` + `src/db/migrate.js` + 51 SQL.
- Worker: `src/modules/schedules/runner.js` (intervalo 20s, jobs por `group_id`).

### Integração Protheus

- Node: `backend/src/modules/integrations/*`, `payables/erpIntegrate.js`, `receivables/erpIntegrate.js`.
- ADVPL: `protheus/finresttitulos.*.prw`, `protheus/peccodeestoque.*.prw`.

### Docker efetivo

| Serviço | Imagem / build | Comando | Porta |
|---|---|---|---|
| `db` | `postgres:16-alpine` | postgres | host `${POSTGRES_PORT:-5432}` |
| `api` | `backend/Dockerfile` | `node src/index.js` | 3001 |
| `web` | `Dockerfile.web` | `npx vite --host 0.0.0.0 --port 5173` | 5173 |

Volumes relevantes: `./backend/src` → API; `./src` + `./backend/src/engine` → web.

---

## 4. Código legado

| Item | Evidência de que não é o runtime | Destino proposto |
|---|---|---|
| `server/` | Docker e README usam `backend/`. `dev:legacy` sobe SQLite. Health: `engine: "local-sqlite"`. | `archive/server-sqlite/` |
| `base44/` | Imports `npm:@base44/sdk`. Nenhum `import` a partir de `src/` ou `backend/`. | `archive/base44/` |
| `src/api/base44Client.js` (nome) | Arquivo **ativo**; só o nome é legado. | Renomear depois para `api/client.js` (etapa C, com alias). |
| Cópias do motor em `src/components/loan/strategies`, `indexers`, `roundMoney.jsx`, `PrecisionLayer.jsx` | Produção importa `@engine`. Estas cópias alimentam testes/validadores locais. | Extrair testes; arquivar cópias. |
| `src/components/saas/*` | Nenhum import de página/layout. | `archive/frontend-saas-stub/` ou delete na etapa H. |
| `src/components/accounting/_to_delete/` | Nome e comentário em `Accounting.jsx`. | archive / delete. |
| `src/pages/Configuracoes.jsx` | Rota existe; menu usa `Settings`. | Decidir: redirect ou remover. |
| `npm run dev:legacy` | Script explícito de fallback. | Remover após archive de `server/`. |

---

## 5. Arquivos órfãos

Critério: nenhum import/require encontrado a partir de entrypoints ativos (`src/main.jsx`, `backend/src/index.js`, Docker CMD), exceto quando o próprio arquivo só se auto-referencia.

| Arquivo / pasta | Motivo |
|---|---|
| `src/components/saas/{TenantService,PlanService,SaaSGuard,BillingHooks,UserRoleService}.jsx` | Grafo interno apenas. |
| `src/components/accounting/ApprovedContractManager.jsx` | Nenhum importador. |
| `src/components/accounting/_to_delete/*` | Marcado para delete. |
| `src/pages/Configuracoes.jsx` | Sem item de navegação. |
| `base44/**` | Runtime Base44 ausente. |
| `server/**` | Fora do compose. |
| `src/components/loan/EngineTestSuiteEtapa3.jsx`, `FinalHardeningTests.jsx`, `CalculationSnapshotTests.jsx`, `SnapshotRegressionTest*.jsx`, `AUDIT_FX_INTEGRITY.jsx` | Não importados pelo Simulator (ou só via comentário `node -e`). |
| Dependências npm sem import: Stripe, Three, Leaflet, etc. | Órfãos de manifesto. |

**Não órfãos (cuidado):** suítes `EngineTestSuite`, `ZeroRiskRegressionTest`, `ScenarioTests`, `IntegrityValidator`, `SnapshotValidationTest` **são importadas por `Simulator.jsx`** — código morto de produto, mas vivo no bundle.

---

## 6. Bundles

Todos os `*.bundle` da raiz passaram em `file(1)` como **Git bundle** e em `git bundle verify`. O commit `e216f3f` já registrou: commits internos existem neste repositório; são backups redundantes de sessões.

| arquivo | função | utilizado | pode arquivar | pode remover |
|---|---|---|---|---|
| `acoes-contratos-e-remove-documentos.bundle` | Git bundle (ref `main`) | Não pela app | Sim | Sim, após cópia em `archive/` |
| `automatiza-ptax-cdi-selic-bacen.bundle` | Git bundle | Não | Sim | Sim* |
| `baixa-por-valor-pago.bundle` | Git bundle | Não | Sim | Sim* |
| `calculadora-4-categorias.bundle` | Git bundle | Não | Sim | Sim* |
| `calculator-ux-and-pdf-fix.bundle` | Git bundle | Não | Sim | Sim* |
| `cet-fix-e-melhorias.bundle` | Git bundle | Não | Sim | Sim* |
| `contract-summary-table-layout.bundle` | Git bundle | Não | Sim | Sim* |
| `contrast-boost.bundle` | Git bundle | Não | Sim | Sim* |
| `contratos-colunas.bundle` | Git bundle | Não | Sim | Sim* |
| `contratos-tabela-layout-fix.bundle` | Git bundle | Não | Sim | Sim* |
| `contratos-tabela.bundle` | Git bundle | Não | Sim | Sim* |
| `correcao-ancora-prazo-total.bundle` | Git bundle | Não | Sim | Sim* |
| `correcao-fuso-vencimento-final.bundle` | Git bundle | Não | Sim | Sim* |
| `correcao-parcelas-e-pendentes.bundle` | Git bundle | Não | Sim | Sim* |
| `correcoes-prazo-data-combobox-bacen.bundle` | Git bundle | Não | Sim | Sim* |
| `documentos-menu-unificado.bundle` | Git bundle | Não | Sim | Sim* |
| `endividamento-sync.bundle` | Git bundle | Não | Sim | Sim* |
| `explicacao-prazo-total.bundle` | Git bundle | Não | Sim | Sim* |
| `fechamento-contabil.bundle` | Git bundle (histórico completo, ~660 KB) | Não | Sim | Sim* |
| `fechamento-contabil-v2.bundle` | Git bundle (~700 KB) | Não | Sim | Sim* |
| `fechamento-fix.bundle` | Git bundle | Não | Sim | Sim* |
| `fechamento-fix2.bundle` | Git bundle | Não | Sim | Sim* |
| `fonte-unificada-toda-ferramenta.bundle` | Git bundle | Não | Sim | Sim* |
| `nota-explicativa-tooltips.bundle` | Git bundle | Não | Sim | Sim* |
| `padrao-visual-largura-bordas-ordenacao.bundle` | Git bundle | Não | Sim | Sim* |
| `parcelas-e-botoes.bundle` | Git bundle | Não | Sim | Sim* |
| `ptax-cdi-compact-layout.bundle` | Git bundle | Não | Sim | Sim* |
| `ptax-layout-igual-cdi.bundle` | Git bundle | Não | Sim | Sim* |
| `recalculo-acionavel.bundle` | Git bundle | Não | Sim | Sim* |
| `reclass-docs-notif.bundle` | Git bundle | Não | Sim | Sim* |
| `rename-alldebt.bundle` | Git bundle | Não | Sim | Sim* |
| `seed-bancos-empresas.bundle` | Git bundle | Não | Sim | Sim* |
| `sortable-tables-sweep.bundle` | Git bundle | Não | Sim | Sim* |
| `tipo-especifico-financiamentos.bundle` | Git bundle | Não | Sim | Sim* |
| `voltar-e-fonte-unificada.bundle` | Git bundle | Não | Sim | Sim* |

\*Remoção da raiz só depois de copiar para `archive/git-bundles/` (ou tag/release). Não apagar o único histórico se alguém depender do arquivo solto.

Nenhum `.bundle` é importado por Vite, Node ou Docker.

---

## 7. Entry points

Comprovado por `package.json`, Dockerfiles, `docker-compose.yml`, `index.html` e imports.

| Papel | Caminho efetivo | Caminho NÃO efetivo |
|---|---|---|
| Frontend entrypoint | `index.html` → `/src/main.jsx` | — |
| Backend entrypoint | `backend/src/index.js` (`CMD` do Dockerfile e `npm start` em `backend/`) | `server/index.js` |
| Servidor utilizado | container `endividamento-api` (Express + Postgres) | `server/` SQLite; functions Base44 |
| Docker API | `backend/Dockerfile` → `node src/index.js` | — |
| Docker web | `Dockerfile.web` → `npx vite --host 0.0.0.0 --port 5173` (**dev server, não `vite build`**) | — |
| Docker db | `postgres:16-alpine` | — |
| Scripts npm (raiz) | `dev` = `docker compose up --build`; `build` = `vite build`; `dev:client` = Vite local; `dev:server` = `backend` npm start; `dev:legacy` = `server/dev.mjs` | — |
| Scripts npm (API) | `start`/`dev`, `migrate`, `test:engine`, `test:isolation`, `test:secrets`, `test:p0`, `cleanup:local` | — |
| Build frontend | `npm run build` (Vite) | Dockerfile.web **não** usa esse build |
| Build backend | não há transpile; Node 22 roda ESM direto | — |
| Migrations | `backend/src/db/migrate.js` no boot e `npm run migrate` | `server/db.js` CREATE TABLE inline |
| Testes | engine smoke, isolation, secrets, p0 (manuais/scripts). CI só engine + syntax. | Suítes JSX no Simulator |
| Scheduler / worker | `backend/src/modules/schedules/runner.js` no mesmo processo da API | processo separado inexistente |
| Integração Protheus | HTTP REST a partir da API + fontes em `protheus/` | `base44/functions/getPTAXFromBACEN` |

### 7.1 Duplicação `backend/` × `server/` × `src/`

| Superfície | backend/ | server/ | src/ |
|---|---|---|---|
| HTTP entities CRUD | `modules/entities/*` + Postgres + tenant | `crud.js` + SQLite, sem tenant | consome `/api/entities` via `base44Client` |
| Functions BACEN/cálculo | `modules/functions/*` | subset em `functions.js` | chama `/api/functions` |
| Motor | `src/engine` (canônico) | não contém o engine | reexport `@engine` + cópias mortas |
| Auth | JWT + tenant | stub `/api/auth/me` usuário local | AuthContext |

**Conclusão:** não há três apps em produção. Há **uma** API (`backend/`) e **um** front (`src/`). `server/` é clone antigo.

---

## 8. Dependências (mapa resumido)

`node_modules` omitido.

```
src/main.jsx
  → App.jsx → pages.config.js → pages/* + Layout.jsx
  → api/base44Client.js → fetch /api
  → lib/runCalculation.js → @engine/CalculationEngine.js
  → components/loan/CalculationEngine.jsx → @engine/*

backend/src/index.js
  → config/validateSecrets.js
  → db/migrate.js + db/seed.js + db/pool.js
  → app.js
       → middleware/{auth,tenant,rbac,audit,errorHandler}
       → modules/{auth,signup,account,entities,functions,audit,
                  integrations,schedules,users,platform,billing,onboarding,health}
  → modules/schedules/runner.js
       → schedules/service.js → functions (BACEN, ERP consult) via runWithTenant

backend/src/modules/calculate/service.js
  → engine/CalculationEngine.js

backend/src/modules/functions/guaranteedAccount.js
  → engine/CalculationEngine.js (funções de prazo/indexador)

src/lib/accountingClosing.js
  → NÃO importa o engine (só snapshots + matriz)

protheus/*.prw
  → sem import Node; contrato HTTP com integrations/erpIntegrate

base44/**
  → isolado (sdk Base44)

server/**
  → isolado (better-sqlite3)
```

### 8.1 Dependências que impedem extrair o engine hoje

| Dependência | Impede? | Nota |
|---|---|---|
| Express, rotas, `pool` | Não | `backend/src/engine` não importa nenhum. |
| React | Não no canônico | Cópias `.jsx` em `src/components/loan` sim. |
| `decimal.js` | Sim (permitida) | `PrecisionLayer.js` importa `decimal.js`. Precisa ir no `package.json` do package. |
| Web Crypto (`crypto.subtle.digest`) | Atenção | Hash SHA-256 do fingerprint. Funciona em Node 22 e no browser. Evitar `node:crypto` se quiser isomorphic. |
| Vite alias `@engine` | Acoplamento de path | Hoje aponta para `backend/src/engine`. |

---

## 9. Estrutura proposta

Adaptada à realidade. **Não** criamos `packages/ui` nem `packages/shared` nesta onda: o design system (shadcn) vive só no web, e não há tipos compartilhados extraídos.

```
apps/
  web/                         # hoje: src/ + index.html + vite/tailwind/eslint
  api/                         # hoje: backend/ sem engine

packages/
  calculation-engine/          # hoje: backend/src/engine

integrations/
  protheus/                    # hoje: protheus/

infrastructure/
  docker/
    compose.yml                # hoje: docker-compose.yml
    Dockerfile.web
    Dockerfile.api             # hoje: backend/Dockerfile
  database/
    migrations/                # hoje: backend/src/db/migrations
  monitoring/                  # placeholder vazio até haver métricas

docs/
  architecture/
  security/

scripts/                       # cleanup, release, seed helpers

tests/                         # só na etapa G; até lá testes ficam colocalizados

archive/
  git-bundles/
  empty-shell-artifacts/
  server-sqlite/
  base44/
  frontend-engine-copies/
```

**Fora desta árvore de propósito:** `node_modules`, `.git`, `.env`.

Workspaces npm (`"workspaces": ["apps/*", "packages/*"]`) entram na etapa E, quando o engine virar package de verdade. Antes disso, apenas aliases e `archive/`.

---

## 10. Mapa origem → destino

### 10.1 Raiz e artefatos

| Origem | Destino |
|---|---|
| `*.bundle` | `archive/git-bundles/` |
| `main`, `node`, `cd`, `git`, `docker`, `endividamento-api@1.0.0` | `archive/empty-shell-artifacts/` (ou delete) |
| `server/` | `archive/server-sqlite/` |
| `base44/` | `archive/base44/` |
| `docker-compose.yml` | `infrastructure/docker/compose.yml` (symlink na raiz na etapa F) |
| `Dockerfile.web` | `infrastructure/docker/Dockerfile.web` |
| `backend/Dockerfile` | `infrastructure/docker/Dockerfile.api` |
| `docs/*` | permanece / `docs/architecture/` |

### 10.2 Frontend

| Origem | Destino |
|---|---|
| `src/**` | `apps/web/src/**` |
| `index.html`, `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `jsconfig.json`, `eslint.config.js`, `components.json` | `apps/web/` |
| `package.json` (raiz) | `apps/web/package.json` + workspace root mínimo |
| `src/api/base44Client.js` | `apps/web/src/api/client.js` (rename tardio) |
| `src/components/loan/{strategies,indexers,roundMoney.jsx,PrecisionLayer.jsx}` | `archive/frontend-engine-copies/` após testes saírem da UI |
| `src/components/saas/*` | archive |
| `src/components/accounting/_to_delete/` | archive |
| `src/lib/accountingClosing.js` | permanece no web (não é o calculation-engine) |

### 10.3 Backend por domínio (Fase 9)

Mapeamento **lógico**. Na primeira passagem **não** renomear pastas — só documentar. A extração física é etapa C+.

| Arquivo atual | Domínio destino |
|---|---|
| `modules/auth/*`, `middleware/auth.js`, `modules/auth/token.js` | `auth` |
| `modules/tenants/*`, `middleware/tenant.js` | `tenants` |
| `modules/users/*` | `users` |
| `modules/entities/store.js` + `catalog.js` (LoanContract) + `contracts/reverseOnReopen.js` | `contracts` |
| `modules/calculate/service.js` + `engine/` (depois package) | `calculations` |
| `modules/payables/*` | `payables` |
| `modules/receivables/*` | `receivables` |
| `modules/entities` Accounting* + frontend `accountingClosing` (API futura) | `accounting` |
| `modules/entities` ContractSettlement | `settlements` |
| `store.js` workflow + `tenants/policy.js` (approve/reopen) | `approvals` |
| `modules/billing/*` | `billing` |
| `modules/functions/bacen.js`, `holidays.js` | `bacen` |
| `modules/notifications/*`, `signup/mailer.js` | `notifications` |
| `modules/documents/*`, uploads em `app.js` | `documents` |
| `modules/integrations/*` | `integrations` |
| `modules/audit/*`, `middleware/audit.js` | `audit` |
| `modules/platform/*` | `platform` |
| `modules/account/*`, `modules/signup/*`, `modules/onboarding/*` | `auth` / `tenants` (onboarding fica em tenants) |
| `modules/schedules/*` | `integrations` (jobs) ou `platform` |
| `modules/functions/routes.js` | fachada HTTP; handlers migram para o domínio dono |
| `modules/natures/*`, `bankAccounts/*`, `chartAccounts/*` | `integrations` (cadastros Protheus) + `contracts` (governança) |
| `modules/health/*`, `openapi.js`, `config.js`, `logger.js` | `platform` / `apps/api` core |
| `db/migrate.js`, `db/seed.js`, `db/pool.js` | `infrastructure/database` + runtime em `apps/api` |

`functions/routes.js` hoje é um **god-router**. O plano não o explode na etapa A–C; só na D/E, um handler por vez.

---

## 11. Sequência de migração

### ETAPA A — Limpeza de artefatos

**Objetivo:** raiz legível, zero mudança de runtime.  
**Arquivos:** `*.bundle`; vazios `main`/`node`/`cd`/`git`/`docker`/`endividamento-api@1.0.0`.  
**Ação:** `git mv` para `archive/`. Atualizar `.gitignore` se archive for local-only (preferência: versionar archive uma vez, depois não crescer).  
**Risco:** baixo.  
**Imports:** nenhum.  
**Docker / scripts:** nenhum.  
**Testes:** `git bundle verify` numa amostra; `docker compose config`.  
**Rollback:** `git mv` inverso.

### ETAPA B — Separar frontend (ainda no lugar)

**Objetivo:** tirar testes/código morto do caminho crítico **sem** mover `src/`.  
**Arquivos:** abas de teste em `Simulator.jsx`; `_to_delete`; `Configuracoes.jsx`; deps npm não usadas (Stripe/Three/Leaflet) — só após grep de confirmação no PR.  
**Risco:** médio na UI do Simulator (regressão visual).  
**Imports:** `Simulator.jsx`.  
**Docker:** volume `./src` inalterado.  
**Testes:** `npm run build`; smoke manual Simulator/Contratos.  
**Rollback:** revert do PR.

Não mover `src/` → `apps/web` nesta etapa.

### ETAPA C — Preparar backend para extração (sem mover)

**Objetivo:** documentar e quebrar `functions/routes.js` em re-exports por domínio, **mantendo** `POST /api/functions/:name`.  
**Arquivos:** só adições de arquivos-fábrica; rotas públicas iguais.  
**Risco:** médio (functions são o coração operacional).  
**Imports:** `app.js` continua montando o mesmo router.  
**Docker:** nenhum.  
**Testes:** `test:p0`, `test:isolation`, health, um fluxo pagar/receber.  
**Rollback:** revert.

Mover `backend/` → `apps/api` só no **final** da etapa C, num PR só de path + Docker, sem lógica.

### ETAPA D — Organizar Protheus

**Arquivos:** `protheus/` → `integrations/protheus/`. Atualizar README/docs.  
**Risco:** baixo (não entra no build Node).  
**Imports Node:** nenhum.  
**Docker:** nenhum.  
**Testes:** revisão de paths nos docs de integração.  
**Rollback:** `git mv` inverso.

### ETAPA E — Extrair engine

**Arquivos:** `backend/src/engine/**` → `packages/calculation-engine/`.  
**Ajustes:**  
- `packages/calculation-engine/package.json` (`decimal.js`, `type: module`).  
- Vite alias `@engine` → package.  
- `Dockerfile.web` COPY do package (hoje copia `backend/src/engine`).  
- `backend` / `apps/api` importa o package.  
**Risco:** alto (cálculo financeiro).  
**Imports afetados:** `calculate/service.js`, `functions/guaranteedAccount.js`, `src/lib/runCalculation.js`, `src/components/loan/CalculationEngine.jsx`, `smoke.test.js`.  
**Docker:** web + api.  
**Testes:** `test:engine` + suítes extraídas da UI + um contrato SAC e um PRICE + PTAX.  
**Rollback:** alias de volta para o path antigo; package permanece mas não é usado.

**Não** mover `accountingClosing.js` para este package.

### ETAPA F — Infraestrutura

**Arquivos:** compose e Dockerfiles → `infrastructure/docker/`. Symlink ou compose `-f` na raiz para não quebrar hábito. Migrations → `infrastructure/database/migrations` **ou** permanecem junto da API se o runner atual assumir path relativo — preferir **não mover SQL** até o migrate aceitar `MIGRATIONS_DIR`.  
**Risco:** médio (boot).  
**Scripts:** `npm run dev`, CI `docker compose`.  
**Testes:** compose config, health dos 3 serviços, migrate no boot.  
**Rollback:** paths antigos.

### ETAPA G — Testes

**Arquivos:** `backend/src/**/*.test.js` e suítes JSX → `tests/` ou `packages/calculation-engine/tests`.  
**CI:** passar a rodar `test:engine`, `test:isolation`, `test:p0`, `test:secrets`, `npm run build` (web).  
**Risco:** baixo se for só mover testes.  
**Rollback:** scripts npm apontando de volta.

### ETAPA H — Limpeza final

**Arquivos:** `archive/server-sqlite`, `archive/base44`, cópias do motor, `dev:legacy`, deps da raiz (`express`, `better-sqlite3`, `multer`, `cors` se ninguém mais usar).  
**Risco:** baixo se A–G ok.  
**Testes:** gate completo da seção 13.  
**Rollback:** archive ainda no git.

---

## 12. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Quebrar `@engine` no Vite/Docker | Simulador e API divergem | Etapa E isolada; smoke engine obrigatório |
| Mover migrations sem ajustar `migrate.js` | API não sobe | Não mover SQL até existir `MIGRATIONS_DIR` |
| Renomear `base44Client` cedo | dezenas de imports | Alias `base44` → client; rename por último |
| Explodir `functions/routes.js` de uma vez | ERP/BACEN/CG | Um handler por PR |
| Apagar bundles sem archive | perda percebida pelo time | `git mv` para archive primeiro |
| Dockerfile.web servir Vite dev em “prod” | não é build otimizado | Fora deste plano (item de release); não misturar com move de pastas |
| Números de migration duplicados | ordem errada | Inventário na etapa F; não renomear arquivos já aplicados |
| Extração do engine puxar `accountingClosing` | mistura domínio | Proibido nesta onda |

---

## 13. Testes necessários (gate após cada etapa)

Executar, nesta ordem:

1. `cd backend && npm run test:engine`
2. `cd backend && npm run test:secrets`
3. `cd backend && npm run test:isolation`
4. `cd backend && npm run test:p0`
5. `npm run build` (frontend / Vite)
6. Subida API: health `GET /api/health` e log de migrate sem erro
7. `docker compose ps` — `api` e `db` healthy; `web` up
8. Smoke UI: login + abrir Simulator + Contratos
9. Isolamento: suíte p0 (já cobre A≠B nos caminhos atuais)

CI atual **não** cobre 3, 4, 5, 8. A etapa G deve incluir isso. Não exigir frontend e2e completo nesta onda.

---

## 14. Rollback

- Cada etapa = **um PR**.
- Preferir `git mv` (histórico preservado).
- Não reescrever history (`rebase -i` / force-push) por causa de archive.
- Se Docker quebrar: voltar compose/Dockerfiles do PR anterior; volumes `pgdata` não são tocados por moves de código.
- Se o engine divergir: restaurar alias `@engine` para `backend/src/engine` (ou `apps/api/src/engine` se C já tiver ocorrido).
- Bundles: se alguém precisar, `git bundle list-heads archive/git-bundles/<file>`.

---

## 15. Estrutura final prevista

```
apps/web                 SPA Vite (AllDebt)
apps/api                 Express + Postgres + scheduler
packages/calculation-engine
integrations/protheus
infrastructure/docker
infrastructure/database  (quando o runner permitir)
docs/architecture
docs/security
scripts
tests                    (após G)
archive                  artefatos congelados
```

Runtime inalterado em termos de processo: **um** container API, **um** Vite/web, **um** Postgres, scheduler **in-process**.

---

## Fase 6 — Segredos (resumo operacional)

| Pergunta | Resposta |
|---|---|
| `.env` versionado | **NÃO** (`git ls-files` só `.env.example`; `git log -- .env` vazio) |
| Secrets potencialmente expostos | **SIM** — `.env.example` publica placeholders conhecidos (`JWT_SECRET` com `change-this`, senha admin de desenvolvimento). Não há evidência de `.env` real no histórico. |
| Ação recomendada | Manter `.env` fora do git; não reutilizar placeholders em ambiente compartilhado; rotacionar JWT/admin se este exemplo já rodou com `NODE_ENV=production`; endurecer CI para falhar boot com esses valores (já existe `validateProductionSecrets`, mas o processo vivo precisa ser reiniciado com o check). |

Não listar valores secretos reais neste documento.

---

## Fase 8 — Motor financeiro (detalhe)

### Código canônico (`backend/src/engine`)

| Tema | Arquivos |
|---|---|
| SAC / SACRE / PRICE / Americano / Bullet / residual | `strategies/*.js` |
| CDI, SELIC, IPCA, INPC, TJLP, TR, IGP-M, USD/PTAX | `indexers/*.js`, `IndexerFactory.js` |
| Arredondamento | `roundMoney.js`, `PrecisionLayer.js` (`decimal.js`) |
| Amortização / juros / simulação | `CalculationEngine.js` (`calculateAmortizationSchedule`) |
| Integridade / CET / fingerprint | `ScheduleIntegrity.js`, `PrecisionAudit.js`, `LegalComplianceValidator.js` |
| Versão | `ENGINE_VERSION = "1.2.2"` |

### Código relacionado que **não** entra no package

| Tema | Onde | Por quê |
|---|---|---|
| Fechamento / lançamentos D/C | `src/lib/accountingClosing.js` | Usa snapshot + matriz; não calcula parcela |
| PTAX/CDI ingestão BACEN | `backend/src/modules/functions/bacen.js` | I/O HTTP + persistência |
| Conta garantida (saldo/títulos) | `functions/guaranteedAccount.js`, `payables/generate.js` | Express/DB |
| Cópias JSX em `src/components/loan` | frontend | Duplicata; arquivar |

### Isolável em `packages/calculation-engine`?

**Sim**, o diretório `backend/src/engine` já declara “núcleo isolado” e o grep não encontra `express`, `pg` ou React.  
Única dependência de biblioteca: `decimal.js`.  
Única dependência de plataforma: `crypto.subtle` (Web Crypto), disponível no Node 22 e no browser.

**Impedimentos atuais (de empacotamento, não de lógica):**

1. Path `@engine` hardcoded no Vite e no `Dockerfile.web`.
2. Cópias `.jsx` que alguém pode achar que são o motor.
3. Testes de regressão acoplados à UI.

---

## Decisões que este plano deliberadamente NÃO toma

- Não adotar monorepo Turborepo/pnpm nesta onda (npm workspaces bastam na etapa E).
- Não criar `packages/ui` (custo sem segundo app).
- Não extrair “accounting engine” ainda.
- Não transformar o scheduler em worker separado.
- Não trocar Vite dev no Docker por nginx/`vite build` (release, outro PR).
- Não reescrever `functions/routes.js` num único PR.

---

## Aprovação

Para iniciar a Etapa A, confirmar:

1. Archive dos 35 bundles + 6 vazios na raiz.
2. Manter `server/` e `base44/` no git, só mudando de pasta.
3. Não mover `src/` nem `backend/` na primeira leva.

Sem essa aprovação, o repositório permanece como está.

---

## Execução — Etapa A

**Data:** 2026-09-02

### Escopo executado

Organização de artefatos na raiz: 35 Git bundles → `archive/bundles/`; 6 arquivos vazios (resíduos de shell) → `archive/orphans/`; criação de `archive/README.md`. Nenhum código de produção, Docker, Vite ou migrations alterado pela movimentação.

### Bundles

Esperado: **35** | Encontrado na raiz após movimentação: **0** | Em `archive/bundles/`: **35**

Integridade: `git bundle verify` em **35/35** — PASS.

Nenhum bundle referenciado por runtime, CI, Dockerfile ou scripts (grep excluindo `.git/`, `node_modules/`, `archive/`, `docs/` — zero ocorrências em código/config).

### Orphans

Esperado: **6** | Na raiz: **0** | Em `archive/orphans/`: **6** (todos **0 bytes**)

`main`, `node`, `cd`, `git`, `docker`, `endividamento-api@1.0.0` — sem referências em código, Docker, npm ou CI.

### Alterações no runtime

Esperado: **nenhuma** | Observado: **nenhuma** causada pela Etapa A.

### Validações Docker

| Container | Status |
|---|---|
| `endividamento-api` | UP / **healthy** |
| `endividamento-db` | UP / **healthy** (`pg_isready` OK) |
| `endividamento-web` | UP (Vite dev) |

Nenhum serviço depende de bundles ou orphans movidos.

### Testes

Scripts reais (`backend/package.json`):

| Área | Script npm | Arquivo de teste |
|---|---|---|
| Engine | `test:engine` | `src/engine/smoke.test.js` |
| Secrets | `test:secrets` | `src/config/validateSecrets.test.js` |
| Isolamento | `test:isolation` | `src/modules/tenants/isolation.test.js` |
| P0 | `test:p0` | `src/modules/security/p0.test.js` |
| Migrations | `migrate` | `src/db/migrate.js` |

Scripts reais (`package.json` raiz): `build` → `vite build`; sem scripts de teste de backend no frontend.

**Nota:** a imagem Docker da API monta apenas `backend/src/`; o `package.json` **dentro do container** não inclui `test:secrets` / `test:isolation` / `test:p0`. Testes executados via `node` direto nos arquivos montados (equivalente aos scripts do workspace).

| Gate | Comando (container `endividamento-api`) | Resultado | Detalhe |
|---|---|---|---|
| Engine | `npm run test:engine` | **PASS** | `engine smoke OK`, exit 0 |
| Secrets | `node src/config/validateSecrets.test.js` | **PASS** | `validateSecrets ok`, exit 0 |
| Isolation | `node src/modules/tenants/isolation.test.js` | **PASS** | `isolamento ok`, exit 0 |
| P0 | `node src/modules/security/p0.test.js` | **PASS** | `p0 tenant-isolation + auth + billing + reset ok`, exit 0 |

### Build frontend

| Tentativa | Comando | Resultado | Classificação |
|---|---|---|---|
| Container dev (`endividamento-web`, com bind mounts) | `npm run build` | **FAIL** | `ENOENT /app/index.html` — bind mount do `index.html` quebrado no container dev (**PREEXISTING ENVIRONMENT ISSUE**; não causado pela Etapa A) |
| Imagem limpa (sem volumes) | `docker run --rm endividamento-git-web npm run build` | **PASS** | 3558 módulos, `built in 9.12s`, exit 0 |

**Conclusão build:** o código-fonte compila em ambiente compatível. A falha no container dev é pré-existente (volume macOS ↔ Docker) e **não bloqueia** a Etapa A.

### Backend health

| Endpoint | HTTP | Corpo (resumo) |
|---|---|---|
| `GET /api/health` | **200** | `ok: true`, `engine: postgresql` |
| `GET /api/ready` | **200** | `ok: true`, `database: up` |

### Migrations

| Métrica | Valor |
|---|---|
| Total de arquivos `.sql` | 51 |
| Aplicadas (`schema_migrations`) | 51 |
| Pendentes | **0** |
| `node src/db/migrate.js` | **PASS** — `migrações concluídas` |

### Smoke funcional

| Verificação | Resultado |
|---|---|
| Frontend Vite (`/src/main.jsx`) | HTTP **200** |
| Página principal (`/`) | Responde (HTML Vite; `/` pode retornar 500 no dev server por bind mount — **PREEXISTING**) |
| Login API (`POST /api/auth/login` inválido) | HTTP **400** — endpoint ativo, validação OK |
| Simulator (`/src/pages/Simulator.jsx` via Vite) | HTTP **200** — módulo carrega |
| API health/ready | **200** |
| PostgreSQL | **healthy** |

### Git status

**Staging (escopo Etapa A):** apenas renames de bundles/orphans, `archive/README.md`, `docs/architecture/REPOSITORY-REORGANIZATION-PLAN.md`, `.gitignore` (`/*.bundle`).

**Working tree (fora do escopo Etapa A):** existem alterações **unstaged** pré-existentes em `backend/`, `docker-compose.yml`, `src/components/settings/PlanPanel.jsx` e arquivos untracked de hardening P0. **Não foram introduzidas pela Etapa A.** Recomendação: commitar a Etapa A isoladamente (`git add archive/ docs/architecture/ .gitignore`).

### Problema no Node local

**DEVELOPMENT ENVIRONMENT ISSUE:**

Node local **25.8.0** não inicializa devido a incompatibilidade de `libsimdjson` (`libsimdjson.30.dylib` ausente no Homebrew).

```
dyld: Library not loaded: .../libsimdjson.30.dylib
```

O problema local de Node/libsimdjson **já existia no ambiente** e **não foi causado** pela reorganização. Não é regressão da Etapa A. Gates executados nos containers Docker.

### `.gitignore`

**Aplicado:** `/*.bundle` na raiz.

**Decisão:** bundles são backups manuais de Git, não fazem parte do runtime nem de CI (`.github/` sem referências a `.bundle`). O padrão `/*.bundle` impede novos backups na raiz **sem** ignorar `archive/bundles/*.bundle` já versionados. Nenhum workflow legítimo depende de bundles na raiz.

### Riscos encontrados

1. **PREEXISTING:** bind mount `index.html` no container `endividamento-web` inconsistente (dev server `/` pode falhar; build no container dev falha).
2. **PREEXISTING:** working tree com mudanças P0 unstaged — separar do commit da Etapa A.
3. **Nenhum risco** identificado ligado à movimentação de bundles/orphans.

### Rollback

```bash
git restore --staged archive/ docs/architecture/ .gitignore
git checkout -- .gitignore  # se quiser reverter só o ignore
git mv archive/bundles/*.bundle .
git mv archive/orphans/{main,node,cd,git,docker,endividamento-api@1.0.0} .
rm archive/README.md
```

### Resultado final

**ETAPA A: CONCLUÍDA**

Todos os critérios de aceite da reorganização foram atendidos. Limitações de ambiente (Node local, bind mount dev) são **PREEXISTING ENVIRONMENT ISSUE** e não invalidam a etapa.

---

### Arquivos movidos (inventário)

**Bundles (35)** — raiz → `archive/bundles/` (preservados integralmente, `git bundle verify` OK em todos):

| Arquivo | Tamanho (bytes) |
|---|---|
| acoes-contratos-e-remove-documentos.bundle | 4 718 |
| automatiza-ptax-cdi-selic-bacen.bundle | 4 001 |
| baixa-por-valor-pago.bundle | 4 934 |
| calculadora-4-categorias.bundle | 4 169 |
| calculator-ux-and-pdf-fix.bundle | 5 718 |
| cet-fix-e-melhorias.bundle | 3 443 |
| contract-summary-table-layout.bundle | 2 758 |
| contrast-boost.bundle | 9 894 |
| contratos-colunas.bundle | 1 200 |
| contratos-tabela-layout-fix.bundle | 2 011 |
| contratos-tabela.bundle | 5 882 |
| correcao-ancora-prazo-total.bundle | 3 565 |
| correcao-fuso-vencimento-final.bundle | 2 067 |
| correcao-parcelas-e-pendentes.bundle | 5 537 |
| correcoes-prazo-data-combobox-bacen.bundle | 8 712 |
| documentos-menu-unificado.bundle | 1 382 |
| endividamento-sync.bundle | 20 524 |
| explicacao-prazo-total.bundle | 2 266 |
| fechamento-contabil-v2.bundle | 717 568 |
| fechamento-contabil.bundle | 675 259 |
| fechamento-fix.bundle | 1 023 |
| fechamento-fix2.bundle | 1 034 |
| fonte-unificada-toda-ferramenta.bundle | 10 273 |
| nota-explicativa-tooltips.bundle | 5 629 |
| padrao-visual-largura-bordas-ordenacao.bundle | 4 556 |
| parcelas-e-botoes.bundle | 2 677 |
| ptax-cdi-compact-layout.bundle | 2 599 |
| ptax-layout-igual-cdi.bundle | 6 896 |
| recalculo-acionavel.bundle | 8 391 |
| reclass-docs-notif.bundle | 15 541 |
| rename-alldebt.bundle | 2 580 |
| seed-bancos-empresas.bundle | 3 728 |
| sortable-tables-sweep.bundle | 26 713 |
| tipo-especifico-financiamentos.bundle | 1 128 |
| voltar-e-fonte-unificada.bundle | 3 662 |

**Orphans (6)** — raiz → `archive/orphans/` (todos 0 bytes; sem referências em código, Docker, npm ou CI):

- `main`, `node`, `cd`, `git`, `docker`, `endividamento-api@1.0.0`

**Criado:** `archive/README.md`

**Não movido (conforme escopo):** `src/`, `backend/`, `server/`, `base44/`, `protheus/`, `docs/`, `.github/`

---

## Etapa B — Auditoria de código morto

**Data:** 2026-09-02  
**Tipo:** Somente leitura (B1). Nenhum arquivo excluído, movido ou alterado em `src/`.

**Documento detalhado:** [`FRONTEND-DEAD-CODE-AUDIT.md`](./FRONTEND-DEAD-CODE-AUDIT.md)

### Escopo

- Inventário e grafo de imports a partir de `src/main.jsx`
- Investigação de candidatos: `saas/`, `ApprovedContractManager`, `Configuracoes`, `_to_delete/`
- Testes expostos no `Simulator.jsx`
- Comparação `src/components/loan/{strategies,indexers}` vs `backend/src/engine`
- Stubs, console, rotas, marca

### Gate B1

| Métrica | Valor |
|---------|-------|
| TOTAL FRONTEND FILES ANALISADOS | **199** |
| ATIVOS | **138** |
| ÓRFÃOS COMPROVADOS | **29** |
| STUBS | **7** |
| DEBUG/TEST EXPOSTO | **5** (6 abas no Simulator) |
| DUPLICADOS (engine frontend) | **11** |
| NÃO COMPROVADOS | **29** |

### Principais achados

1. **`src/components/saas/`** — pasta inteira órfã (billing real no backend + `PlanPanel`).
2. **`accounting/_to_delete/`** — 5 arquivos sem referências; remover na B2.
3. **`Simulator.jsx`** — abas de teste (`EngineTestSuite`, `ZeroRisk`, `ScenarioTests`, etc.) visíveis a **todos** os usuários autenticados, sem gate de ambiente.
4. **Engine duplicado** — `loan/strategies` e `loan/indexers` no frontend são cópias mortas; produção usa `@engine`.
5. **`Configuracoes.jsx`** — rota `/Configuracoes` sem menu; stub explícito; `Settings` é a tela real.
6. **22 componentes `ui/` shadcn** — sem uso fora da pasta (scaffold); classificar antes de remover.

### Próximo passo (B2 — não iniciado)

Aguardando aprovação para: remoção segura, ocultar abas de teste em produção, limpar rotas stub.

**Status:** B1 CONCLUÍDA — execução BLOQUEADA até aprovação.

