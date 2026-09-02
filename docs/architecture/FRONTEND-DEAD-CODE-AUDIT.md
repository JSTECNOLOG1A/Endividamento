# Auditoria de código morto — Frontend (Etapa B1)

**Data:** 2026-09-02  
**Escopo:** `src/` — somente leitura; nenhum arquivo movido, excluído ou alterado.  
**Entry point analisado:** `src/main.jsx` → `App.jsx` → `pages.config.js` → páginas → componentes.

---

## Metodologia

1. Inventário de 199 arquivos em `src/` (`.jsx`, `.js`, `.ts`, `.css`).
2. Grafo de imports a partir de `main.jsx`, `pages.config.js` e cadeias de páginas.
3. Verificação cruzada com `rg` para imports, rotas (`App.jsx`, `Layout.jsx`), `React.lazy` / `import()` (nenhum lazy route encontrado).
4. Comparação `src/components/loan/{strategies,indexers}` vs `backend/src/engine/`.
5. Classificação conservadora: **ÓRFÃO** apenas com zero importadores fora do próprio arquivo/pasta.

**Legenda de ações:**

| Ação | Significado |
|------|-------------|
| SAFE REMOVE | Evidência forte de não uso; remoção provável na B2 |
| SAFE HIDE FROM PRODUCTION | Manter código; ocultar da UI de clientes |
| KEEP | Produção ativa |
| REFACTOR LATER | Ativo ou parcialmente ativo; consolidar depois |
| INVESTIGATE | Uso não comprovado; validar antes de remover |
| DO NOT TOUCH | Crítico ou ambíguo demais nesta fase |

---

## Resumo executivo

| Métrica | Valor |
|---------|-------|
| Arquivos analisados | **199** |
| Ativos (produção) | **138** |
| Órfãos comprovados | **29** |
| Stubs / legado explícito | **7** |
| Debug/test exposto na UI | **5** componentes (6 abas no Simulator) |
| Duplicados do engine (frontend morto) | **11** arquivos |
| Não comprovados | **29** (principalmente `ui/` shadcn não referenciado) |

---

## Tabela principal

| Arquivo | Status | Evidência | Ação proposta | Risco |
|---------|--------|-----------|---------------|-------|
| `src/components/saas/SaaSGuard.jsx` | ÓRFÃO | Zero importadores em `src/` | SAFE REMOVE | Baixo |
| `src/components/saas/BillingHooks.jsx` | ÓRFÃO | Importado só por `SaaSGuard.jsx` | SAFE REMOVE | Baixo |
| `src/components/saas/PlanService.jsx` | ÓRFÃO | Importado só por `saas/` | SAFE REMOVE | Baixo |
| `src/components/saas/TenantService.jsx` | ÓRFÃO | Importado só por `saas/` | SAFE REMOVE | Baixo |
| `src/components/saas/UserRoleService.jsx` | ÓRFÃO | Importado só por `saas/` | SAFE REMOVE | Baixo |
| `src/components/accounting/_to_delete/*` (5 arquivos) | ÓRFÃO / LEGADO | Pasta nomeada `_to_delete`; zero importadores externos | SAFE REMOVE | Baixo |
| `src/components/accounting/ApprovedContractManager.jsx` | ÓRFÃO | 596 linhas; zero importadores; fluxo ativo usa `FechamentoContabil` | SAFE REMOVE | Médio — validar se há plano de reintroduzir aprovação |
| `src/components/analytics/*` (6 arquivos) | ÓRFÃO | Zero importadores fora da pasta; testes internos apenas | SAFE REMOVE | Baixo |
| `src/components/UserNotRegisteredError.jsx` | ÓRFÃO | Zero importadores; texto legado Base44 em inglês | SAFE REMOVE | Baixo |
| `src/lib/app-params.js` | ÓRFÃO / LEGADO | Zero importadores; helpers `base44_*` / `VITE_BASE44_*` | SAFE REMOVE | Baixo |
| `src/pages/Configuracoes.jsx` | STUB / LEGADO | Rota `/Configuracoes` sem menu; texto admite “não conectado ao backend”; duplica `Settings` | SAFE REMOVE (+ rota) | Médio — bookmark manual possível |
| `src/components/loan/strategies/*` (5 arquivos) | ÓRFÃO / DUPLICADO | Zero importadores; motor real em `@engine` / `backend/src/engine/strategies` | SAFE REMOVE | Baixo após confirmar zero import dinâmico |
| `src/components/loan/indexers/*` (5 arquivos) | ÓRFÃO / DUPLICADO | Zero importadores; backend tem 10 indexers canônicos | SAFE REMOVE | Baixo |
| `src/components/loan/roundMoney.jsx` | DUPLICADO / LEGADO | Produção usa `@engine/roundMoney.js`; cópia usada só por testes/auditoria locais | REFACTOR LATER | Médio |
| `src/components/loan/CalculationEngine.jsx` | ATIVO (ponte) | Re-export de `@engine`; usado por suítes de teste na UI | KEEP (ponte) / REFACTOR LATER | Baixo |
| `src/lib/runCalculation.js` | ATIVO | `Simulator` → `@engine/CalculationEngine.js` | KEEP | — |
| `src/pages/Simulator.jsx` | ATIVO + DEV | Página principal; abas de teste sem gate de ambiente/role | SAFE HIDE FROM PRODUCTION (abas) | Alto se remover página |
| `src/components/loan/EngineTestSuite.jsx` | TEST / DEV ONLY | Aba “🧪 Testes” no Simulator; visível a todo usuário autenticado | SAFE HIDE FROM PRODUCTION | Baixo |
| `src/components/loan/ZeroRiskRegressionTest.jsx` | TEST / DEV ONLY | Aba “🔐 Zero Risk” no Simulator | SAFE HIDE FROM PRODUCTION | Baixo |
| `src/components/loan/ScenarioTests.jsx` | TEST / DEV ONLY | Aba “🧪 Cenários” no Simulator | SAFE HIDE FROM PRODUCTION | Baixo |
| `src/components/loan/SnapshotValidationTest.jsx` | TEST / DEV ONLY | Aba “🔐 Snapshot” no Simulator | SAFE HIDE FROM PRODUCTION | Baixo |
| `src/components/loan/IntegrityValidator.jsx` | TEST / DEV ONLY | Aba “🔐 Integridade” no Simulator | SAFE HIDE FROM PRODUCTION | Baixo |
| `src/components/loan/EngineTestSuiteEtapa3.jsx` | TEST ONLY | Sem rota/UI; comentário CLI `node -e import(...)` | SAFE REMOVE | Baixo |
| `src/components/loan/FinalHardeningTests.jsx` | TEST ONLY | Sem importadores de páginas | SAFE REMOVE | Baixo |
| `src/components/loan/SnapshotRegressionTest.jsx` | TEST ONLY | Sem UI | SAFE REMOVE | Baixo |
| `src/components/loan/SnapshotRegressionTestEtapa4A.jsx` | TEST ONLY | Sem UI | SAFE REMOVE | Baixo |
| `src/components/loan/CalculationSnapshotTests.jsx` | TEST ONLY | Sem UI | SAFE REMOVE | Baixo |
| `src/components/loan/CalculationSnapshotIntegrationTests.jsx` | TEST ONLY | Sem UI | SAFE REMOVE | Baixo |
| `src/components/loan/AUDIT_FX_INTEGRITY.jsx` | TEST ONLY | Sem UI | SAFE REMOVE | Baixo |
| `src/components/loan/roundMoney.test.jsx` | TEST ONLY | Teste manual documentado no arquivo | KEEP ou mover para `tests/` | Baixo |
| `src/components/loan/AuditLog.jsx` | ÓRFÃO | Classe exportada; zero importadores | INVESTIGATE | Médio |
| `src/components/loan/LegalComplianceValidator.jsx` | ÓRFÃO | Zero importadores | INVESTIGATE | Médio |
| `src/components/loan/ExchangeRateManager.jsx` | ÓRFÃO | Zero importadores de páginas | INVESTIGATE | Médio |
| `src/components/loan/ExportBrowserAdapter.jsx` | ÓRFÃO | Zero importadores | INVESTIGATE | Médio |
| `src/components/loan/CalculationSnapshotIntegration.jsx` | TEST ONLY | Só importado por testes | SAFE REMOVE (com testes) | Baixo |
| `src/components/loan/AccountingEntries.jsx` | TEST / EXPORT | Usado por `ExportOrchestrator` → só testes | REFACTOR LATER | Médio |
| `src/components/loan/ExportOrchestrator.jsx` | TEST / EXPORT | Só `SnapshotRegressionTestEtapa4A` | REFACTOR LATER | Médio |
| `src/components/loan/FinancialExport.jsx` | TEST / EXPORT | Só `ExportOrchestrator` | REFACTOR LATER | Médio |
| `src/components/loan/PrecisionLayer.jsx` | TEST / AUDIT | Cadeia `PrecisionAudit` / `ScheduleIntegrity` (testes) | REFACTOR LATER | Médio |
| `src/components/loan/PrecisionAudit.jsx` | TEST ONLY | Sem UI | INVESTIGATE | Médio |
| `src/components/loan/PrecisionGovernance.jsx` | TEST ONLY | Sem UI | INVESTIGATE | Médio |
| `src/components/loan/ScheduleIntegrity.jsx` | TEST ONLY | Usado por `CalculationSnapshotTests` | INVESTIGATE | Médio |
| `src/components/ui/accordion.jsx` (+ 21 componentes shadcn) | NÃO COMPROVADO | Zero imports fora de `ui/` | INVESTIGATE | Baixo — scaffold shadcn |
| `src/pages/Settings.jsx` | ATIVO | Menu “Configurações”; painéis reais | KEEP | — |
| `src/Layout.jsx` | ATIVO | Shell + `NAV_ITEMS` | KEEP | — |
| Demais páginas (11) | ATIVO | Registradas em `pages.config.js` + menu (exceto Configuracoes) | KEEP | — |
| `src/api/*` (10) | ATIVO | Consumidos por páginas/contextos | KEEP | — |
| `src/lib/AuthContext.jsx` etc. | ATIVO | `App.jsx` + páginas | KEEP | — |

---

## Fase B3 — Achados anteriores (detalhe)

### `src/components/saas/*`

| Arquivo | Imports recebidos | Imports realizados | Rota | Runtime | Teste | Status | Recomendação |
|---------|-------------------|--------------------|------|---------|-------|--------|--------------|
| `SaaSGuard.jsx` | Nenhum | `TenantService`, `PlanService`, `UserRoleService`, `BillingHooks` | — | Não | Não | ÓRFÃO | Remover pasta na B2 |
| `BillingHooks.jsx` | `SaaSGuard` | `base44Client` | — | Não | Não | ÓRFÃO | Idem |
| `PlanService.jsx` | `SaaSGuard` | `TenantService`, `base44Client` | — | Não | Não | ÓRFÃO | Idem |
| `TenantService.jsx` | `saas/*` | `base44Client` | — | Não | Não | ÓRFÃO | Idem |
| `UserRoleService.jsx` | `SaaSGuard` | — | — | Não | Não | ÓRFÃO | Idem |

Cliente SaaS real hoje: `backend/` billing + `PlanPanel.jsx` / API REST.

### `ApprovedContractManager.jsx`

| Campo | Valor |
|-------|-------|
| Imports recebidos | **Nenhum** |
| Imports realizados | `base44Client`, `CalculationSnapshotPersistence`, UI |
| Rota | Não |
| Runtime | Não montado |
| Teste | Não |
| Status | **ÓRFÃO** |
| Recomendação | Remover ou arquivar; fluxo de aprovação está em `FechamentoContabil.jsx` |

### `Configuracoes.jsx`

| Campo | Valor |
|-------|-------|
| Imports recebidos | `pages.config.js` apenas |
| Rota | `/Configuracoes` (autenticada) |
| Menu | **Não** — menu aponta para `Settings` |
| Runtime | Renderiza stub estático |
| Texto explícito | “campos ainda não estão conectados ao backend” |
| Status | **STUB / LEGADO** |
| Recomendação | Remover página + entrada em `PAGES`; manter `Settings` |

### `accounting/_to_delete/`

| Arquivo | Status | Evidência |
|---------|--------|-----------|
| `AccountingAnalysis.jsx` | ÓRFÃO | Zero importadores |
| `DebtAnalyticsDashboard.jsx` | ÓRFÃO | Import quebrado para `./debtAnalytics` (arquivo está no pai) |
| `DebtMapByMonth.jsx` | ÓRFÃO | Só `_to_delete/` |
| `DebtMapHierarchical.jsx` | ÓRFÃO | Só `_to_delete/` |
| `debtMapUtils.jsx` | ÓRFÃO | Só `_to_delete/` |

Cadeia contábil **ativa:** `Accounting.jsx` → `AccountingReading` → `FechamentoContabil` → `debtAnalytics.jsx` (fora de `_to_delete`).

---

## Fase B4 — Testes expostos no Simulator

**Origem:** `src/pages/Simulator.jsx` — abas no painel direito após cálculo (`result` truthy).

| Componente | Aba UI | Condição de render | Ambiente | Classificação |
|------------|--------|--------------------|----------|---------------|
| `EngineTestSuite` | 🧪 Testes | `result` + aba ativa; **sem** `NODE_ENV` / role | Produção (todos autenticados) | **DEV ONLY** |
| `ZeroRiskRegressionTest` | 🔐 Zero Risk | Idem | Produção | **DEV ONLY** |
| `ScenarioTests` | 🧪 Cenários | Idem | Produção | **DEV ONLY** |
| `SnapshotValidationTest` | 🔐 Snapshot | Idem | Produção | **TEST ONLY** |
| `IntegrityValidator` | 🔐 Integridade | Idem | Produção | **TEST ONLY** |

**Proposta (B2, não implementada):** ocultar abas `snapshot`, `testes`, `regression`, `integrity`, `scenarios` quando `import.meta.env.PROD` ou flag `VITE_ENABLE_ENGINE_LABS !== 'true'`. Manter `test:engine` no backend.

**PRODUCTION REQUIRED:** `ContractForm`, `AmortizationTable`, `ScheduleChart`, `runCalculation` — abas “Memória de Cálculo” e “Gráficos”.

---

## Fase B5 — Cópia morta do engine

### Produção (canônico)

| Caminho | Uso |
|---------|-----|
| `backend/src/engine/**` | API + migrations + `test:engine` |
| `@engine/*` (alias Vite) | `runCalculation.js`, `CalculationEngine.jsx`, `cetFromSchedule.js` |
| `src/lib/runCalculation.js` | Simulator em tempo real |

### Frontend legado (não referenciado)

| Pasta | Arquivos | Backend equivalente | Divergência |
|-------|----------|---------------------|-------------|
| `src/components/loan/strategies/` | 5 `.jsx` | 6 `.js` (+ `SACREStrategy`) | Cópia antiga; **zero imports** |
| `src/components/loan/indexers/` | 5 `.jsx` | 10 `.js` | Faltam IPCA, INPC, IGPM, TJLP, TR; **zero imports** |
| `src/components/loan/roundMoney.jsx` | 1 | `@engine/roundMoney.js` | Usado só por testes locais |

**Conclusão:** implementação de produção é **`@engine`**. Pastas `strategies/` e `indexers/` no frontend são **cópia morta** candidata a remoção na B2.

`CalculationEngine.jsx` **não** é duplicata — é facade intencional para testes UI apontarem ao mesmo bundle que a API.

---

## Fase B6 — Stubs e marcadores

| Ocorrência | Arquivo / contexto | Classificação |
|------------|-------------------|---------------|
| “não estão conectados ao backend” | `Configuracoes.jsx` | **DEVE SAIR DA PRODUÇÃO** |
| “Motor de Cálculo: Local (SQLite)” | `Configuracoes.jsx` | **LEGADO / incorreto** (hoje PostgreSQL) |
| `MOCK_CONTRACT` / snapshot mock | `CalculationSnapshotTests.jsx` | **DEV ONLY** |
| `status === "simulado"` | `EmailDialog.jsx` | **ACEITÁVEL** (SMTP ausente) |
| `window.prompt` link convite | `UsersPanel.jsx` | **ACEITÁVEL** dev; **RISCO** UX em produção |
| `alert(` validações | `ContractForm.jsx`, `MonthlyIndexImporter.jsx` | **FUNCIONALIDADE INCOMPLETA** / UX legado |
| `// DEBUG` | `ContractForm.jsx` | **DEV ONLY** |
| `TODO` / `FIXME` | Poucas ocorrências reais; maioria é texto de domínio (“todos os títulos”) | — |

---

## Fase B7 — Console

**~350+ `console.log`** concentrados em arquivos de teste (`FinalHardeningTests`, `SnapshotRegressionTest*`, `CalculationSnapshot*`, `DebtAnalytics4CTests`, `EngineTestSuiteEtapa3`).

| Categoria | Exemplos | Classificação |
|-----------|----------|---------------|
| Suítes de teste UI/CLI | `EngineTestSuiteEtapa3`, `CalculationSnapshotTests` | Debug esperado em teste |
| Debug esquecido | `ContractForm.jsx` (1), `Simulator.jsx` (3) | Revisar na B2 |
| Erro esperado | `ExchangeRateManager` `console.error` upload | Logging legítimo |
| Sensível | Nenhum secret literal encontrado em `console.log` | — |

**Não remover** `console.error` de handlers de upload/import sem substituir por telemetria.

---

## Fase B8 — Rotas

### Autenticado (`pages.config` + `App.jsx`)

| URL | Página | Menu | Permissão | Status |
|-----|--------|------|-----------|--------|
| `/` | Simulator | Calculadora | Autenticado | ATIVO |
| `/Simulator` | Simulator | Calculadora | Autenticado | ATIVO |
| `/Contracts` | Contracts | Contratos | Autenticado | ATIVO |
| `/GuaranteedAccounts` | GuaranteedAccounts | Contas Garantidas | Autenticado | ATIVO |
| `/Governance` | Governance | Governança | Autenticado | ATIVO |
| `/Accounting` | Accounting | Contabilidade | Autenticado | ATIVO |
| `/Consolidation` | Consolidation | Consolidação | Autenticado | ATIVO |
| `/AccountsPayable` | AccountsPayable | Financeiro | Autenticado | ATIVO |
| `/AccountsReceivable` | AccountsReceivable | Financeiro | Autenticado | ATIVO |
| `/CDIManager` | CDIManager | Indexadores | Autenticado | ATIVO |
| `/UserManual` | UserManual | Manual | Autenticado | ATIVO |
| `/Settings` | Settings | Configurações | Autenticado | ATIVO |
| `/Configuracoes` | Configuracoes | **Sem menu** | Autenticado | **STUB / rota órfã** |
| `/onboarding` | Onboarding | — | Autenticado | ATIVO (fluxo cadastro) |

### Público

| URL | Componente | Status |
|-----|------------|--------|
| `/criar-conta` | Signup | ATIVO |
| `/concluir-cadastro` | CompleteSignup | ATIVO |
| `/esqueci-senha` | ForgotPassword | ATIVO |
| `/redefinir-senha`, `/aceitar-convite` | SetPassword | ATIVO |
| `*` (não auth) | Login | ATIVO |

**Inconsistências:** rota `/Configuracoes` sem menu; label “Configurações” no menu → `/Settings`.

---

## Fase B9 — Marca (sem rebranding)

| Nome | Onde aparece |
|------|----------------|
| **AllDebt** | `Layout.jsx` (header), `UserManual.jsx`, `Configuracoes.jsx`, exports `AmortizationTable`, `AccountingReading` |
| **BACEN** | `Layout.jsx` subtítulo, manual, importadores PTAX/CDI, comentários regulatórios |
| **Endividamento** | Docker/env, `_to_delete/DebtMap*`, `DebtAnalyticsService` (comentários), nome do repo |
| **FinCalc** | `BankAccountImportModal.jsx`, `NatureImportModal.jsx` (mensagens ERP legadas) |
| **Base44** | `base44Client.js`, `app-params.js`, `NavigationTracker` (`base44.appLogs`) |

---

## TOP 10 — candidatos mais seguros para remoção (B2)

| # | Arquivo(s) | Motivo | Evidência | Risco | Teste pós-remoção |
|---|------------|--------|-----------|-------|-------------------|
| 1 | `src/components/saas/*` (5) | Pasta inteira órfã | `rg` zero imports externos | Baixo | `npm run build`; smoke Settings/PlanPanel |
| 2 | `src/components/accounting/_to_delete/*` (5) | Marcados para delete | Zero importadores | Baixo | Abrir Contabilidade |
| 3 | `src/components/analytics/*` (6) | Analytics nunca montado | Zero importadores externos | Baixo | Build + smoke páginas principais |
| 4 | `src/components/accounting/ApprovedContractManager.jsx` | Substituído por fluxo em `FechamentoContabil` | Zero importadores | Médio | Fechamento contábil + contratos |
| 5 | `src/pages/Configuracoes.jsx` + rota | Stub duplicado de Settings | Sem menu; texto stub | Médio | Navegação Settings intacta |
| 6 | `src/components/UserNotRegisteredError.jsx` | Legado Base44 inglês | Zero importadores | Baixo | Fluxo login/signup |
| 7 | `src/lib/app-params.js` | Legado Base44 URL params | Zero importadores | Baixo | Auth + signup |
| 8 | `src/components/loan/strategies/*` (5) | Cópia morta do engine | Zero imports; `@engine` ativo | Baixo | `test:engine` + Simulator |
| 9 | `src/components/loan/indexers/*` (5) | Cópia morta do engine | Zero imports | Baixo | `test:engine` + CDIManager |
| 10 | `src/components/loan/EngineTestSuiteEtapa3.jsx` | CLI/test órfão | Sem UI; não importado | Baixo | `test:engine` backend |

---

## Status Etapa B1

**AUDITORIA CONCLUÍDA — aguardando aprovação para Etapa B2 (execução).**

Nenhum arquivo foi alterado nesta fase.
