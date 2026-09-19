#!/usr/bin/env bash
# Restaura PRODUÇÃO para o commit anterior às alterações de 19/09/2026:
#   21fc4d7 — último main estável no GitHub antes do merge/deploy de hoje.
# NÃO sobrescreve .env.production. NÃO apaga volumes do Postgres.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RESTORE_COMMIT="${RESTORE_COMMIT:-21fc4d7}"
HOST="${DEPLOY_HOST:-148.230.78.251}"
USER="${DEPLOY_USER:-root}"
REMOTE_PATH="${DEPLOY_PATH:-/var/www/html/alldebt}"
SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/fal_hostinger}"
STAGE="/tmp/alldebt-restore-${RESTORE_COMMIT}"

echo "==> Restaurando produção a partir de ${RESTORE_COMMIT}"
git cat-file -e "${RESTORE_COMMIT}^{commit}"

rm -rf "$STAGE"
mkdir -p "$STAGE"
git archive "${RESTORE_COMMIT}" | tar -x -C "$STAGE"

echo "==> Rsync (sem .env.production) → ${HOST}:${REMOTE_PATH}"
rsync -az --delete \
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
  --exclude '.cursor/' \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=30" \
  "${STAGE}/" "${USER}@${HOST}:${REMOTE_PATH}/"

STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FULL="$(git rev-parse "${RESTORE_COMMIT}")"
ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=30 "${USER}@${HOST}" \
  "printf '%s\n%s\nrestored-from-pre-2026-09-19\n' '${FULL}' '${STAMP}' > '${REMOTE_PATH}/DEPLOYED_COMMIT'"

echo "==> Recriando web+api SEM build (imagens locais)"
ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=180 "${USER}@${HOST}" \
  "cd '${REMOTE_PATH}' && docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --no-build --force-recreate web api && docker ps --filter name=alldebt --format 'table {{.Names}}\t{{.Status}}'"

echo "==> Aguardando 20s..."
sleep 20
CODE=$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 20 --max-time 30 https://alldebt.clarityib.com.br/api/health || true)
FRONT=$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 20 --max-time 30 https://alldebt.clarityib.com.br/ || true)
echo "health=${CODE}"
echo "front=${FRONT}"

if [[ "$CODE" != "200" ]]; then
  echo "AVISO: health ainda nao e 200. Tente: docker restart traefik"
  exit 1
fi
echo "OK: produção restaurada para ${RESTORE_COMMIT}"
