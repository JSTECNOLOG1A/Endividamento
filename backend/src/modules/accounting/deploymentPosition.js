// Posição de um contrato numa data-base de implantação de saldos (T5 na medida que a T7 precisa).
//
// Regra (plano de virada v9, seção 4.1): o principal vem dos MOVIMENTOS efetivos, não do
// cronograma sozinho. Aqui o "efetivo" é: parcela até a data-base conta como paga, exceto as
// parcelas informadas como vencidas em aberto. O cronograma serve de base de comparação.
//
// Não grava nada e não altera o cronograma.
import { reconcileContractForCompetencia } from "./closingEngine.js";

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
 */
export function computeDeploymentPosition(contract, cutoffIso, openParcelas = []) {
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
    juros: r2(Math.max(0, (r.jurosPagos || 0) - capitalizedExtra(r, contract))),
    emAberto: open.has(String(Number(r.parcela))),
  }));

  // Parcelas em aberto entram como "baixa de valor zero": o saldo não é reduzido por elas.
  const synthetic = rowsUpTo
    .filter((r) => open.has(String(Number(r.parcela))))
    .map((r) => ({ id: `implantacao-${r.parcela}`, parcela: r.parcela, status: "baixado", principal_paid: 0, interest_paid: 0 }));

  const [y, m] = cutoffIso.split("-").map(Number);
  const rec = reconcileContractForCompetencia({ ...contract, deployment_mode: false, payoff_date: null }, y, m, synthetic);
  const principalTotal = Math.max(0, r2(rec.closing.principal));
  const jurosTotal = Math.max(0, r2(rec.closing.interest));

  const openRows = rowsUpTo.filter((r) => open.has(String(Number(r.parcela))));
  const principalVencido = Math.min(principalTotal, r2(openRows.reduce((s, r) => s + (r.amortizacao || 0) + capitalizedExtra(r, contract), 0)));
  const jurosVencido = Math.min(jurosTotal, r2(openRows.reduce((s, r) => s + Math.max(0, (r.jurosPagos || 0) - capitalizedExtra(r, contract)), 0)));

  // Circulante (CPC 26): vence até a data-base + 12 meses.
  const limit = addMonthsIso(cutoffIso, 12);
  const future = schedule.filter((r) => r.dataVencimento > cutoffIso);
  const shortDue = r2(future.filter((r) => r.dataVencimento <= limit).reduce((s, r) => s + (r.amortizacao || 0) + capitalizedExtra(r, contract), 0));
  const principalVincendo = r2(principalTotal - principalVencido);
  const principalCPvincendo = Math.min(principalVincendo, shortDue);
  const principalCP = r2(principalVencido + principalCPvincendo);
  const principalLP = r2(principalTotal - principalCP);

  const nextInterest = future.find((r) => (r.jurosPagos || 0) > 0);
  const jurosVincendo = r2(jurosTotal - jurosVencido);
  const jurosShort = !nextInterest || nextInterest.dataVencimento <= limit;
  const jurosCP = r2(jurosVencido + (jurosShort ? jurosVincendo : 0));
  const jurosLP = r2(jurosTotal - jurosCP);

  if (contract.currency_id) warnings.push("Contrato em moeda estrangeira: posição indicativa (variação cambial acumulada não incorporada ao principal).");
  if (schedule.some((r) => r.liberacaoInjetada)) warnings.push("Contrato com liberação parcelada: conferir as tranches com o demonstrativo do credor.");
  if (rec.closing.principal < -0.05 || rec.closing.interest < -0.05) warnings.push("Saldo negativo apurado: revisar parcelas em aberto e o cronograma.");

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
