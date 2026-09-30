---
name: browser-testing-alldebt
description: Como rodar teste de navegador no AllDebt local (host sem node; Playwright via imagem Docker; modal legal e tour no 1º login; PDF só renderiza com --headless=new)
metadata:
  type: reference
---

Teste de navegador no AllDebt (repo /var/www/html/Endividamento), medido em 2026-09-30:

- O host NÃO tem node/npm. Usar a imagem local `mcr.microsoft.com/playwright:v1.48.0-jammy` com `--network host --init`, instalar `playwright-core@1.48.0` numa pasta do scratchpad montada, e o executável `/ms-playwright/chromium-1140/chrome-linux/chrome`.
- `xvfb-run` com `headless:false` TRAVA (o contêiner fica vivo depois do timeout; precisa de `docker kill`). Para ver o PDF aberto por blob em nova aba, usar `headless:false` + `args:['--headless=new']`; o headless antigo transforma o PDF em download.
- Sempre `timeout` dentro do contêiner também (`timeout 250 node ...`), não só no `docker run`.
- No 1º login de um usuário novo aparece o modal "Privacidade e proteção de dados" (marcar as duas caixas + Continuar), que grava `legal_acceptances` (FK sem cascade: apagar antes do usuário), e depois um tour ("Pular tour") que redireciona para a calculadora.
- Platform master sem sessão de suporte recebe 400 `SUPPORT_SESSION_REQUIRED` em /api/entities/* no layout: ruído pré-existente, não é defeito da tela testada.
- O seed do boot rebaixa `platform_admin` de todo mundo que não for `ADMIN_EMAIL` quando a api reinicia (`node --watch`). Conferir o estado antes de concluir que algo é defeito.
- Rebaixamento real observado em 2026-09-30: uma edição concorrente em `backend/src` durante o teste reiniciou a api e o usuário de teste perdeu `platform_admin` no meio da rodada (tela "Acesso restrito ao usuário master."; uma ação em andamento se perdeu). Antes de cada script, conferir o mtime de `backend/src` e reafirmar `platform_admin`.
- Stub de e-mail sem mexer no `.env`: contêiner `node:22-alpine` na rede `endividamento_default` com alias `emails-stub`, e `EMAIL_SERVICE_URL=... EMAIL_SERVICE_API_KEY=... docker compose up -d --no-deps api` (a variável do shell tem precedência sobre o `.env`). Para restaurar, basta `docker compose up -d --no-deps api` sem as variáveis. Para simular falha, responder 4xx: é terminal, sem retentativa.
- `npm run typecheck` (`tsc -p jsconfig.json`) dá cerca de 2.600 erros no repositório inteiro, a maioria de tipagem shadcn/forwardRef em JSX. Isso é estrutural, e o critério real é o `vite build`.
