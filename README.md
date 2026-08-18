# Endividamento — Endividamento

Cálculo e gestão de empréstimos/financiamentos, com API Node, PostgreSQL e Docker.

## Subir o sistema

```bash
cp .env.example .env
docker compose up --build
```

- Interface: http://localhost:5173
- API: http://127.0.0.1:3001/api/health
- OpenAPI: http://127.0.0.1:3001/api/openapi.json
- Login inicial: `admin@endividamento.local` / `Endividamento!Local1` (troque no `.env`)

## Estrutura

| Caminho | Função |
| --- | --- |
| `backend/` | API Express, migrações, auditoria, JWT |
| `src/` | Frontend React |
| `docker-compose.yml` | Postgres + API + Web |
| `docs/` | Arquitetura e mapeamento ISO |

O SQLite em `server/` ficou como legado e não é mais o caminho padrão.

## Scripts

| Comando | Função |
| --- | --- |
| `docker compose up --build` | Stack completo |
| `docker compose down` | Para os containers |
| `npm run build` | Build do frontend |
