# Deploy de atualização — AllDebt (VPS Clarity)

Este projeto já está em produção. Este documento cobre **atualizar** um
deploy existente — não o primeiro deploy (não há necessidade disso hoje).

## Onde roda

| Item | Valor |
|---|---|
| Host SSH | `148.230.78.251` |
| Path no servidor | `/var/www/html/alldebt` |
| Compose file | `docker-compose.traefik.yml` |
| Env file | `.env.production` (já existe no servidor — nunca sobrescrever) |
| Rede Docker | `traefik-net` |
| URLs | `https://alldebt.clarityib.com.br`, `https://alldebit.clarityib.com.br` |
| Health check | `https://alldebt.clarityib.com.br/api/health` |

A credencial SSH é fornecida pelo usuário fora do chat quando necessário.
Nunca inventar senha, nunca colar secret no chat se evitável.

## Pré-requisitos antes de deployar

- [ ] Working tree local limpa, ou as mudanças pendentes claramente não
      fazem parte desta entrega.
- [ ] O(s) commit(s) da entrega já existem localmente.
- [ ] De preferência já foi feito `git push` para `origin/main` — se não
      foi, avisar o usuário e confirmar antes de seguir (o servidor deve
      sincronizar a partir do commit certo).
- [ ] Acesso SSH ao host acima disponível nesta sessão.

## Passo a passo

1. **Sincronizar o código** para `/var/www/html/alldebt` no VPS.
   - Se o diretório no servidor for um clone git: `git pull origin main`
     (ou `git fetch && git reset --hard origin/main` **somente** se o
     usuário confirmar explicitamente — nunca por padrão, para não
     descartar algo feito direto no servidor).
   - Se não for um clone (deploy via rsync/scp): sincronizar exatamente o
     commit que acabou de subir, nunca a working tree local suja.
   - **Nunca** sincronizar/sobrescrever `.env.production` do servidor.

2. **Subir os containers** a partir do diretório do projeto no VPS:

   ```bash
   cd /var/www/html/alldebt
   docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --build
   ```

   Se a mudança for claramente restrita a um lado (só frontend ou só
   backend), pode-se rebuildar apenas esse serviço
   (`... up -d --build web` ou `... up -d --build api`) para ser mais
   rápido — na dúvida, sobe os dois.

3. **Esperar ficar healthy**:

   ```bash
   docker ps --filter name=alldebt
   ```

   Confirmar que os containers relevantes (`alldebt-web`, `alldebt-api`)
   aparecem como `healthy` antes de seguir. Se o Traefik responder 404
   logo após o rebuild, isso é esperado durante o boot — aguardar o
   healthcheck passar, não declarar sucesso cedo demais.

4. **Smoke test**:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://alldebt.clarityib.com.br/api/health
   curl -s -o /dev/null -w "%{http_code}\n" https://alldebt.clarityib.com.br/
   ```

   Ambos devem responder `200`. Depois, validar manualmente (ou via
   navegador) a funcionalidade específica que motivou o deploy — não
   basta o healthcheck genérico passar.

5. **Relatar ao usuário**: hash do commit deployado, status dos
   containers, resultado do smoke test e da validação manual.

## Proibido

- `git push --force` (ou `--force-with-lease`) em `main`/`master`.
- Deploy de working tree suja.
- Apagar volumes Docker de produção.
- Sobrescrever ou recriar `.env.production` no servidor.
- Assumir sucesso do deploy sem esperar os containers ficarem healthy e
  sem rodar o smoke test.
