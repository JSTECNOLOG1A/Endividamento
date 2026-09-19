# Planos comerciais AllDebt

**Versão:** 1.0  
**Data:** 2026-09-07  
**Produto:** AllDebt BACEN (plataforma de endividamento)  
**Fonte técnica:** `backend/src/modules/billing/plans.js`  
**PDF:** `docs/billing/PLANOS-ALLDEBT.pdf`

Este documento define a diferença oficial entre os planos **Starter**, **Pro** e **Enterprise**.  
Os limites de contratos e usuários são **aplicados no backend**. O empacotamento de módulos descreve o posicionamento comercial do produto (gates de feature podem ser endurecidos progressivamente).

---

## Resumo executivo

| | Starter | Pro | Enterprise |
|---|---|---|---|
| **Posicionamento** | Avaliação e operação enxuta | Time financeiro completo | Escala e governança corporativa |
| **Contratos ativos** | 10 | 50 | Ilimitado |
| **Usuários** | 3 | 10 | Ilimitado |
| **Suporte** | E-mail · horário comercial | E-mail prioritário | Canal dedicado · SLA |
| **Módulos** | Núcleo (calculadora/contratos) | Núcleo + contábil/financeiro/governança | Tudo Pro + escala e customização |

---

## Starter

**Tagline:** Operação enxuta e período de avaliação.

### Limites (enforced)
- Até **10** contratos ativos (status ≠ cancelado)
- Até **3** usuários do tenant (excluindo PLATFORM MASTER)

### Inclui
- Calculadora de endividamento
- Contratos (cadastro e fluxo básico)
- Indexadores e feriados
- Manual do usuário
- Configurações essenciais
- Exportações básicas
- Um grupo / filial operacional

### Não inclui (posicionamento Pro/Enterprise)
- Contabilidade e consolidação multi-empresa
- Financeiro (contas a pagar / receber)
- Governança avançada e integrações ERP
- SLA contratual e suporte dedicado

### Quando indicar
- Trial / POC
- Empresas pequenas com volume baixo de contratos
- Validação do produto antes de upgrade

---

## Pro

**Tagline:** Operação completa para times financeiros.

### Limites (enforced)
- Até **50** contratos ativos
- Até **10** usuários do tenant

### Inclui
- Tudo do Starter
- Contas garantidas
- Governança
- Contabilidade
- Consolidação
- Financeiro (contas a pagar e a receber)
- Integrações ERP (Protheus) no onboarding
- Múltiplas entidades no escopo do tenant
- Parâmetros de aparência e operação por tenant
- Trilha de auditoria operacional do tenant
- Suporte por e-mail prioritário (horário comercial ampliado)

### Não inclui
- Limites ilimitados
- SLA dedicado e CSM nomeado
- Customizações de produto sob contrato Enterprise

### Quando indicar
- Operação financeira diária com time dedicado
- Necessidade de contabilidade, consolidação e AP/AR
- Integração com ERP no go-live

---

## Enterprise

**Tagline:** Escala, governança e suporte dedicado.

### Limites (enforced)
- Contratos **ilimitados**
- Usuários **ilimitados**

### Inclui
- Tudo do Pro
- Operação multi-filial em escala
- Onboarding assistido
- Canal de suporte dedicado e **SLA sob contrato**
- Acesso assistido de suporte (PLATFORM MASTER) sob demanda, auditado
- Políticas avançadas de privacidade / LGPD no tenant
- Prioridade em roadmap e customizações contratadas
- Histórico e evidências para auditoria corporativa

### Quando indicar
- Grupos econômicos com alto volume
- Requisitos de compliance, SLA e governança
- Necessidade de customização e acompanhamento dedicado

---

## Matriz de comparação

| Capacidade | Starter | Pro | Enterprise |
|---|:---:|:---:|:---:|
| Calculadora / Contratos / Indexadores | ✓ | ✓ | ✓ |
| Contas garantidas | — | ✓ | ✓ |
| Governança | — | ✓ | ✓ |
| Contabilidade | — | ✓ | ✓ |
| Consolidação | — | ✓ | ✓ |
| Financeiro (AP/AR) | — | ✓ | ✓ |
| Integração ERP (onboarding) | — | ✓ | ✓ |
| Contratos ilimitados | — | — | ✓ |
| Usuários ilimitados | — | — | ✓ |
| SLA / suporte dedicado | — | — | ✓ |
| Onboarding assistido | — | — | ✓ |
| Customizações sob contrato | — | — | ✓ |

---

## Enforcement técnico (hoje)

| Regra | Onde |
|---|---|
| Limite de contratos | `assertCanCreateContract` em `backend/src/modules/tenants/policy.js` |
| Limite de usuários | `assertCanCreateUser` no mesmo módulo |
| Catálogo de planos | `backend/src/modules/billing/plans.js` |
| UI de plano | `src/components/settings/PlanPanel.jsx` · criação de tenant em Platform |
| Alteração de plano pelo cliente | Bloqueada (`BILLING_LOCKED`) — apenas PLATFORM MASTER / suporte |

> **Nota:** A matriz de módulos acima é a definição comercial oficial. O navegador ainda pode exibir entradas de menu para todos os módulos até que os feature gates por plano sejam ligados; os **limites de contratos/usuários** já bloqueiam criação quando o teto do plano é atingido.

---

## Upgrade / downgrade

1. Somente **PLATFORM MASTER** (ou fluxo futuro de billing) altera o plano.
2. Upgrade: limites sobem imediatamente; módulos do novo plano passam a fazer parte do entitlement.
3. Downgrade: se o uso atual exceder o novo teto, novas criações são bloqueadas até adequação (contratos/usuários existentes não são apagados automaticamente).
4. Histórico: ação `TENANT_PLAN_CHANGED` no audit da plataforma.

---

## Referências

- `docs/platform/PLATFORM-MASTER.md` — control plane e suporte auditado  
- `src/api/billing.js` — espelho frontend dos planos  
- `GET /api/billing/plan` — limites efetivos do tenant autenticado  
