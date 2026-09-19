#!/usr/bin/env bash
set -euo pipefail
KEY="${HOME}/.ssh/fal_hostinger"
HOST="148.230.78.251"
LOG="/tmp/alldebt-restore.log"
: > "$LOG"
log() { echo "$*" | tee -a "$LOG"; }

log "=== $(date) restore AllDebt ==="
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new "root@${HOST}" 'echo OK; hostname' | tee -a "$LOG"
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=30 "root@${HOST}" 'docker ps -a --filter name=alldebt --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"' | tee -a "$LOG"
log "Recriando web+api sem build..."
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=180 "root@${HOST}" 'cd /var/www/html/alldebt && test -f .env.production && docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --no-build --force-recreate web api && docker ps --filter name=alldebt --format "table {{.Names}}\t{{.Status}}"' | tee -a "$LOG"
log "Aguardando 20s..."
sleep 20
CODE=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 20 --max-time 30 https://alldebt.clarityib.com.br/api/health || true)
FRONT=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 20 --max-time 30 https://alldebt.clarityib.com.br/ || true)
log "health=${CODE}"
log "front=${FRONT}"
if [[ "$CODE" == "200" ]]; then
  log "SUCESSO: site restaurado"
else
  log "FALHA: health=${CODE} front=${FRONT}"
  ssh -i "$KEY" -o BatchMode=yes "root@${HOST}" 'docker ps -a --filter name=alldebt; docker logs alldebt-web --tail 40; docker logs alldebt-api --tail 40' | tee -a "$LOG" || true
  exit 1
fi
