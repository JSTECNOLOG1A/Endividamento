// Dashboard executivo — os 7 indicadores da primeira onda, todos derivados do MESMO motor de posição
// (computeContractPositionAsOf, em deploymentPosition.js), numa data-base escolhida. Só leitura.
//
// Decisões do usuário (2026-09-29):
//  1. Empresa aguardando implantação de saldos, ou sem nenhum contrato: não mostra números — devolve
//     `blocked` com a lista de empresas nessa condição, pra tela mostrar o aviso de sempre.
//  2. Vencimentos em 30/90/180 dias: contados a partir da DATA-BASE escolhida, não de hoje.
//  3. Seletor de empresa, com opção de ver todas consolidadas (`entityId: "all"` ou omitido).
//  4. Sem restrição de nível de aprovação — qualquer usuário do tenant.
//  5. Garantias: por COMBINAÇÃO dos dois eixos (real + pessoal), não por eixo separado — um contrato com
//     hipoteca + aval forma seu próprio bucket "Hipoteca + Aval", não conta em "Hipoteca" E em "Aval".
import { pool } from "../../db/pool.js";
import { groupIdOrThrow } from "../tenants/access.js";
import { computeContractPositionAsOf, isLastDayOfMonthIso } from "./deploymentPosition.js";
import { loadDataBasePtax } from "./balanceDeployment.js";

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseSchedule(contract) {
  try {
    const parsed = typeof contract.schedule_data === "string" ? JSON.parse(contract.schedule_data) : contract.schedule_data;
    return parsed?.schedule || [];
  } catch {
    return [];
  }
}

function addDaysIso(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// Valor da parcela em BRL: campos de topo do cronograma vêm na moeda do contrato (USD, se estrangeiro);
// para vencimentos FUTUROS a única conversão possível é projetar com a PTAX da própria data-base — mesma
// simplificação já usada no resto do sistema ("usa a última cotação e replica pro futuro").
function rowValueBRL(row, foreign, ptax) {
  const principal = row.amortizacao || 0;
  const juros = row.jurosPagos || 0;
  return foreign ? r2((principal + juros) * ptax) : r2(principal + juros);
}

export async function getDashboardSummary(payload = {}) {
  const { entityId = "all", dataBase } = payload;
  if (!isLastDayOfMonthIso(dataBase)) throw httpError(400, "A data-base deve ser o último dia de um mês (AAAA-MM-DD)");
  const groupId = groupIdOrThrow();

  const entities = (await pool.query(
    `SELECT id, entity_name, implantacao_pendente FROM company_entities
      WHERE group_id = $1 AND status = 'ativa' AND ($2::text = 'all' OR id = $2)
      ORDER BY entity_name`,
    [groupId, entityId]
  )).rows;
  if (!entities.length) throw httpError(404, entityId === "all" ? "Nenhuma empresa ativa neste cliente" : "Empresa não encontrada");

  const blocked = entities.filter((e) => e.implantacao_pendente);
  const usable = entities.filter((e) => !e.implantacao_pendente);
  if (!usable.length) {
    return { dataBase, entities: entities.map((e) => ({ id: e.id, name: e.entity_name })), usableEntities: [], blockedEntities: blocked.map((e) => ({ id: e.id, name: e.entity_name })), blocked: true, indicators: null };
  }

  const contracts = (await pool.query(
    `SELECT c.*, b.bank_name FROM loan_contracts c LEFT JOIN banks b ON b.id = c.bank_id
      WHERE c.group_id = $1 AND c.entity_id = ANY($2::text[]) AND c.status = 'aprovado'
      ORDER BY c.operation_date`,
    [groupId, usable.map((e) => e.id)]
  )).rows;

  const ptaxCache = new Map(); // currency_id -> {ptax, ptaxDate} | null
  const loadPtax = async (currencyId) => {
    if (!ptaxCache.has(currencyId)) ptaxCache.set(currencyId, await loadDataBasePtax(currencyId, dataBase));
    return ptaxCache.get(currencyId);
  };

  const limit30 = addDaysIso(dataBase, 30);
  const limit90 = addDaysIso(dataBase, 90);
  const limit180 = addDaysIso(dataBase, 180);

  let saldoTotal = 0, principalTotal = 0, jurosTotal = 0;
  let vencendo30 = 0, vencendo90 = 0, vencendo180 = 0;
  let exposicaoCambial = 0;
  const porBanco = new Map(); // bank_id -> {label, total}
  const porGarantia = new Map(); // "real|pessoal" -> {realType, personalType, total}
  const warnings = [];
  const skippedContracts = [];

  for (const contract of contracts) {
    const foreign = Boolean(contract.currency_id);
    let ptaxInfo = null;
    if (foreign) {
      ptaxInfo = await loadPtax(contract.currency_id);
      if (!ptaxInfo) {
        skippedContracts.push({ contractId: contract.id, contractNumber: contract.contract_number, reason: "PTAX da data-base ausente" });
        continue;
      }
    }
    const pos = await computeContractPositionAsOf(contract, dataBase, foreign ? { ptax: ptaxInfo.ptax, ptaxDate: ptaxInfo.ptaxDate } : {});
    if (pos.missingPtax) {
      skippedContracts.push({ contractId: contract.id, contractNumber: contract.contract_number, reason: "PTAX da data-base ausente" });
      continue;
    }
    if (pos.warnings?.length) warnings.push(...pos.warnings.map((w) => `${contract.contract_number}: ${w}`));

    const total = pos.position.total || 0;
    saldoTotal += total;
    principalTotal += pos.position.principalTotal || 0;
    jurosTotal += pos.position.jurosTotal || 0;
    if (foreign) exposicaoCambial += total;

    // Cada bucket guarda também os contratos que o compõem — é o que permite o drill-down do agregado até
    // o contrato de origem (não só o número consolidado).
    const contractRef = { contractId: contract.id, contractNumber: contract.contract_number, total: r2(total) };

    const bankKey = contract.bank_id || "sem_banco";
    const bankLabel = contract.bank_name || "Sem banco";
    if (!porBanco.has(bankKey)) porBanco.set(bankKey, { label: bankLabel, total: 0, contracts: [] });
    porBanco.get(bankKey).total += total;
    porBanco.get(bankKey).contracts.push(contractRef);

    const garKey = `${contract.guarantee_real_type || ""}|${contract.guarantee_personal_type || ""}`;
    if (!porGarantia.has(garKey)) porGarantia.set(garKey, { realType: contract.guarantee_real_type || null, personalType: contract.guarantee_personal_type || null, total: 0, contracts: [] });
    porGarantia.get(garKey).total += total;
    porGarantia.get(garKey).contracts.push(contractRef);

    // Vencimentos futuros (30/90/180 dias a partir da data-base): parcelas do cronograma além da
    // data-base, ainda não cobertas pela posição acima (que só olha até a data-base).
    const schedule = parseSchedule(contract);
    for (const row of schedule) {
      if (row.dataVencimento <= dataBase) continue;
      if (row.dataVencimento > limit180) break;
      const value = rowValueBRL(row, foreign, ptaxInfo?.ptax || 0);
      if (row.dataVencimento <= limit30) vencendo30 += value;
      if (row.dataVencimento <= limit90) vencendo90 += value;
      vencendo180 += value;
    }
  }

  return {
    dataBase,
    entities: entities.map((e) => ({ id: e.id, name: e.entity_name })),
    usableEntities: usable.map((e) => ({ id: e.id, name: e.entity_name })),
    blockedEntities: blocked.map((e) => ({ id: e.id, name: e.entity_name })),
    blocked: false,
    skippedContracts,
    warnings,
    indicators: {
      saldoTotal: r2(saldoTotal),
      principalEmAberto: r2(principalTotal),
      jurosEncargosAcumulados: r2(jurosTotal),
      vencimentos: { d30: r2(vencendo30), d90: r2(vencendo90), d180: r2(vencendo180) },
      exposicaoCambial: { valor: r2(exposicaoCambial), percentual: saldoTotal > 0 ? r2((exposicaoCambial / saldoTotal) * 100) : 0 },
      concentracaoPorBanco: [...porBanco.values()].map((b) => ({ label: b.label, total: r2(b.total), contracts: b.contracts.sort((a, c) => c.total - a.total) })).sort((a, b) => b.total - a.total),
      garantias: [...porGarantia.values()].map((g) => ({ ...g, total: r2(g.total), contracts: g.contracts.sort((a, c) => c.total - a.total) })).sort((a, b) => b.total - a.total),
    },
  };
}
