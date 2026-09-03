# Central de Parâmetros — AllDebt

**Versão:** 1.0  
**Data:** 2026-09-02

## Visão geral

A Central de Parâmetros permite configurar dezenas ou centenas de opções **sem nova coluna no banco** e **sem nova tela por parâmetro**.

- **Definições (catálogo):** `backend/src/modules/parameters/definitions.js` — metadados, tipos, defaults, categorias.
- **Valores:** tabela `system_parameters` — escopos GLOBAL, TENANT, USER.
- **Resolução:** `resolveParameter(key)` — precedência USER → TENANT → GLOBAL → default do catálogo.

## Precedência

```
USER (group_id + user_id)
  ↓ se ausente
TENANT (group_id)
  ↓ se ausente
GLOBAL
  ↓ se ausente
DEFAULT do catálogo (código)
  ↓ se indisponível
Fallback seguro (ex.: appearance.default_layout → classic)
```

## Escopos

| Escopo | group_id | user_id | Quem altera |
|--------|----------|---------|-------------|
| GLOBAL | NULL | NULL | platform_admin |
| TENANT | tenant autenticado | NULL | OWNER, ADMIN, users.role=admin |
| USER | tenant autenticado | usuário autenticado | admin + futuro self-service |

O frontend **nunca** envia `group_id`. O backend obtém o tenant via JWT + `attachTenant`.

## Tipos suportados

| Tipo | Validação |
|------|-----------|
| BOOLEAN | boolean |
| INTEGER | Number.isInteger |
| DECIMAL | number finito |
| STRING | string |
| ENUM | valor ∈ allowedValues |
| JSON | qualquer JSON serializável |
| DATE / TIME | string não vazia |

## Categorias

Definidas em `PARAMETER_CATEGORIES`: general, appearance, contracts, finance, accounting, integrations, security, notifications, audit, system.

Parâmetros com `implemented: false` ficam no catálogo (arquitetura futura) mas **não aparecem na UI**.

## API

Base: `/api/parameters` (autenticado + tenant)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/parameters` | Lista parâmetros implementados + valores resolvidos |
| GET | `/api/parameters/categories` | Categorias |
| GET | `/api/parameters/:key` | Detalhe de um parâmetro |
| PATCH | `/api/parameters/:key` | Body: `{ value, scope?: "TENANT"\|"USER" }` |
| POST | `/api/parameters/reset` | Body: `{ key, scope? }` |

**Proibido no body:** `group_id`.

## Parameter Service

Arquivo: `backend/src/modules/parameters/service.js`

| Função | Uso |
|--------|-----|
| `getParameter(key)` | alias de resolveParameter |
| `getTenantParameter(key)` | valor TENANT bruto |
| `getUserParameter(key)` | valor USER bruto |
| `getGlobalParameter(key)` | valor GLOBAL bruto |
| `setParameter(key, value, { scope })` | grava + invalida cache |
| `resetParameter(key, { scope })` | remove override |
| `resolveParameter(key)` | valor efetivo com precedência |

## Cache

Arquivo: `backend/src/modules/parameters/cache.js`

Chave: `parameter:{scope}:{groupId}:{userId}:{key}`  
TTL padrão: 60s. Invalidado em set/reset.

## Segurança

- **RBAC:** `assertParameterAdmin()` — OWNER, tenant_users ADMIN, users.role admin, platform_admin.
- **Isolamento:** queries TENANT/USER sempre filtram `group_id` do ALS.
- **Auditoria:** action `PARAMETER_UPDATED` em `audit_events` (sem valores secretos).
- **Testes:** `npm run test:parameters`

## Migration

`049_parameter_system.sql`:

- Cria `system_parameters`
- Seed `appearance.default_layout = classic` para **todos os tenants existentes**

## Compatibilidade

Se a tabela não existir ou o parâmetro não estiver definido:

- `appearance.default_layout` → **`classic`**
- Demais chaves → default do catálogo ou `null`

**Nenhum parâmetro de aparência altera o layout enquanto o consumidor não for implementado.** O layout clássico permanece o comportamento atual.

## Parâmetros iniciais (implementados)

| Key | Categoria | Default |
|-----|-----------|---------|
| appearance.default_layout | appearance | classic |
| appearance.theme | appearance | light |
| appearance.interface_density | appearance | comfortable |
| appearance.menu_icons | appearance | true |
| appearance.show_tenant | appearance | true |
| appearance.button_radius | appearance | medium |
| finance.main_title_type | finance | DEF |
| finance.interest_title_type | finance | JUR |
| finance.provisional_title_type | finance | PR |
| finance.main_title_nature | finance | *(vazio)* |
| finance.interest_title_nature | finance | *(vazio)* |
| accounting.main_title_account | accounting | *(vazio)* |
| accounting.interest_title_account | accounting | *(vazio)* |
| integrations.external_erp_enabled | integrations | true |

### Contas contábeis e ERP

- `accounting.main_title_account` / `accounting.interest_title_account`: códigos do plano de contas usados na geração de títulos (gravados em `extra_json.conta_contabil`).
- `integrations.external_erp_enabled`: quando `false`, a tela **Configurações → Integrações** bloqueia novas conexões e orienta a reativar o parâmetro.

## Como adicionar um novo parâmetro (sem alterar schema)

1. Edite `backend/src/modules/parameters/definitions.js`:

```javascript
{
  key: "finance.due_alert_days",
  category: "finance",
  type: "INTEGER",
  label: "Dias para alerta de vencimento",
  description: "Número de dias antes do vencimento para gerar alerta.",
  defaultValue: 5,
  implemented: true,
  writableScopes: ["TENANT"],
},
```

2. (Opcional) Implemente a regra de negócio que **consome** o valor via `resolveParameter("finance.due_alert_days")`.

3. Nenhuma migration necessária.

4. O parâmetro aparece automaticamente na aba **Configurações → Parâmetros** após deploy.

## Frontend

- API: `src/api/parameters.js`
- UI: `src/components/settings/ParametersPanel.jsx`
- Aba: `src/pages/Settings.jsx` → Parâmetros (somente admin)

Salvamento manual: **Cancelar** / **Salvar alterações**.

## Layout moderno

`appearance.default_layout = modern` está **preparado** no catálogo e na UI, mas **não implementado**. Até a segunda fase, o sistema continua visualmente idêntico com `classic`.
