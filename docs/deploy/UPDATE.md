# Atualizar produção — AllDebt

Guia curto para o time. Deploy atual: **manual** no VPS Clarity (Traefik).

| Item | Valor |
|---|---|
| Código no servidor | `/var/www/html/alldebt` |
| Compose | `docker-compose.traefik.yml` |
| Env | `.env.production` (**só no servidor**, nunca no Git) |
| URL | https://alldebt.clarityib.com.br (legado) / https://alldebit.clarityib.com.br (canônico) |

---

## Fluxo obrigatório (cada entrega)

```
1. Ajuste local → teste
2. Commit no Git
3. Push para origin
4. Sync do código no VPS
5. docker compose up -d --build
6. Smoke test (health + tela afetada)
```

Nunca faça deploy de código que **não** esteja commitado.  
Nunca faça push de `.env`, senhas ou chaves.

---

## 1. No notebook (dev)

```bash
git pull
# ... alterações + teste local (docker compose up --build) ...
git status
git add <arquivos relevantes>
git commit -m "mensagem clara do porquê"
git push origin HEAD
```

### Segurança no Git

- **Não** commitar: `.env`, `.env.production`, credenciais, dumps, chaves SSH
- Evitar `git push --force` em `main`/`master`
- Preferir commits pequenos e revisáveis

---

## 2. No VPS (produção)

Com SSH no servidor:

```bash
cd /var/www/html/alldebt

# Se o diretório for um clone Git:
git pull

# Rebuild e sobe (migrations rodam no boot da API)
docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --build
```

Se o VPS **não** estiver com Git remoto configurado, sincronize o código commitado via `rsync`/`scp` a partir da máquina local (após o `git push`) e rode o mesmo `docker compose ... up -d --build`.

### Rebuild parcial (opcional)

| Mudança | Comando sugerido |
|---|---|
| Só frontend (`src/…`) | `... up -d --build web` |
| API / migrations / backend | `... up -d --build api` (ou stack completa) |
| Compose / env / ambos | stack completa (`up -d --build`) |

**Não** edite nem sobrescreva `.env.production` no servidor sem alinhamento do time.

---

## 3. Smoke test pós-deploy

```bash
docker ps --filter name=alldebt
# Esperar alldebt-web e alldebt-api = healthy

curl -sk https://alldebt.clarityib.com.br/api/health
curl -sk -o /dev/null -w '%{http_code}\n' https://alldebt.clarityib.com.br/
```

1. Health API → 200  
2. Front carrega (hard refresh se cache)  
3. Validar a tela/fluxo que você alterou  

Traefik pode responder `404` enquanto o container está `starting`/`unhealthy` — aguarde **healthy**.

---

## Checklist rápido

- [ ] `git status` limpo (ou só arquivos intencionais)
- [ ] Commit feito
- [ ] Push feito (`origin` atualizado)
- [ ] Código no VPS sincronizado com o commit
- [ ] `docker compose ... up -d --build` ok
- [ ] Containers healthy
- [ ] Health + smoke da feature ok
- [ ] `.env.production` intacto

---

## Prompt para o agente (Cursor)

Use o texto em [`PROMPT-AGENTE-DEPLOY.md`](./PROMPT-AGENTE-DEPLOY.md) em toda entrega.

Primeiro deploy / secrets: [`FIRST-DEPLOY.md`](./FIRST-DEPLOY.md).
