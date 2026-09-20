#!/usr/bin/env bash
# Deploy garantido AllDebt → VPS Clarity (Traefik).
# Uso: ./scripts/deploy-vps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HOST="${DEPLOY_HOST:-148.230.78.251}"
USER="${DEPLOY_USER:-root}"
REMOTE_PATH="${DEPLOY_PATH:-/var/www/html/alldebt}"
SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/fal_hostinger}"
SERVICES="${DEPLOY_SERVICES:-web api}"
# Host com certificado válido hoje
SITE_URL="${DEPLOY_CANONICAL_URL:-https://alldebt.clarityib.com.br}"

die() { echo "ERRO: $*" >&2; exit 1; }
info() { echo "==> $*"; }

remote() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o BatchMode=yes \
    "${USER}@${HOST}" "$@"
}

command -v git >/dev/null || die "git não encontrado"
# Sem rsync (ex.: Git Bash no Windows): envia o commit com git archive + tar sobre ssh.
if command -v rsync >/dev/null; then
  USE_RSYNC=1
else
  USE_RSYNC=0
  command -v tar >/dev/null || die "nem rsync nem tar encontrados"
fi
[[ -f "$SSH_KEY" ]] || die "chave SSH não encontrada: $SSH_KEY"

if [[ "${ALLOW_DIRTY:-0}" != "1" ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    die "working tree suja. Commit/stash antes, ou ALLOW_DIRTY=1."
  fi
fi

COMMIT="$(git rev-parse HEAD)"
COMMIT_SHORT="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
info "Branch=$BRANCH Commit=$COMMIT_SHORT"

git fetch origin --quiet || true

if [[ "${SKIP_PUSH_CHECK:-0}" != "1" ]]; then
  ORIGIN_MAIN="$(git rev-parse origin/main 2>/dev/null || true)"
  [[ -n "$ORIGIN_MAIN" ]] || die "origin/main nao encontrado. Rode git fetch."
  if [[ "$COMMIT" != "$ORIGIN_MAIN" ]]; then
    die "HEAD ($COMMIT_SHORT) != origin/main. Faça push antes do deploy."
  fi
fi

info "Testando SSH ${USER}@${HOST} ..."
remote "test -d '${REMOTE_PATH}' && test -f '${REMOTE_PATH}/.env.production'" \
  || die "VPS sem ${REMOTE_PATH} ou sem .env.production"

if [[ "$USE_RSYNC" != "1" ]]; then
  info "Sem rsync: enviando o commit ${COMMIT_SHORT} (git archive + tar; .env.production não é tocado)"
  echo "AVISO: sem rsync, arquivos removidos do repositório não são apagados no VPS."
  git archive --format=tar "$COMMIT" \
    | remote "tar -x -C '${REMOTE_PATH}' --no-same-owner --overwrite" \
    || die "falha ao enviar o commit por tar"
else
info "Rsync (sem .env.production)"
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
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new -o BatchMode=yes" \
  "${ROOT}/" "${USER}@${HOST}:${REMOTE_PATH}/"
fi

STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
info "Gravando DEPLOYED_COMMIT"
remote "printf '%s\n%s\n' '${COMMIT}' '${STAMP}' > '${REMOTE_PATH}/DEPLOYED_COMMIT'"

info "Force-recreate: ${SERVICES} (tenta build; se Docker Hub falhar, sobe com imagem local)"
# 1) Sempre recria com o que já existe no VPS — restaura Traefik mesmo sem registry.
# shellcheck disable=SC2086
remote "cd '${REMOTE_PATH}' && test -f .env.production && docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --no-build --force-recreate ${SERVICES}"

# 2) Tenta rebuild (opcional). Falha de TLS/registry NÃO derruba o site.
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  info "Tentando rebuild (pode falhar se Docker Hub estiver lento)"
  # shellcheck disable=SC2086
  if remote "cd '${REMOTE_PATH}' && docker compose -f docker-compose.traefik.yml --env-file .env.production build ${SERVICES} && docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --no-build --force-recreate ${SERVICES}"; then
    info "Rebuild OK"
  else
    echo "AVISO: rebuild falhou (ex.: timeout Docker Hub). Mantendo containers com imagem local."
  fi
fi

info "Aguardando healthy"
remote bash -s <<'REMOTE_WAIT'
set -euo pipefail
for i in $(seq 1 60); do
  WEB=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' alldebt-web 2>/dev/null || echo missing)
  API=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' alldebt-api 2>/dev/null || echo missing)
  echo "t=$i web=$WEB api=$API"
  if [ "$WEB" = healthy ] && [ "$API" = healthy ]; then
    exit 0
  fi
  # web/nginx pode nao ter healthcheck — aceitar "running"
  if [ "$API" = healthy ] && { [ "$WEB" = healthy ] || [ "$WEB" = running ]; }; then
    exit 0
  fi
  sleep 5
done
echo "Timeout esperando healthy" >&2
docker ps --filter name=alldebt
exit 1
REMOTE_WAIT

info "Status containers"
remote "docker ps --filter name=alldebt --format 'table {{.Names}}\t{{.Status}}' && echo --- && cat '${REMOTE_PATH}/DEPLOYED_COMMIT'"

info "Smoke ${SITE_URL}"
code_health="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 15 --max-time 30 "${SITE_URL}/api/health" || true)"
code_front="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 15 --max-time 30 "${SITE_URL}/" || true)"
echo "  ${SITE_URL}/api/health -> ${code_health}"
echo "  ${SITE_URL}/ -> ${code_front}"

if [[ "$code_health" != "200" || "$code_front" != "200" ]]; then
  die "Smoke falhou. health=${code_health} front=${code_front}. Verifique Traefik labels e containers."
fi

echo
echo "OK deploy commit ${COMMIT_SHORT}"
echo "  Site: ${SITE_URL}"
