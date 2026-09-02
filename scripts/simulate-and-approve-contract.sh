#!/usr/bin/env bash
set -euo pipefail

API="${API:-http://localhost:3001/api}"
TENANT="${TENANT:-tnt_5c5f21ee9fe7}"
ENTITY="${ENTITY:-ent_c48e4d39945f}"
BANK="${BANK:-bank_001}"
CURRENCY="${CURRENCY:-cur_brl}"
CONTRACT_NUM="SIM-$(date +%Y%m%d-%H%M%S)"
PREPARER_EMAIL="preparer.sim.$(date +%s)@test.local"
PREPARER_PASS="Sim!Local123"

json() { python3 -c 'import sys,json; print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }

login() {
  local email="$1" pass="$2"
  curl -s -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$pass\"}"
}

ADMIN_RESP=$(login "admin@fincalc.local" "Endividamento!Local1")
ADMIN_TOKEN=$(echo "$ADMIN_RESP" | json token)
if [[ -z "$ADMIN_TOKEN" || "$ADMIN_TOKEN" == "null" ]]; then
  echo "Falha no login admin: $(echo "$ADMIN_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("error", d))')"
  exit 1
fi

curl -s -X POST "$API/platform/context" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT\"}" >/dev/null

CREATE_USER=$(curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Tenant-Id: $TENANT" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$PREPARER_EMAIL\",\"full_name\":\"Preparador Simulacao\",\"role\":\"user\"}")

INVITE_URL=$(echo "$CREATE_USER" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("invite_url",""))')
if [[ -z "$INVITE_URL" ]]; then
  echo "Falha ao criar preparador: $CREATE_USER"
  exit 1
fi

INVITE_TOKEN=$(python3 -c "from urllib.parse import urlparse, parse_qs; u='$INVITE_URL'; q=parse_qs(urlparse(u).query); print(q.get('token',[''])[0])")

curl -s -X POST "$API/public/account-token/$INVITE_TOKEN/password" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$PREPARER_PASS\",\"password_confirm\":\"$PREPARER_PASS\"}" >/dev/null

PREP_RESP=$(login "$PREPARER_EMAIL" "$PREPARER_PASS")
PREP_TOKEN=$(echo "$PREP_RESP" | json token)
if [[ -z "$PREP_TOKEN" || "$PREP_TOKEN" == "null" ]]; then
  echo "Falha no login preparador: $(echo "$PREP_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("error", d))')"
  exit 1
fi

CALC=$(curl -s -X POST "$API/functions/calculateAmortizationSchedule" \
  -H "Authorization: Bearer $PREP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "operationValue": 1000000,
    "signalValue": 0,
    "iofValue": 0,
    "iofFinanced": false,
    "otherFees": 0,
    "otherFeesFinanced": false,
    "fixedRate": 12,
    "indexer": "NA",
    "indexerSpread": 0,
    "operationDate": "2026-01-15",
    "firstPaymentDate": "2026-02-15",
    "principalGraceMonths": 0,
    "interestGraceMonths": 0,
    "graceAction": "capitalizar",
    "graceInterestBehavior": "CAPITALIZAR",
    "amortizationTrigger": "END_OF_GRACE",
    "principalInstallments": 12,
    "interestInstallments": 12,
    "principalFrequency": "1",
    "interestFrequency": "1",
    "calculationSystem": "SAC",
    "totalTermMonths": 12
  }')

SCHEDULE_DATA=$(echo "$CALC" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps(d))')

CONTRACT=$(curl -s -X POST "$API/entities/LoanContract" \
  -H "Authorization: Bearer $PREP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"entity_id\": \"$ENTITY\",
    \"bank_id\": \"$BANK\",
    \"currency_id\": \"$CURRENCY\",
    \"contract_number\": \"$CONTRACT_NUM\",
    \"operation_category\": \"emprestimos\",
    \"operation_type\": \"giro_prefixado\",
    \"operation_value\": 1000000,
    \"signal_value\": 0,
    \"iof_value\": 0,
    \"iof_financed\": false,
    \"other_fees\": 0,
    \"other_fees_financed\": false,
    \"fixed_rate\": 12,
    \"indexer\": \"NA\",
    \"indexer_spread\": 0,
    \"operation_date\": \"2026-01-15\",
    \"first_payment_date\": \"2026-02-15\",
    \"principal_grace_months\": 0,
    \"interest_grace_months\": 0,
    \"grace_action\": \"capitalizar\",
    \"grace_interest_behavior\": \"CAPITALIZAR\",
    \"amortization_trigger\": \"END_OF_GRACE\",
    \"principal_installments\": 12,
    \"interest_installments\": 12,
    \"principal_frequency\": \"1\",
    \"interest_frequency\": \"1\",
    \"calculation_system\": \"SAC\",
    \"total_term_months\": 12,
    \"schedule_data\": $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$SCHEDULE_DATA")
  }")

CONTRACT_ID=$(echo "$CONTRACT" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("id",""))')
CONTRACT_STATUS=$(echo "$CONTRACT" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("status",""))')
if [[ -z "$CONTRACT_ID" ]]; then
  echo "Falha ao criar contrato: $CONTRACT"
  exit 1
fi

PENDING=$(curl -s -X PATCH "$API/entities/LoanContract/$CONTRACT_ID" \
  -H "Authorization: Bearer $PREP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"pendente_aprovacao"}')

PENDING_STATUS=$(echo "$PENDING" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("status",""))')

APPROVED=$(curl -s -X PATCH "$API/entities/LoanContract/$CONTRACT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Tenant-Id: $TENANT" \
  -H "Content-Type: application/json" \
  -d '{"status":"aprovado"}')

echo "$APPROVED" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if d.get("error"):
    print("ERRO:", d.get("error"))
    sys.exit(1)
print("Contrato:", d.get("contract_number"))
print("ID:", d.get("id"))
print("Status:", d.get("status"))
print("Criado por:", d.get("created_by"))
print("Aprovado por:", d.get("approved_by"))
print("Aprovado em:", d.get("approved_date"))
print("Exportado CP:", d.get("exported_to_payables"))
print("Exportado CR:", d.get("exported_to_receivables"))
'
