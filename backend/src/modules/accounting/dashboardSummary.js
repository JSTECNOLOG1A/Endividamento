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
import { OPERATION_CATEGORY_LABELS } from "./closingEngine.js";

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

function isoDateOnly(value) {
  if (!value) return "";
  if (value instanceof Date) {
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${value.getFullYear()}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

// CET só existe dentro do schedule_data (não é coluna) — cada contrato o calcula uma vez, na aprovação.
function parseCet(contract) {
  try {
    const parsed = typeof contract.schedule_data === "string" ? JSON.parse(contract.schedule_data) : contract.schedule_data;
    const v = Number(parsed?.cet);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// Acumula um contrato nos 3 níveis da árvore de CET (banco → categoria → tipo), ponderado pelo saldo
// devedor atual na data-base (mesma régua do resto do Dashboard — não é média simples nem pelo valor
// original contratado, porque um contrato quase liquidado não deveria pesar como um recém-liberado).
function addToCetTree(tree, bankKey, bankLabel, category, categoryLabel, type, weight, cet, contractRef) {
  if (cet == null || !(weight > 0)) return;
  if (!tree.has(bankKey)) tree.set(bankKey, { label: bankLabel, weight: 0, weightedSum: 0, categorias: new Map() });
  const bank = tree.get(bankKey);
  bank.weight += weight; bank.weightedSum += weight * cet;

  if (!bank.categorias.has(category)) bank.categorias.set(category, { label: categoryLabel, category, weight: 0, weightedSum: 0, tipos: new Map() });
  const cat = bank.categorias.get(category);
  cat.weight += weight; cat.weightedSum += weight * cet;

  if (!cat.tipos.has(type)) cat.tipos.set(type, { label: type, type, weight: 0, weightedSum: 0, contracts: [] });
  const tp = cat.tipos.get(type);
  tp.weight += weight; tp.weightedSum += weight * cet;
  tp.contracts.push({ ...contractRef, cetPercent: r2(cet) });
}

function finalizeCetTree(tree) {
  return [...tree.values()]
    .map((bank) => ({
      label: bank.label,
      cetPercent: bank.weight > 0 ? r2(bank.weightedSum / bank.weight) : null,
      saldoBase: r2(bank.weight),
      categorias: [...bank.categorias.values()]
        .map((cat) => ({
          label: cat.label,
          category: cat.category,
          cetPercent: cat.weight > 0 ? r2(cat.weightedSum / cat.weight) : null,
          saldoBase: r2(cat.weight),
          tipos: [...cat.tipos.values()]
            .map((tp) => ({
              label: tp.label,
              type: tp.type,
              cetPercent: tp.weight > 0 ? r2(tp.weightedSum / tp.weight) : null,
              saldoBase: r2(tp.weight),
              contracts: tp.contracts.sort((a, b) => b.total - a.total),
            }))
            .sort((a, b) => b.saldoBase - a.saldoBase),
        }))
        .sort((a, b) => b.saldoBase - a.saldoBase),
    }))
    .sort((a, b) => b.saldoBase - a.saldoBase);
}

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
    `SELECT c.*, b.bank_name, cur.currency_code
       FROM loan_contracts c
       LEFT JOIN banks b ON b.id = c.bank_id
       LEFT JOIN currencies cur ON cur.id = c.currency_id
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
  const cetTree = new Map(); // banco -> categoria -> tipo, ponderado pelo saldo atual
  const volumePorBanco = new Map(); // volume CONTRATADO (valor original), não saldo atual
  const volumePorMoeda = new Map();
  const volumePorCategoria = new Map(); // categoria -> tipos
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

    // CET escalonado: ponderado pelo saldo atual (= `total` desta mesma posição), não pelo valor contratado.
    const categoryLabel = OPERATION_CATEGORY_LABELS[contract.operation_category] || contract.operation_category || "Outros";
    addToCetTree(cetTree, bankKey, bankLabel, contract.operation_category || "outros", categoryLabel, contract.operation_type || "outros", total, parseCet(contract), contractRef);

    // Volume CONTRATADO (bancos/moeda/categoria×tipo mais tomados): valor ORIGINAL da operação, só dos
    // contratos já existentes nesta data-base (operação posterior a ela não "aconteceu" ainda do ponto de
    // vista da data escolhida) — diferente do saldo atual usado nos outros gráficos.
    if (isoDateOnly(contract.operation_date) <= dataBase) {
      const volume = Number(contract.operation_value) || 0;

      if (!volumePorBanco.has(bankKey)) volumePorBanco.set(bankKey, { label: bankLabel, total: 0 });
      volumePorBanco.get(bankKey).total += volume;

      const moedaKey = contract.currency_code || "BRL";
      if (!volumePorMoeda.has(moedaKey)) volumePorMoeda.set(moedaKey, { label: moedaKey, total: 0 });
      volumePorMoeda.get(moedaKey).total += volume;

      if (!volumePorCategoria.has(contract.operation_category)) {
        volumePorCategoria.set(contract.operation_category, { label: categoryLabel, category: contract.operation_category, total: 0, tipos: new Map() });
      }
      const catBucket = volumePorCategoria.get(contract.operation_category);
      catBucket.total += volume;
      const typeKey = contract.operation_type || "outros";
      if (!catBucket.tipos.has(typeKey)) catBucket.tipos.set(typeKey, { label: typeKey, type: typeKey, total: 0 });
      catBucket.tipos.get(typeKey).total += volume;
    }

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
      cetPorBanco: finalizeCetTree(cetTree),
      volumeContratado: {
        porBanco: [...volumePorBanco.values()].map((b) => ({ label: b.label, total: r2(b.total) })).sort((a, b) => b.total - a.total),
        porMoeda: [...volumePorMoeda.values()].map((m) => ({ label: m.label, total: r2(m.total) })).sort((a, b) => b.total - a.total),
        porCategoria: [...volumePorCategoria.values()]
          .map((c) => ({
            label: c.label,
            category: c.category,
            total: r2(c.total),
            tipos: [...c.tipos.values()].map((t) => ({ label: t.label, type: t.type, total: r2(t.total) })).sort((a, b) => b.total - a.total),
          }))
          .sort((a, b) => b.total - a.total),
      },
    },
  };
}
