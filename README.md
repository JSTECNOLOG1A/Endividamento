# AllDebt

Cálculo e gestão de empréstimos/financiamentos, com API Node, PostgreSQL e Docker.

## Desenvolvimento (local)

```bash
cp .env.example .env
docker compose up --build
```

- Interface: http://localhost:5173
- API: http://127.0.0.1:3001/api/health
- OpenAPI: http://127.0.0.1:3001/api/openapi.json
- Login PLATFORM_MASTER: `support@clarityib.com.br` / `Endividamento!Local1` (configure `ADMIN_EMAIL` / `ADMIN_PASSWORD` no `.env`)
- Guia do master / sessão de suporte: [docs/platform/PLATFORM-MASTER.md](docs/platform/PLATFORM-MASTER.md)
- Planos: [docs/billing/PLANOS-ALLDEBT.md](docs/billing/PLANOS-ALLDEBT.md)

## Produção (primeiro deploy)

```bash
cp .env.production.example .env.production
# edite secrets fortes (JWT, encryption key, ADMIN_PASSWORD, CORS, APP_PUBLIC_URL, SMTP)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Checklist completo: [docs/deploy/FIRST-DEPLOY.md](docs/deploy/FIRST-DEPLOY.md)

O compose de produção sobe API sem `--watch`, Postgres sem porta pública e web como **build estático + nginx** (proxy `/api` e `/uploads`). Coloque TLS na frente da porta `WEB_PORT`.

## Estrutura

| Caminho | Função |
| --- | --- |
| `backend/` | API Express, migrações, auditoria, JWT |
| `src/` | Frontend React |
| `docker-compose.yml` | Stack de desenvolvimento |
| `docker-compose.prod.yml` | Stack de release |
| `docs/` | Arquitetura, platform, billing, deploy |

O SQLite em `server/` ficou como legado e não é mais o caminho padrão.

## Scripts

| Comando | Função |
| --- | --- |
| `docker compose up --build` | Stack de desenvolvimento |
| `npm run docker:prod` | Stack de produção (`--env-file .env.production`) |
| `docker compose down` | Para os containers |
| `npm run build` | Build do frontend |
