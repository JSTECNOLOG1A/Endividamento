# Arquitetura

```
web (Vite :5173)
  -> proxy /api
api (Express :3001)
  -> PostgreSQL 16
  -> volume de uploads
```

## Camadas da API (`backend/src`)

1. `index.js` — boot, migrate, seed, shutdown
2. `app.js` — HTTP, helmet, CORS, rate limit
3. `middleware/` — request-id, JWT, auditoria, erros
4. `modules/` — health, auth, entities, functions, calculate, audit
5. `engine/` — motor de amortização (fonte única; o Vite reexporta via `@engine`)
6. `db/migrations/` — schema versionado

## Modelo relacional

Grupo 1—N Entidade 1—N Contrato 1—N Snapshot  
Contrato N—1 Banco, N—1 Moeda (ISO 4217)  
Tenant N—1 Grupo; TenantUser N—1 Tenant  
audit_events append-only

Dinheiro em `NUMERIC(18,2)`. Snapshots imutáveis por trigger.

## Motor de cálculo

Fonte única: `backend/src/engine`. A API expõe `POST /api/functions/calculateAmortizationSchedule` (JWT).
O simulador chama essa função. Suítes de teste na UI importam o mesmo código via alias Vite `@engine`.
