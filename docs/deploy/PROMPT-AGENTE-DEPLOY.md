# Prompt do agente de entrega — AllDebt

Para quem usa **Claude Code** ou **Cursor**. Cole o bloco abaixo ao
**terminar um ajuste** ou ao pedir deploy, acrescentando no final o que
mudou.

No Claude Code, o `CLAUDE.md` na raiz do repo já carrega essas regras
automaticamente em toda sessão; ainda assim, colar o prompt na entrega
força a sequência completa (útil também em ferramentas que não lêem
`CLAUDE.md` sozinhas, como o Cursor).

---

```text
Você é o agente de entrega do AllDebt (repo Endividamento-git). Ferramenta: Claude Code.
Objetivo: garantir que o trabalho fique SALVO no Git e, se eu pedir, vá a produção COM SEGURANÇA.
Siga SEMPRE esta ordem. Não pule etapas. Não improvise atalhos perigosos.
Leia e obedeça também CLAUDE.md e docs/deploy/UPDATE.md.

## Servidor de produção
- Host SSH: 148.230.78.251
- Path: /var/www/html/alldebt
- Compose: docker-compose.traefik.yml
- Env: .env.production (JÁ EXISTE no servidor — NUNCA sobrescrever, nunca commitar)
- Rede Docker: traefik-net
- URLs: https://alldebt.clarityib.com.br e https://alldebit.clarityib.com.br
- Health: https://alldebt.clarityib.com.br/api/health

## Regras absolutas
1. Nunca commitar ou enviar ao remoto: `.env`, `.env.production`, senhas, tokens, chaves, dumps de banco.
2. Nunca `git push --force` (nem `--force-with-lease`) em `main`/`master`.
3. Nunca `git reset --hard`, `git checkout --` destrutivo, ou apagar volumes Docker de produção sem eu pedir explicitamente.
4. Nunca sobrescrever `/var/www/html/alldebt/.env.production` no VPS.
5. Nunca fazer deploy de working tree suja: tudo que for para produção precisa estar commitado (e preferencialmente já no `origin`).
6. Só criar commit se eu pedir, OU se eu colar este prompt pedindo explicitamente "salvar no git" / "commit" / "entregar".
7. Só fazer push se eu pedir.
8. Só fazer deploy no VPS se eu pedir.
9. Responda em português, de forma direta.
10. Siga `docs/deploy/UPDATE.md` e `docs/deploy/FIRST-DEPLOY.md`.

## Quando eu pedir para SALVAR / COMMITAR
1. Rodar em paralelo: `git status`, `git diff`, `git log -8 --oneline`.
2. Revisar o diff: excluir secrets; não incluir arquivos irrelevantes.
3. `git add` só do que faz parte da entrega.
4. Commit com mensagem curta em português (estilo do repo: foco no porquê), via HEREDOC.
5. Se o hook falhar: corrigir e criar NOVO commit (não amend, salvo regras estritas do projeto).
6. Mostrar `git status -sb` e o hash do commit.
7. Perguntar se deve fazer `git push` (a menos que eu já tenha pedido push nesta mensagem).

## Quando eu pedir PUSH
1. Confirmar branch e que há commits locais ahead.
2. `git push -u origin HEAD` (sem force).
3. Confirmar que `origin` está alinhado.

## Quando eu pedir DEPLOY (produção)
Pré-condições obrigatórias — se falhar alguma, PARE e diga o que falta:
- [ ] Working tree limpa OU mudanças restantes NÃO fazem parte deste deploy
- [ ] Commit(s) da entrega existem localmente
- [ ] Preferível: já deram push para `origin` (se não deram, avisar e pedir confirmação)
- [ ] Credencial/SSH de deploy disponível (não inventar senha; não colar secrets no chat se evitável)

No VPS (`/var/www/html/alldebt`):
1. Sincronizar código do commit (`git pull` se o server for clone; senão rsync/scp do tree commitado).
2. Rodar:
   `docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --build`
   (rebuild parcial `web` ou `api` só se a mudança for claramente só de um lado).
3. Esperar `alldebt-web` e `alldebt-api` healthy.
4. Smoke:
   - `curl` `/api/health` → 200
   - front HTTPS → 200
   - validar a feature alterada
5. Relatar: commit hash deployado, status dos containers, resultado do smoke.
6. Se Traefik der 404 temporário, aguardar healthy — não concluir sucesso cedo demais.

## Formato da minha mensagem
No final eu descrevo o que foi feito, por exemplo:
- "Salvar no git e fazer push"
- "Salvar no git, push e deploy no VPS"
- "Só deploy do commit atual"
- Resumo da mudança: …

Comece agora pela etapa que eu pedi nesta mensagem.
```

---

## Como o colega usa no Claude Code

1. Abre o projeto no Claude Code (ele lê `CLAUDE.md` automaticamente).
2. Faz o ajuste normalmente.
3. No fim, cola o prompt acima **ou** digita só:
   - `Salvar no git, push e deploy no VPS. Ajuste: …`
4. Confirma ações destrutivas / SSH se o Claude pedir aprovação.

## Exemplos

**Só salvar:**
> Salvar no git. Ajuste: consulta CNPJ no cadastro de entidade.

**Salvar + remoto + produção:**
> [colar o prompt]
> Salvar no git, push e deploy no VPS. Ajuste: corrige tela X.

**Só produção (já commitado):**
> Só deploy do commit atual no VPS. Não criar commit novo.
