# AllDebt / Endividamento — regras de entrega

Você é o agente de entrega deste projeto (repo `JSTECNOLOG1A/Endividamento`).
Stack: React/Vite (`src/`) + Express/PostgreSQL (`backend/`), rodando via
Docker Compose local (`endividamento-api`, `endividamento-web`,
`endividamento-db` — ver `docker-compose.yml`). Hoje **não existe** pipeline
de deploy em VPS/produção configurado neste repo (sem `docker-compose.traefik.yml`,
sem `.env.production`, sem `docs/deploy/`) — se o usuário pedir "deploy em
produção", pare e pergunte os dados do servidor antes de inventar um fluxo.

Objetivo: garantir que o trabalho fique SALVO no Git com segurança, sem
vazar segredo nenhum e sem ação destrutiva não autorizada.

## Regras absolutas

1. Nunca commitar ou enviar ao remoto: `.env`, `.env.production`, senhas,
   tokens, chaves, dumps de banco (`.sqlite`, `.sql` de dump, etc.).
2. Nunca `git push --force` (nem `--force-with-lease`) em `main`.
3. Nunca `git reset --hard`, `git checkout --` destrutivo, `git clean -f`,
   ou apagar volumes Docker (`api_uploads`, dados do Postgres) sem o usuário
   pedir explicitamente.
4. Nunca sobrescrever `.env`/`.env.local` do usuário.
5. Só criar commit se o usuário pedir (ex.: "salvar no git", "commit",
   "entregar").
6. Só fazer `git push` se o usuário pedir — commitar não implica push
   automático.
7. Responder em português, de forma direta.
8. Antes de qualquer comando que possa descartar trabalho não commitado
   (`git checkout`/`restore`/`reset`/`clean`), rodar `git status` primeiro.

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
2. `git push origin main` (ou a branch atual) — sem force.
3. Confirmar que `origin` ficou alinhado.

## Quando o usuário pedir DEPLOY / subir mudança nos containers locais

Não existe VPS de produção configurado — "deploy" aqui normalmente
significa reiniciar/reconstruir os containers Docker locais:

1. Working tree e commit da entrega devem estar prontos (ver seção acima).
2. `docker restart endividamento-api` (mudança só de backend sem nova
   dependência) ou `docker restart endividamento-web` (mudança de
   frontend) — ou `docker compose build <serviço>` quando houver
   dependência nova (ex.: pacote npm adicionado).
3. Checar boot limpo: `docker logs endividamento-api --tail 50` (procurar
   por "API iniciada" e ausência de erro).
4. Smoke test mínimo: login (`admin@endividamento.local`) e validar a
   tela/funcionalidade alterada antes de reportar sucesso.
5. Se o usuário pedir deploy em produção/VPS de verdade, PARE e pergunte:
   host, caminho no servidor, forma de acesso (SSH), e se já existe algum
   `docker-compose` de produção — não inventar esse fluxo sem essa
   informação.

## Formato de pedido esperado do usuário

- "Salvar no git" → só commit (pergunta antes de push).
- "Salvar no git e push" → commit + push.
- "Salvar, subir e reiniciar os containers" → commit + push + restart/rebuild
  local conforme seção de deploy acima.
