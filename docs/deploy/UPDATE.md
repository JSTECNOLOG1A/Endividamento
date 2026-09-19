# Atualizar produção — AllDebt

Guia curto. Deploy atual: **manual** no VPS Clarity (Traefik), via script
oficial `scripts/deploy-vps.sh`.

| Item | Valor |
|---|---|
| Código no servidor | `/var/www/html/alldebt` |
| Compose | `docker-compose.traefik.yml` |
| Env | `.env.production` (**só no servidor**, nunca no Git) |
| URL operacional | https://alldebt.clarityib.com.br |
| URL alldebit | https://alldebit.clarityib.com.br (só quando o certificado TLS estiver válido) |
| Script | `./scripts/deploy-vps.sh` |

> **Importante:** o diretório no VPS **não é clone Git**.  
> `git pull` no servidor **não atualiza** o código. Sempre use o script
> (rsync do commit + rebuild com `--force-recreate`).

---

## Fluxo obrigatório (cada entrega)

```
1. Ajuste local → teste
2. Commit no Git
3. Push para origin/main
4. ./scripts/deploy-vps.sh
5. Smoke: containers healthy + /api/health 200 + feature
```

Nunca faça deploy de código que **não** esteja commitado e no `origin`.  
Nunca faça push de `.env`, senhas ou chaves.  
Nunca sobrescreva `.env.production` no VPS.

---

## 1. No notebook (dev)

```bash
git status
# ... alterações + teste local ...
git add <arquivos>
git commit -m "mensagem clara do porquê"
git push origin main
./scripts/deploy-vps.sh
```

O script falha se:

- working tree estiver suja
- `HEAD` ≠ `origin/main` (esqueceu o push)
- SSH / `.env.production` no VPS indisponível
- containers não ficarem `healthy`
- smoke HTTPS ≠ 200

Sucesso grava `/var/www/html/alldebt/DEPLOYED_COMMIT` com o hash.

### Variáveis úteis

```bash
DEPLOY_SSH_KEY=~/.ssh/fal_hostinger   # default
DEPLOY_SERVICES="web api"             # default; use "api" só se mudança for só backend
SKIP_PUSH_CHECK=1                     # emergência (não recomendado)
```

---

## 2. O que o script faz no VPS

1. `rsync` do tree do commit (exclui `.env*`, `node_modules`, `.git`, uploads)
2. Escreve `DEPLOYED_COMMIT`
3. `docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --build --force-recreate web api`
4. Espera `alldebt-web` e `alldebt-api` healthy
5. Smoke em `alldebit` (e tenta `alldebt`)

`--force-recreate` é obrigatório: sem ele o `web` pode ficar “Up há dias”
com imagem antiga mesmo após o build.

---

## 3. Conferência pós-deploy

```bash
ssh -i ~/.ssh/fal_hostinger root@148.230.78.251 'cat /var/www/html/alldebt/DEPLOYED_COMMIT; docker ps --filter name=alldebt'
curl -s -o /dev/null -w "%{http_code}\n" https://alldebit.clarityib.com.br/api/health
```

O hash em `DEPLOYED_COMMIT` deve ser o mesmo de `git rev-parse HEAD` no notebook.

---

## Proibido

- `git push --force` em `main`/`master`
- Deploy de working tree suja
- Assumir que `git pull` no VPS atualizou o código
- Rebuild sem `--force-recreate` quando o front precisa trocar
- Sobrescrever `.env.production` no servidor
- Apagar volumes Docker de produção sem pedido explícito
- Declarar sucesso sem healthy + smoke 200
