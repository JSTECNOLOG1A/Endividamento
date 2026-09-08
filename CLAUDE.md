# AllDebt — instruções para Claude Code

Projeto SaaS de endividamento (React/Vite + Express + Postgres). Responda sempre em **português**.

## Entrega obrigatória (Git + Deploy)

Ao terminar um ajuste, **pergunte** se deve salvar no Git / push / deploy — a menos que o usuário já tenha pedido.

Siga `docs/deploy/UPDATE.md`. Prompt completo: `docs/deploy/PROMPT-AGENTE-DEPLOY.md`.

### Ordem
1. Código testado localmente (`docker compose up --build` quando fizer sentido)
2. **Commit** (só se pedido)
3. **Push** (só se pedido)
4. **Deploy VPS** (só se pedido): `/var/www/html/alldebt` +  
   `docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --build`
5. Smoke: containers `healthy`, `/api/health` 200, validar a feature

### Proibido
- Commitar `.env`, `.env.production`, senhas, tokens, chaves, dumps
- `git push --force` em `main`/`master`
- Deploy de working tree não commitada
- Sobrescrever `.env.production` no VPS
- Apagar volumes Docker de produção sem pedido explícito
- Inventar ou repetir senhas de servidor no chat se evitável

### Commit
- Mensagem curta em português, foco no **porquê**
- Usar HEREDOC: `git commit -m "$(cat <<'EOF' ... EOF)"`
- Se hook falhar: corrigir e **novo** commit (não amend, salvo pedido explícito + condições seguras)

### Produção
- Hosts: `alldebit.clarityib.com.br` (canônico), legado `alldebt.clarityib.com.br`
- Aguardar `alldebt-web` / `alldebt-api` healthy antes de declarar sucesso
- Relatar hash do commit deployado

## Frases úteis do usuário
- “Salvar no git”
- “Salvar, push e deploy”
- “Só deploy do commit atual”
