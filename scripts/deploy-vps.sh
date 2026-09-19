#!/usr/bin/env bash
# Deploy garantido AllDebt → VPS Clarity (Traefik).
#
# Uso (no notebook, a partir da raiz do repo):
#   ./scripts/deploy-vps.sh
#
# Pré-requisitos:
#   - working tree limpa
#   - HEAD == origin/main (já deu push)
#   - chave SSH (default: ~/.ssh/fal_hostinger)
#
# O VPS em /var/www/html/alldebt NÃO é clone Git. Este script:
#   1) rsync do commit atual (sem .env.production)
#   2) grava DEPLOYED_COMMIT no servidor
#   3) rebuild + force-recreate de web e api
#   4) espera healthy + smoke HTTPS
#
# Variáveis opcionais:
#   DEPLOY_HOST=148.230.78.251
#   DEPLOY_USER=root
#   DEPLOY_PATH=/var/www/html/alldebt
#   DEPLOY_SSH_KEY=~/.ssh/fal_hostinger
#   DEPLOY_SERVICES="web api"   # default
#   SKIP_PUSH_CHECK=1           # não exigir HEAD==origin/main
#   ALLOW_DIRTY=1               # permitir working tree suja (não recomendado)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HOST="${DEPLOY_HOST:-148.230.78.251}"
USER="${DEPLOY_USER:-root}"
REMOTE_PATH="${DEPLOY_PATH:-/var/www/html/alldebt}"
SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/fal_hostinger}"
SERVICES="${DEPLOY_SERVICES:-web api}"
# Host operacional com cert válido hoje; alldebit ainda pode falhar TLS.
CANONICAL_URL="${DEPLOY_CANONICAL_URL:-https://alldebt.clarityib.com.br}"
ALT_URL="${DEPLOY_ALT_URL:-https://alldebit.clarityib.com.br}"

SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o BatchMode=yes)
RSYNC_SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new -o BatchMode=yes"

die() { echo "ERRO: $*" >&2; exit 1; }
info() { echo "==> $*"; }

command -v rsync >/dev/null || die "rsync não encontrado"
command -v git >/dev/null || die "git não encontrado"
[[ -f "$SSH_KEY" ]] || die "chave SSH não encontrada: $SSH_KEY"

# --- gates locais ---
if [[ "${ALLOW_DIRTY:-0}" != "1" ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    die "working tree suja. Commit/stash antes, ou ALLOW_DIRTY=1 (não recomendado)."
  fi
fi

COMMIT="$(git rev-parse HEAD)"
COMMIT_SHORT="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

info "Branch=$BRANCH Commit=$COMMIT_SHORT ($COMMIT)"

git fetch origin --quiet || true

if [[ "${SKIP_PUSH_CHECK:-0}" != "1" ]]; then
  ORIGIN_MAIN="$(git rev-parse origin/main 2>/dev/null || true)"
  [[ -n "$ORIGIN_MAIN" ]] || die "origin/main não encontrado. Rode git fetch."
  if [[ "$COMMIT" != "$ORIGIN_MAIN" ]]; then
    die "HEAD ($COMMIT_SHORT) != origin/main ($(git rev-parse --short origin/main)). Faça push antes do deploy."
  fi
fi

# Teste SSH rápido
info "Testando SSH $USER@$HOST ..."
"${SSH[@]}" "$USER@$HOST" "test -d '$REMOTE_PATH' && test -f '$REMOTE_PATH/.env.production'" \
  || die "VPS sem $REMOTE_PATH ou sem .env.production"

# --- sync (nunca .env.production) ---
info "Rsync → $USER@$HOST:$REMOTE_PATH (excluindo secrets e node_modules)"
rsync -az --delete \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.env.production' \
  --exclude '.env.*.local' \
  --exclude 'node_modules/' \
  --exclude 'backend/node_modules/' \
  --exclude 'backend/uploads/' \
  --exclude 'server/data/' \
  --exclude 'server/uploads/' \
  --exclude 'dist/' \
  --exclude '.DS_Store' \
  --exclude '*.sqlite' \
  --exclude '*.sqlite-*' \
  --exclude '.cursor/' \
  -e "$RSYNC_SSH" \
  "$ROOT/" "$USER@$HOST:$REMOTE_PATH/"

# Marca o commit deployado no servidor (para auditoria)
info "Gravando DEPLOYED_COMMIT no servidor"
"${SSH[@]}" "$USER@$HOST" "printf '%s\n%s\n' '$COMMIT' '$(date -u +%Y-%m-%dT%H:%M:%SZ)' > '$REMOTE_PATH/DEPLOYED_COMMIT'"

# --- rebuild + force recreate (evita web “Up 38 hours” sem trocar imagem) ---
info "docker compose up -d --build --force-recreate $SERVICES"
# shellcheck disable=SC2086
"${SSH[@]}" "$USER@$HOST" "set -euo pipefail
  cd '$REMOTE_PATH'
  test -f .env.production
  docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --build --force-recreate $SERVICES
"

# --- wait healthy ---
info "Aguardando containers healthy (até ~5 min)"
"${SSH[@]}" "$USER@$HOST" "set -euo pipefail
  for i in \$(seq 1 60); do
    WEB=\$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' alldebt-web 2>/dev/null || echo missing)
    API=\$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' alldebt-api 2>/dev/null || echo missing)
    echo \"t=\$i web=\$WEB api=\$API\"
    if [ \"\$WEB\" = healthy ] && [ \"\$API\" = healthy ]; then
      exit 0
    fi
    sleep 5
  done
  echo 'Timeout esperando healthy' >&2
  docker ps --filter name=alldebt
  exit 1
"

# --- smoke ---
info "Smoke HTTPS"
smoke() {
  local url="$1"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 15 --max-time 30 "$url" || true)"
  echo "  $url → $code"
  [[ "$code" == "200" ]] || return 1
}

smoke_ok=1
smoke "$CANONICAL_URL/api/health" || smoke_ok=0
smoke "$CANONICAL_URL/" || smoke_ok=0
# alldebit: informativo (não falha o deploy se o cert ainda estiver inválido)
smoke "$ALT_URL/api/health" || echo "  (aviso: $ALT_URL sem health 200 — use $CANONICAL_URL)"

"${SSH[@]}" "$USER@$HOST" "docker ps --filter name=alldebt --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'; echo '---'; cat '$REMOTE_PATH/DEPLOYED_COMMIT'"

if [[ "$smoke_ok" != "1" ]]; then
  die "Smoke falhou (HTTP != 200). Containers podem estar healthy mas Traefik/TLS ainda instável — verifique URLs."
fi

echo
echo "OK deploy commit $COMMIT_SHORT"
echo "  Canônico: $CANONICAL_URL"
echo "  Arquivo no VPS: $REMOTE_PATH/DEPLOYED_COMMIT"
