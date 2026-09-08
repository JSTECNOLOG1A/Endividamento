# Primeiro deploy — AllDebt

Checklist operacional para o **primeiro** ambiente de produção (ou staging público).

## Produção no VPS Clarity (Traefik)

No servidor Hostinger com Traefik já ativo:

```bash
# código em /var/www/html/alldebt
docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --build
```

Hosts TLS (DNS A → VPS):

- https://alldebit.clarityib.com.br (**canônico**)
- Legado (redireciona): `alldebt.clarityib.com.br`, `endividamento.clarityib.com.br`, `staging-alldebt.clarityib.com.br`

Aguarde o healthcheck do `alldebt-web` ficar **healthy** (Traefik ignora containers `starting`/`unhealthy`).

---

## Pré-requisitos

- [ ] Código deste pacote commitado (migrations `051`–`053`, platform master, first access, planos)
- [ ] Domínio / DNS apontando para o host
- [ ] TLS na frente (Caddy, Traefik, nginx ou Cloudflare) — o Compose de prod expõe HTTP
- [ ] SMTP real para convite / reset de senha (senão o fluxo degrada)

## Secrets (obrigatório)

Copie e edite:

```bash
cp .env.production.example .env.production
```

| Variável | Regra |
|---|---|
| `NODE_ENV` | Deve ser `production` (já fixo no compose prod) |
| `JWT_SECRET` | ≥32 chars, sem `change-this` / `dev-only` |
| `CREDENTIALS_ENCRYPTION_KEY` | ≥32 chars, **diferente** do JWT; rotacionar implica recriptografar ERP |
| `ADMIN_PASSWORD` | ≠ `Endividamento!Local1`, ≥12 chars |
| `POSTGRES_PASSWORD` | Forte; porta do DB **não** é publicada no compose prod |
| `APP_PUBLIC_URL` / `CORS_ORIGINS` | URL HTTPS real do front |
| `ADMIN_EMAIL` | E-mail do PLATFORM_MASTER neste ambiente |

A API **recusa subir** se os secrets forem inseguros (`INSECURE_SECRETS`).

## Subir

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
```

- Front (HTTP local do host): `http://HOST:${WEB_PORT}`
- Health API (via nginx): `http://HOST:${WEB_PORT}/api/health`
- Health nginx: `http://HOST:${WEB_PORT}/healthz`

Migrations rodam no boot da API (`migrate()` + `seed()`).

## Smoke test (pós-boot)

1. [ ] `GET /api/health` → 200  
2. [ ] Login PLATFORM_MASTER com `ADMIN_EMAIL` / `ADMIN_PASSWORD` novos  
3. [ ] Menu **Administração da plataforma** → Tenants  
4. [ ] Criar tenant trial (Starter)  
5. [ ] Abrir sessão de suporte + step-up → acessar Calculadora  
6. [ ] Usuário de tenant: primeiro acesso LGPD / tour (se aplicável)  
7. [ ] Layout padrão = Modern; Classic ainda selecionável em parâmetros  
8. [ ] Limite de plano: Starter bloqueia além de 10 contratos / 3 usuários  

## Testes locais recomendados (antes do push)

```bash
docker compose exec -T api node src/modules/platform/platformMaster.test.js
docker compose exec -T api node src/modules/firstAccess/firstAccess.test.js
docker compose exec -T api npm run test:p0
docker compose exec -T api npm run test:parameters
npm run test:layout --prefix backend
```

## O que este compose NÃO faz

- TLS/HTTPS (precisa proxy externo)
- Backup automático do Postgres
- Gateway de pagamento (planos são entitlement manual)
- MFA TOTP obrigatório (step-up = reauth por senha)

## Rollback rápido

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production down
# volumes pgdata_prod / api_uploads_prod são preservados até docker volume rm
```

## Referências

- Atualizar produção (time): [`UPDATE.md`](./UPDATE.md)
- Prompt Claude Code / Cursor (Git + deploy seguro): [`PROMPT-AGENTE-DEPLOY.md`](./PROMPT-AGENTE-DEPLOY.md)
- Instruções persistentes Claude Code: [`CLAUDE.md`](../../CLAUDE.md)
- Planos: [`docs/billing/PLANOS-ALLDEBT.md`](../billing/PLANOS-ALLDEBT.md)
- PLATFORM MASTER: [`docs/platform/PLATFORM-MASTER.md`](../platform/PLATFORM-MASTER.md)
- Dev (hot reload): `docker compose up --build`
