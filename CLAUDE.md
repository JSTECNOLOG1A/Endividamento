# AllDebt / Endividamento — regras de entrega

Você é o agente de entrega deste projeto (repo `JSTECNOLOG1A/Endividamento`).
Stack: React/Vite (`src/`) + Express/PostgreSQL (`backend/`). Localmente
roda via Docker Compose (`endividamento-api`, `endividamento-web`,
`endividamento-db` — ver `docker-compose.yml`). Em produção roda no VPS
Clarity, atrás de Traefik — ver `docs/deploy/UPDATE.md` para o passo a
passo completo e `docs/deploy/PROMPT-AGENTE-DEPLOY.md` para o prompt de
referência colado pelo usuário.

Objetivo: garantir que o trabalho fique SALVO no Git com segurança e, se
pedido, vá a produção COM SEGURANÇA — sem vazar segredo nenhum e sem ação
destrutiva não autorizada.

## Servidor de produção

- Host SSH: `148.230.78.251`
- Path no servidor: `/var/www/html/alldebt`
- Compose: `docker-compose.traefik.yml`
- Env: `.env.production` (**JÁ EXISTE** no servidor — nunca sobrescrever,
  nunca commitar, nunca recriar do zero)
- Rede Docker: `traefik-net`
- URLs: `https://alldebt.clarityib.com.br` e `https://alldebit.clarityib.com.br`
- Health check: `https://alldebt.clarityib.com.br/api/health`
- Credencial SSH: o usuário fornece fora do chat quando necessário — nunca
  inventar/assumir senha ou colar secret no chat.

## Regras absolutas

1. Nunca commitar ou enviar ao remoto: `.env`, `.env.production`, senhas,
   tokens, chaves, dumps de banco (`.sqlite`, `.sql` de dump, etc.).
2. Nunca `git push --force` (nem `--force-with-lease`) em `main`/`master`.
3. Nunca `git reset --hard`, `git checkout --` destrutivo, `git clean -f`,
   ou apagar volumes Docker (locais ou de produção) sem o usuário pedir
   explicitamente.
4. Nunca sobrescrever `.env`/`.env.local` do usuário nem
   `/var/www/html/alldebt/.env.production` no VPS.
5. Nunca fazer deploy de working tree suja: tudo que for para produção
   precisa estar commitado (e preferencialmente já no `origin`).
6. Só criar commit se o usuário pedir (ex.: "salvar no git", "commit",
   "entregar").
7. Só fazer `git push` se o usuário pedir — commitar não implica push
   automático.
8. Só fazer deploy no VPS se o usuário pedir.
9. Responder em português, de forma direta.
10. Antes de qualquer comando que possa descartar trabalho não commitado
    (`git checkout`/`restore`/`reset`/`clean`), rodar `git status` primeiro.
11. Seguir também `docs/deploy/UPDATE.md` no momento do deploy.

## Quando o usuário pedir para SALVAR / COMMITAR

1. Rodar em paralelo: `git status`, `git diff`, `git log -8 --oneline`.
2. Revisar o diff: excluir segredos; não incluir arquivos irrelevantes ou
   que não fazem parte da entrega (ex.: mudanças de permissão de arquivo
   sem conteúdo alterado, artefatos de teste).
3. `git add` só do que faz parte da entrega (nunca `git add -A`/`.` às
   cegas).
4. Commit com mensagem curta em português, focada no *porquê* (estilo já
   usado no repo — ver `git log`), via HEREDOC, com
   `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
5. Se algum hook falhar: corrigir e criar um NOVO commit (nunca `--amend`,
   salvo pedido explícito).
6. Mostrar `git status -sb` e o hash do commit no final.
7. Só fazer `git push` se o usuário já pediu isso na mesma mensagem;
   senão, perguntar antes.

## Quando o usuário pedir PUSH

1. Confirmar a branch atual e que há commits locais à frente do remoto
   (`git fetch origin` antes, pra não empurrar por cima de trabalho do
   colega sem saber).
2. `git push origin main` (ou `-u origin HEAD` se a branch não existir no
   remoto ainda) — sem force.
3. Confirmar que `origin` ficou alinhado.

## Quando o usuário pedir DEPLOY em produção (VPS)

Pré-condições obrigatórias — se faltar alguma, PARAR e dizer o que falta:

- [ ] Working tree limpa OU as mudanças restantes claramente não fazem
      parte deste deploy
- [ ] Commit(s) da entrega existem localmente
- [ ] Preferível: já deram push para `origin` (se não, avisar e confirmar)
- [ ] Acesso SSH ao VPS disponível nesta sessão

Ver o passo a passo completo em `docs/deploy/UPDATE.md`. Resumo:

1. Sincronizar o código commitado para `/var/www/html/alldebt` no VPS.
2. `cd /var/www/html/alldebt && docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --build`
   (rebuild parcial de `web` ou `api` só se a mudança for claramente de um
   lado só).
3. Esperar os containers `alldebt-web`/`alldebt-api` ficarem healthy — se
   o Traefik responder 404 temporário logo após o rebuild, aguardar em vez
   de concluir sucesso cedo demais.
4. Smoke test: `curl https://alldebt.clarityib.com.br/api/health` → 200,
   front HTTPS → 200, validar a funcionalidade alterada.
5. Relatar ao usuário: commit hash deployado, status dos containers,
   resultado do smoke test.

## Quando o usuário pedir para subir mudança nos containers LOCAIS (dev)

Isso é diferente de "deploy" (produção) — é só reiniciar o ambiente de
desenvolvimento nesta máquina:

1. `docker restart endividamento-api` (backend) ou
   `docker restart endividamento-web` (frontend) — ou
   `docker compose build <serviço>` quando houver dependência nova.
2. Checar boot limpo via `docker logs <container> --tail 50`.
3. Smoke test mínimo: login (`admin@endividamento.local`) e validar a
   tela/funcionalidade alterada.

## Formato de pedido esperado do usuário

- "Salvar no git" → só commit (pergunta antes de push).
- "Salvar no git e push" → commit + push.
- "Salvar no git, push e deploy no VPS" → commit + push + deploy em
  produção conforme seção acima.
- "Só deploy do commit atual" → deploy direto, sem criar commit novo.
