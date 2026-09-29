// Posição de um contrato numa data-base de implantação de saldos (T5 na medida que a T7 precisa).
//
// Regra (plano de virada v9, seção 4.1): o principal vem dos MOVIMENTOS efetivos, não do
// cronograma sozinho. Aqui o "efetivo" é: parcela até a data-base conta como paga, exceto as
// parcelas informadas como vencidas em aberto. O cronograma serve de base de comparação.
//
// Não grava nada e não altera o cronograma.
//
// `computeContractPositionAsOf`, mais abaixo, generaliza essa mesma conta para uso recorrente (Dashboard):
// em vez de receber manualmente quais parcelas até a data-base estão em aberto (só faz sentido numa
// implantação, onde o histórico é externo ao sistema), deriva isso dos títulos reais do contrato — e,
// diferente da implantação, respeita `deployment_mode`/`payoff_date` do próprio contrato (aqui já pode ter
// passado por uma virada ou uma quitação antecipada de verdade).
import { pool } from "../../db/pool.js";
import { reconcileContractForCompetencia, toForeignView } from "./closingEngine.js";

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

function addMonthsIso(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1 + delta, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function parseSchedule(contract) {
  try {
    const parsed = typeof contract.schedule_data === "string" ? JSON.parse(contract.schedule_data) : contract.schedule_data;
    return parsed?.schedule || [];
  } catch {
    return [];
  }
}

// Juros pagos da linha em REAIS: em contrato em moeda estrangeira o campo de topo vem em USD; o bloco
// contábil da linha traz o valor em reais.
function rowInterestPaid(row, contract) {
  if (contract.currency_id && row.blocoContabil && row.blocoContabil.jurosPagosBRL !== undefined) return row.blocoContabil.jurosPagosBRL || 0;
  return row.jurosPagos || 0;
}

// Parte da parcela que amortiza principal além da amortização informada (juros capitalizados pagos depois).
function capitalizedExtra(row, contract) {
  if (row.liberacaoInjetada || contract.currency_id) return 0;
  const gap = r2((row.sdInicial || 0) + (row.jurosCapitalizados || 0) - (row.sdFinal || 0) - (row.amortizacao || 0));
  return gap > 0.05 ? gap : 0;
}

export function isLastDayOfMonthIso(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return false;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m, 0).getDate() === d;
}

/**
 * @param {object} contract linha de loan_contracts (schedule_data, operation_date, currency_id, ...)
 * @param {string} cutoffIso data-base (último dia do mês, AAAA-MM-DD)
 * @param {Array<string|number>} openParcelas parcelas até a data-base que continuam em aberto
 * @param {{ptax?: number, ptaxDate?: string}} options PTAX da data-base (contrato em moeda estrangeira)
 */
export function computeDeploymentPosition(contract, cutoffIso, openParcelas = [], options = {}) {
  const foreign = Boolean(contract.currency_id);
  const ptax = Number(options.ptax) || 0;
  if (foreign) {
    const sched = parseSchedule(contract);
    if (!sched.length) return computeDeploymentPosition({ ...contract, currency_id: null }, cutoffIso, openParcelas, options);
    if (!ptax) {
      // Sem PTAX da data-base não há posição em reais confiável: devolve zerado e bloqueia a aprovação.
      const base = computeDeploymentPosition(toForeignView(contract, sched), cutoffIso, openParcelas, options);
      return {
        ...base,
        position: { ...base.position, foreignUnitsOnly: true },
        warnings: [...base.warnings, "PTAX da data-base ausente: cadastre a cotação (Moedas) para calcular a posição em reais."],
        missingPtax: true,
      };
    }
    const base = computeDeploymentPosition(toForeignView(contract, sched), cutoffIso, openParcelas, options);
    const conv = (v) => r2((Number(v) || 0) * ptax);
    // Converte o total e o circulante; o não circulante é o resto — assim as partes somam exatamente o
    // total em reais (a conversão de cada parte separada poderia divergir em centavos).
    const bp = base.position;
    const position = {
      principalTotal: conv(bp.principalTotal), principalVencido: conv(bp.principalVencido), principalCP: conv(bp.principalCP),
      jurosTotal: conv(bp.jurosTotal), jurosVencido: conv(bp.jurosVencido), jurosCP: conv(bp.jurosCP),
    };
    position.principalLP = r2(position.principalTotal - position.principalCP);
    position.jurosLP = r2(position.jurosTotal - position.jurosCP);
    position.total = r2(position.principalTotal + position.jurosTotal);
    return {
      position,
      positionForeign: base.position,
      ptax, ptaxDate: options.ptaxDate || null,
      parcelasAteDataBase: base.parcelasAteDataBase.map((p) => ({ ...p, principalMoeda: p.principal, jurosMoeda: p.juros, principal: conv(p.principal), juros: conv(p.juros) })),
      warnings: [...base.warnings, `Contrato em moeda estrangeira: posição em reais pela PTAX de ${options.ptaxDate || "data-base"} (${ptax.toFixed(4)}). Confira com o demonstrativo do credor.`],
    };
  }
  const schedule = parseSchedule(contract);
  const warnings = [];
  const empty = {
    principalTotal: 0, principalVencido: 0, principalCP: 0, principalLP: 0,
    jurosTotal: 0, jurosVencido: 0, jurosCP: 0, jurosLP: 0, total: 0,
  };
  if (!schedule.length) return { position: empty, parcelasAteDataBase: [], warnings: ["Contrato sem cronograma calculado."] };

  const open = new Set((openParcelas || []).map((p) => String(Number(p))));
  const rowsUpTo = schedule.filter((r) => r.dataVencimento <= cutoffIso);
  const parcelasAteDataBase = rowsUpTo.map((r) => ({
    parcela: r.parcela,
    dataVencimento: r.dataVencimento,
    principal: r2((r.amortizacao || 0) + capitalizedExtra(r, contract)),
    juros: r2(Math.max(0, rowInterestPaid(r, contract) - capitalizedExtra(r, contract))),
    emAberto: open.has(String(Number(r.parcela))),
  }));

  // Parcelas em aberto entram como "baixa de valor zero": o saldo não é reduzido por elas.
  const synthetic = rowsUpTo
    .filter((r) => open.has(String(Number(r.parcela))))
    .map((r) => ({ id: `implantacao-${r.parcela}`, parcela: r.parcela, status: "baixado", principal_paid: 0, interest_paid: 0 }));

  const [y, m] = cutoffIso.split("-").map(Number);
  // Implantação (padrão): força a ignorar deployment_mode/payoff_date do contrato — nesse fluxo o contrato
  // ainda nem tem esses campos definidos. Uso recorrente (Dashboard, respectContractLifecycle): respeita os
  // dois, porque aqui o contrato já pode ter passado por uma virada ou uma quitação antecipada de verdade.
  const rec = reconcileContractForCompetencia(
    options.respectContractLifecycle ? contract : { ...contract, deployment_mode: false, payoff_date: null },
    y, m, synthetic
  );
  const principalTotal = Math.max(0, r2(rec.closing.principal));
  const jurosTotal = Math.max(0, r2(rec.closing.interest));

  const openRows = rowsUpTo.filter((r) => open.has(String(Number(r.parcela))));
  const principalVencido = Math.min(principalTotal, r2(openRows.reduce((s, r) => s + (r.amortizacao || 0) + capitalizedExtra(r, contract), 0)));
  const jurosVencido = Math.min(jurosTotal, r2(openRows.reduce((s, r) => s + Math.max(0, rowInterestPaid(r, contract) - capitalizedExtra(r, contract)), 0)));

  // Circulante (CPC 26): vence até a data-base + 12 meses.
  const limit = addMonthsIso(cutoffIso, 12);
  const future = schedule.filter((r) => r.dataVencimento > cutoffIso);
  const shortDue = r2(future.filter((r) => r.dataVencimento <= limit).reduce((s, r) => s + (r.amortizacao || 0) + capitalizedExtra(r, contract), 0));
  const principalVincendo = r2(principalTotal - principalVencido);
  const principalCPvincendo = Math.min(principalVincendo, shortDue);
  const principalCP = r2(principalVencido + principalCPvincendo);
  const principalLP = r2(principalTotal - principalCP);

  const nextInterest = future.find((r) => rowInterestPaid(r, contract) > 0);
  const jurosVincendo = r2(jurosTotal - jurosVencido);
  const jurosShort = !nextInterest || nextInterest.dataVencimento <= limit;
  const jurosCP = r2(jurosVencido + (jurosShort ? jurosVincendo : 0));
  const jurosLP = r2(jurosTotal - jurosCP);

  if (schedule.some((r) => r.liberacaoInjetada)) warnings.push("Contrato com liberação parcelada: conferir as tranches com o demonstrativo do credor.");
  if (rec.closing.principal < -0.05 || rec.closing.interest < -0.05) warnings.push("Saldo negativo apurado: revisar parcelas em aberto e o cronograma.");
  if (contract.transaction_cost_recognition === "amortizado") warnings.push("Custo de transação amortizado: o saldo do ativo diferido não está representado nesta posição — confira à parte antes de aprovar.");

  return {
    position: {
      principalTotal, principalVencido, principalCP, principalLP,
      jurosTotal, jurosVencido, jurosCP, jurosLP,
      total: r2(principalTotal + jurosTotal),
    },
    parcelasAteDataBase,
    warnings,
  };
}

// Parcelas do contrato, com vencimento até a data-base, que continuam sem baixa — a mesma informação que na
// implantação vem de fora (o histórico é anterior ao sistema); aqui já é o próprio AllDebt que sabe.
// `cancelado` e `ignorado_implantacao` não contam como "em aberto": o primeiro não é dívida, o segundo já
// está coberto pela abertura da virada.
async function loadOpenParcelasAsOf(contractId, cutoffIso) {
  const result = await pool.query(
    `SELECT parcela FROM payable_titles WHERE contract_id = $1 AND vencimento <= $2::date AND status = 'aberto'`,
    [contractId, cutoffIso]
  );
  return result.rows.map((r) => r.parcela);
}

/**
 * Posição de um contrato JÁ APROVADO E EM VIDA (não a implantação) numa data-base qualquer — pensado para
 * reuso recorrente (ex.: Dashboard), não para uma foto única. Mesma conta de `computeDeploymentPosition`,
 * mas deriva sozinho quais parcelas até a data-base estão em aberto (a partir dos títulos reais) e respeita
 * `deployment_mode`/`payoff_date` do contrato.
 *
 * @param {object} contract linha de loan_contracts
 * @param {string} cutoffIso data-base (AAAA-MM-DD, recomendado fim de mês)
 * @param {{ptax?: number, ptaxDate?: string}} options PTAX da data-base (contrato em moeda estrangeira)
 */
export async function computeContractPositionAsOf(contract, cutoffIso, options = {}) {
  const openParcelas = await loadOpenParcelasAsOf(contract.id, cutoffIso);
  return computeDeploymentPosition(contract, cutoffIso, openParcelas, { ...options, respectContractLifecycle: true });
}
