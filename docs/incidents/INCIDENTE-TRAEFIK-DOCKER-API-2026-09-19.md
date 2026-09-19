# Incidente: 404 em massa + certificado inválido (Traefik × Docker API)

| Campo | Valor |
|--------|--------|
| **Data** | 2026-09-19 |
| **Ambiente** | VPS Hostinger `148.230.78.251` |
| **Severidade** | Crítica (todos os sites atrás do Traefik indisponíveis) |
| **Duração aproximada** | Do reboot da VPS (~manhã) até restauração (~11:42 BRT) |
| **Status** | Resolvido (serviço no ar) |
| **Documento gerado** | 2026-09-19T17:24Z (validação pós-incidente) |

---

## O que causou o erro (em uma frase)

**O Docker da VPS ficou incompatível com o Traefik.** Depois do reboot, o Traefik não conseguia mais “perguntar” ao Docker quais sites existiam. Sem essa lista, ele não sabia para onde mandar o tráfego → **404 em todos os sites**. O certificado “quebrado” no browser foi **efeito colateral** disso, não a causa.

---

## O que causou o erro (explicação direta)

### Analogia

Imagine o Traefik como o **porteiro** do prédio e o Docker como a **lista de moradores**.

1. Cada site (AllDebt, Método FAL, etc.) é um morador.
2. O porteiro só sabe para qual apartamento mandar a visita se consultar a lista.
3. Depois do reboot, a lista (Docker) mudou de “idioma” e **recusou falar** com o porteiro antigo (Traefik v3.0).
4. O porteiro ficou cego: a visita chega, ele não acha ninguém → responde **404**.
5. Sem saber o endereço, ele também entrega uma **chave genérica** (certificado interno) em vez da chave Let's Encrypt → o browser grita **certificado inválido**.

Os moradores (containers AllDebt) estavam em casa e bem. O problema era só o porteiro sem a lista.

### A incompatibilidade exata

| Peça | Versão / valor | Papel |
|------|----------------|--------|
| Docker Engine na VPS | **29.1.3** | Só aceitava clientes com API **≥ 1.44** |
| Traefik em produção | **v3.0** | Falava com o Docker usando API **1.24** |
| Resultado | Recusa do Docker | Traefik não lê labels → não cria rotas |

Erro que aparecia no log (centenas de vezes):

```text
client version 1.24 is too old. Minimum supported API version is 1.44
```

Isso **é** a causa. Tudo o mais (404, cert inválido, HSTS) é consequência.

### Cadeia causal (passo a passo)

```text
1. VPS reiniciou / Docker subiu na versão 29.1.3
2. Docker passou a exigir API mínima 1.44
3. Traefik v3.0 tentou conectar no docker.sock com API 1.24
4. Docker recusou a conexão do provider
5. Traefik não descobriu nenhum container (AllDebt, FAL, etc.)
6. Chegou request para alldebt.clarityib.com.br → nenhuma rota → 404
7. Sem rota TLS do host → Traefik usou certificado interno → ERR_CERT_AUTHORITY_INVALID
```

### O gatilho (quando quebrou)

O **gatilho** foi o **reboot da VPS** (ou o restart do Docker nesse momento).  
Antes disso, o arranjo antigo ainda funcionava. Depois, o Docker 29 aplicou a regra nova de API mínima e o Traefik antigo parou de funcionar.

### O que NÃO causou

- Não foi bug do código AllDebt
- Não foi o banco de dados
- Não foi DNS
- Não foi apagar o `acme.json` (os certs Let's Encrypt continuavam no disco)
- Não foi só a troca de host `alldebt` / `alldebit` (Método FAL também caiu)

### O que corrigiu

Forçamos o Docker a aceitar de novo a API antiga:

```json
"min-api-version": "1.24"
```

em `/etc/docker/daemon.json`, depois `systemctl restart docker`.  
Aí o Traefik v3.0 voltou a ler a lista de containers → rotas e certificado Let's Encrypt voltaram.

---

## 1. Resumo executivo

Após um reboot da VPS, **todos os sites roteados pelo Traefik** passaram a responder **HTTP 404** (incluindo AllDebt e Método FAL). Em seguida o navegador passou a exibir **`NET::ERR_CERT_AUTHORITY_INVALID`** com bloqueio por **HSTS**.

**Causa:** incompatibilidade Docker 29 (MinAPI 1.44) × Traefik v3.0 (client API 1.24).

**Correção:** `"min-api-version": "1.24"` no `daemon.json` + restart do Docker.

---

## 2. Impacto

### Sintomas observados

| Sintoma | Evidência |
|---------|-----------|
| `https://alldebt.clarityib.com.br/api/health` → **404** | `curl` no VPS e de fora |
| Front AllDebt → **404** | Mesmo host, `/` |
| `https://metodofal.clarityib.com.br/` → **404** | Confirmou que o problema era **global** no Traefik, não só AllDebt |
| Resposta 404 com `content-type: text/plain` e body curto | Assinatura típica do Traefik “sem rota”, não do nginx do AllDebt |
| Edge: **Your connection isn't private** / `NET::ERR_CERT_AUTHORITY_INVALID` | Certificado interno do Traefik |
| Mensagem de HSTS no Edge | Impedia “avançar mesmo assim” |

### O que continuava saudável (e induzia a erro de diagnóstico)

| Componente | Estado durante a crise |
|------------|-------------------------|
| `alldebt-db` | `healthy` |
| `alldebt-api` | `healthy` |
| `alldebt-web` | `healthy` |
| Nginx interno do web | `wget http://127.0.0.1/healthz` → `ok` |
| Rede `traefik-net` | `alldebt-web` conectado |
| Labels Traefik no compose | Presentes (`traefik.enable=true`, `Host(...)`, etc.) |
| Arquivo `acme.json` no disco | Intactos em `/var/www/Dashview/traefik/acme.json` (~292 KB) |
| DNS `alldebt.clarityib.com.br` | Resolvia para `148.230.78.251` |

Conclusão parcial já na crise: **a aplicação AllDebt estava de pé; o proxy de borda não roteava.**

---

## 3. Arquitetura envolvida (contexto)

```
Internet
   │
   ▼
Traefik (ports 80/443/8080)
   │  provider: Docker (lê labels via /var/run/docker.sock)
   │  config: /var/www/Dashview/traefik/traefik.yml
   │  certs:  /var/www/Dashview/traefik → montado em /letsencrypt (acme.json)
   │  rede:   traefik-net (+ rede auxiliar "traefik")
   ▼
Containers com labels Traefik
   ├── alldebt-web / alldebt-api
   ├── fal-prod-web (Método FAL)
   ├── reforma-frontend / reforma-backend
   └── demais sites Clarity/Solv na mesma VPS
```

O AllDebt em `/var/www/html/alldebt` **não é clone Git**; o Traefik **não** é gerenciado pelo compose do AllDebt — é um container compartilhado da infra Dashview.

### Mounts corretos do Traefik (produção histórica)

| Host | Container |
|------|-----------|
| `/var/run/docker.sock` | `/var/run/docker.sock` (ro) |
| `/var/www/Dashview/traefik/traefik.yml` | `/etc/traefik/traefik.yml` (ro) |
| `/var/www/Dashview/traefik` | `/letsencrypt` (rw) — **diretório inteiro**, não a subpasta `letsencrypt/` |
| Cmd | `--configFile=/etc/traefik/traefik.yml` |
| Portas | `80`, `443`, `8080` |

---

## 4. Linha do tempo (o que aconteceu exatamente)

Horários em **UTC** quando disponíveis nos logs; contexto operacional em **BRT (UTC−3)**.

### Fase A — Antecedentes (dias anteriores)

1. Trabalho de alinhamento Git / deploy AllDebt (merge, scripts `deploy-vps.sh`, labels Traefik).
2. Houve episódio paralelo com host **`alldebit.clarityib.com.br`** (certificado/HSTS problemático) e tentativa de corrigir rules `Host(...)` no compose.
3. Esse episódio **não** é a causa do 404 em massa pós-reboot, mas gerou ruído: mudanças de labels, restarts e suspeita de “problema do AllDebt”.

### Fase B — Reboot e quebra (manhã de 2026-09-19)

1. VPS reiniciada / Docker reiniciado (`systemctl restart docker` e/ou reboot da máquina).
2. Containers AllDebt voltam: `healthy`.
3. Traefik sobe como `traefik:v3.0`, mas o provider Docker entra em erro contínuo:

```text
ERR ... Provider error ... client version 1.24 is too old.
Minimum supported API version is 1.44, please upgrade your client to a newer version
providerName=docker
```

4. Smoke externo: `health=404`, `front=404`, `metodofal=404`.
5. Diagnósticos corretos feitos:
   - Labels Traefik presentes no `alldebt-web`
   - Container na `traefik-net`
   - Nginx interno OK
   - Logs Traefik com erro de API (causa raiz identificada)

### Fase C — Tentativas de remediação (antes da correção definitiva)

| # | Ação | Resultado |
|---|------|-----------|
| 1 | Recriar só `alldebt-web` / `scp` do compose | Continua 404 (apps ok, Traefik cego) |
| 2 | `docker pull traefik:v3.3` | Imagem baixada com sucesso |
| 3 | `docker rename traefik → traefik-old-v30` + `docker run` com `traefik:v3.3` | **Mounts/paths incorretos** na 1ª tentativa (`--configFile=/traefik.yml`, volume de certs em path errado) |
| 4 | Novo Traefik v3.3 sobe, mas **ainda** loga `client version 1.24 is too old` | Upgrade de imagem **não** resolveu sozinho |
| 5 | Smoke `alldebt=000` / certificado padrão | Traefik sem rotas + TLS default → browser com `ERR_CERT_AUTHORITY_INVALID` |
| 6 | Tentativa de recreate com mounts corretos + `DOCKER_API_VERSION=1.44` | Em paralelo / depois: conflito de porta |
| 7 | Bloco com `min-api-version` + `docker run` v3.3 | `daemon.json` atualizado; **`docker run` do v3.3 falha**: `Bind for 0.0.0.0:80 failed: port is already allocated` |

### Fase D — Restauração efetiva (~14:42 UTC / ~11:42 BRT)

1. `/etc/docker/daemon.json` passa a conter:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "min-api-version": "1.24"
}
```

2. `systemctl restart docker` (por volta de `2026-09-19 14:42 UTC` — evidência: mtime de `/var/lib/docker` e start do Traefik).
3. O container **`traefik-old-v30`** (`traefik:v3.0`) sobe e passa a rodar sem erros de API.
4. AllDebt e Método FAL voltam a **HTTP 200** com certificado **Let's Encrypt**.

### Fase E — Estado após restauração (validado 17:24 UTC)

Ver seção 8.

---

## 5. Causa raiz (técnica)

### 5.1 Mudança no Docker

| Item | Antes (comportamento esperado histórico) | Depois do reboot / Docker 29 |
|------|------------------------------------------|------------------------------|
| Engine | Versão anterior (compatível com client antigo) | **Docker 29.1.3** |
| API do servidor | Aceitava clients antigos | API **1.52** |
| Min API | Tipicamente ≤ 1.24 | Passou a exigir **1.44** (até o workaround) |
| Traefik client | API **1.24** | Rejeitado pelo daemon |

Mensagem canônica do daemon:

```text
Error response from daemon: client version 1.24 is too old.
Minimum supported API version is 1.44, please upgrade your client to a newer version
```

### 5.2 Efeito no Traefik

1. Provider `docker` falha ao negociar com o socket.
2. Traefik **não carrega routers/services** dos containers.
3. Request chega no entrypoint `websecure` → **nenhuma rule casa** → **404** texto plano.
4. Sem router TLS associado ao SNI do host, Traefik usa o **certificado default interno**.
5. Browser rejeita (CA inválida). Com **HSTS** prévio no domínio, o Edge bloqueia o bypass.

### 5.3 Por que o AllDebt “parecia” o culpado

- Trabalho recente em `docker-compose.traefik.yml` e hosts `alldebt` / `alldebit`.
- Recreates do `alldebt-web` no mesmo dia.
- Porém Método FAL e outros hosts na mesma VPS também deram 404 → prova de falha **compartilhada no edge**.

---

## 6. O que NÃO foi a causa

| Hipótese | Por que foi descartada |
|----------|-------------------------|
| Bug no código AllDebt do merge do dia | Containers healthy; healthz interno OK; 404 vinha do Traefik |
| Banco Postgres corrompido | `alldebt-db` healthy; API respondia health interno |
| DNS errado | `getent hosts` → `148.230.78.251` |
| Certificados Let's Encrypt apagados | `acme.json` presente e intacto; após restauração o issuer voltou a LE sem reemitir do zero (cert com `notBefore=Sep 7`) |
| Só problema de label `Host(alldebit...)` | Método FAL também 404; logs de API 1.24 eram determinísticos |
| `traefik:v3.3` “consertou” a produção | O v3.3 **não ficou no ar**; quem serve é o `traefik-old-v30` (v3.0) |

---

## 7. Correção aplicada (o que realmente funcionou)

### 7.1 Workaround no daemon Docker

Arquivo: `/etc/docker/daemon.json`

```json
"min-api-version": "1.24"
```

Efeito medido após restart:

```text
Server=29.1.3 API=1.52 MinAPI=1.24
```

Isso **reabre** a porta de compatibilidade para o client antigo do Traefik v3.0.

### 7.2 O que não ficou aplicado em produção

- Container nomeado `traefik` com imagem `traefik:v3.3` ficou em estado **`Created`** (nunca bindou 80/443):

```text
Error: Bind for 0.0.0.0:80 failed: port is already allocated
```

Ou seja: a linha de upgrade para v3.3 foi **iniciada**, mas **não concluiu**. A produção estabilizou no Traefik antigo + MinAPI.

---

## 8. Validação pós-incidente (snapshot 2026-09-19T17:24:40Z)

Comandos executados na VPS; resultados:

### Docker

```text
Server=29.1.3 API=1.52 MinAPI=1.24
daemon.json contém min-api-version: "1.24"
```

### Traefik

| Container | Image | Status | Papel |
|-----------|-------|--------|-------|
| `traefik-old-v30` | `traefik:v3.0` | **Up ~3h** | **Ativo** (80/443/8080) |
| `traefik` | `traefik:v3.3` | **Created** | Órfão (falhou no bind da porta 80) |

Mounts do ativo (`traefik-old-v30`): corretos (sock + yml + dir Dashview → `/letsencrypt`).

Erros `api version` nos logs recentes: **0**.

### AllDebt

```text
alldebt-web   Up (healthy)
alldebt-api   Up (healthy)
alldebt-db    Up (healthy)
```

### Smoke HTTPS

```text
alldebt_health=200
alldebt_front=200
metodofal=200
```

### Certificado `alldebt.clarityib.com.br`

```text
issuer=C = US, O = Let's Encrypt, CN = YR1
subject=CN = alldebt.clarityib.com.br
notBefore=Sep  7 23:05:06 2026 GMT
notAfter=Dec  6 23:05:05 2026 GMT
```

---

## 9. Dívida técnica remanescente

1. **Traefik de produção ainda é v3.0** (renomeado para `traefik-old-v30`).
2. **Container órfão `traefik` (v3.3 / Created)** deve ser removido (`docker rm -f traefik`) para evitar confusão.
3. A estabilidade atual **depende** de `min-api-version: "1.24"`. Remover essa chave sem um Traefik cujo client Docker fale ≥ 1.44 **reproduz o incidente**.
4. Upgrade definitivo recomendado (janela controlada):
   - Remover órfão v3.3
   - Parar `traefik-old-v30`
   - Subir novo container `traefik` com imagem recente **e os mesmos mounts/portas/redes**
   - Validar smoke + issuer LE **antes** de remover o backup
   - Só então avaliar se ainda precisa do `min-api-version`

---

## 10. Lições aprendidas

1. **404 em vários hosts ao mesmo tempo** → olhar Traefik/Docker primeiro, não o app.
2. **Container healthy ≠ site no ar** quando há proxy de borda.
3. **Erro de certificado + HSTS** pode ser consequência de Traefik sem routers (cert default), não de `acme.json` apagado.
4. **Upgrade de imagem Traefik** não garante client Docker novo o suficiente; validar logs do provider `docker` após qualquer recreate.
5. Ao recrear Traefik, **copiar mounts exatamente** do `docker inspect` (o volume de certs é o diretório pai `/var/www/Dashview/traefik`, não a subpasta `letsencrypt/`).
6. Manter `min-api-version` documentado até o edge estar em versão compatível com Docker 29+.

---

## 11. Checklist de verificação (reuso)

```bash
ssh -i ~/.ssh/fal_hostinger root@148.230.78.251 '
docker version --format "Server={{.Server.Version}} API={{.Server.APIVersion}} MinAPI={{.Server.MinAPIVersion}}"
cat /etc/docker/daemon.json
docker ps -a --filter name=traefik --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
docker logs traefik-old-v30 --tail 30 2>&1 | grep -i "api version" || echo "OK sem erro API"
curl -s -o /dev/null -w "alldebt=%{http_code}\n" https://alldebt.clarityib.com.br/api/health
curl -s -o /dev/null -w "metodofal=%{http_code}\n" https://metodofal.clarityib.com.br/
echo | openssl s_client -connect alldebt.clarityib.com.br:443 -servername alldebt.clarityib.com.br 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates
'
```

Critérios de OK:

- `MinAPI=1.24` (enquanto Traefik for v3.0) **ou** Traefik novo sem erros de API
- Sem linhas `client version 1.24 is too old` nos logs
- `alldebt=200` e `metodofal=200`
- `issuer=... Let's Encrypt ...`

---

## 12. Referências internas do repositório

- Deploy AllDebt: `docs/deploy/UPDATE.md`
- Compose Traefik do app: `docker-compose.traefik.yml`
- Regra de entrega segura: `.cursor/rules/deploy-seguro.mdc`

---

*Documento factual do incidente de 2026-09-19. Estado da VPS revalidado em 2026-09-19T17:24:40Z.*
