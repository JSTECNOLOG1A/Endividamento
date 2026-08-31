import * as store from "../entities/store.js";
import { IndexerFactory } from "../../engine/indexers/IndexerFactory.js";
import { fixedRateForPeriod, indexerFactorForPeriod, businessDaysBetween, daysBetween, roundMoney } from "../../engine/CalculationEngine.js";

// Conta garantida / capital de giro rotativo: produto sem cronograma de
// amortização fixo — o saldo utilizado sobe (saque) e desce (pagamento)
// livremente dentro da vigência (abertura → vencimento do LoanContract).
// Esta função monta o EXTRATO: para cada lançamento, calcula os juros
// acumulados desde o lançamento anterior sobre o saldo que existia até ali
// (mesma matemática de indexador do motor de amortização — CDI/SELIC/IPCA/
// TJLP/TR + spread ou % — só que aplicada a um saldo variável em vez de uma
// tabela fixa), e capitaliza esse juro no saldo (convenção padrão de conta
// garantida: juros não pagos entram no saldo devedor, voltam a render juros
// no período seguinte).
export async function calculateGuaranteedAccountStatement(payload = {}) {
  const { contractId, asOfDate: rawAsOfDate = null } = payload;
  if (!contractId) {
    const err = new Error("contractId é obrigatório");
    err.status = 400;
    throw err;
  }

  const contract = await store.getById("LoanContract", contractId);
  const movements = await store.filter("AccountMovement", { contract_id: contractId }, "movement_date", 10000);
  const holidays = await store.list("Holiday", "holiday_date", 20000);

  const indexer = contract.indexer || "NA";
  const needsRates = indexer !== "NA";
  const allRates = needsRates ? await store.list("CDIRate", "rate_date", 20000) : [];
  const indexerFactory = new IndexerFactory(
    allRates.filter((r) => r.rate_type === "CDI"),
    allRates.filter((r) => r.rate_type === "SELIC"),
    [],
    allRates.filter((r) => r.rate_type === "IPCA"),
    allRates.filter((r) => r.rate_type === "TJLP"),
    allRates.filter((r) => r.rate_type === "TR")
  );

  function periodRate(startDate, endDate) {
    const dias = daysBetween(startDate, endDate);
    if (dias <= 0) return 0;
    let rate = fixedRateForPeriod(Number(contract.fixed_rate) || 0, dias);
    if (indexer !== "NA") {
      const indexAccum = indexerFactory.getFactor(indexer, startDate, endDate, holidays);
      if (contract.indexer_mode === "PERCENTAGE") {
        const indexerRate = Math.pow(indexAccum.factor, (Number(contract.indexer_percentage) || 100) / 100) - 1;
        // Combina com o componente fixo (se houver) do mesmo jeito que o motor:
        // fatores multiplicam, não somam.
        rate = (1 + rate) * (1 + indexerRate) - 1;
      } else {
        const du = businessDaysBetween(startDate, endDate, holidays);
        const spreadRate = indexerFactorForPeriod(Number(contract.indexer_spread) || 0, du);
        const indexerRate = indexAccum.factor * (1 + spreadRate) - 1;
        rate = (1 + rate) * (1 + indexerRate) - 1;
      }
    }
    return rate;
  }

  const limite = Number(contract.operation_value) || 0;
  let saldo = 0;
  let prevDate = contract.operation_date;
  let totalJuros = 0;
  let maxSaldo = 0;
  const extrato = [];

  for (const mov of movements) {
    const rate = periodRate(prevDate, mov.movement_date);
    const juros = saldo > 0 ? roundMoney(saldo * rate) : 0;
    saldo = roundMoney(saldo + juros); // juros não pagos capitalizam no saldo
    totalJuros += juros;

    const amount = Number(mov.amount) || 0;
    if (mov.movement_type === "saque" || mov.movement_type === "saldo_abertura") {
      saldo = roundMoney(saldo + amount);
    } else if (mov.movement_type === "pagamento") {
      saldo = roundMoney(Math.max(0, saldo - amount));
    }
    maxSaldo = Math.max(maxSaldo, saldo);

    extrato.push({
      movement_id: mov.id,
      date: mov.movement_date,
      type: mov.movement_type,
      amount,
      juros_periodo: juros,
      saldo_apos: saldo,
      excedeu_limite: saldo > limite,
    });
    prevDate = mov.movement_date;
  }

  // Juros do período final: do último lançamento até asOfDate (ou hoje,
  // limitado ao vencimento — não faz sentido projetar juros além dele).
  const today = new Date().toISOString().slice(0, 10);
  let asOfDate = rawAsOfDate || today;
  if (contract.final_maturity_date && asOfDate > contract.final_maturity_date) {
    asOfDate = contract.final_maturity_date;
  }
  let jurosPeriodoFinal = 0;
  if (saldo > 0 && asOfDate > prevDate) {
    const rate = periodRate(prevDate, asOfDate);
    jurosPeriodoFinal = roundMoney(saldo * rate);
    saldo = roundMoney(saldo + jurosPeriodoFinal);
    totalJuros += jurosPeriodoFinal;
    maxSaldo = Math.max(maxSaldo, saldo);
  }

  return {
    contract_id: contractId,
    limite_contratado: limite,
    saldo_atual: saldo,
    limite_disponivel: roundMoney(limite - saldo),
    saldo_maximo_no_periodo: maxSaldo,
    excedeu_limite_alguma_vez: maxSaldo > limite,
    total_juros_acumulado: roundMoney(totalJuros),
    juros_periodo_final: jurosPeriodoFinal,
    as_of_date: asOfDate,
    vencimento: contract.final_maturity_date,
    extrato,
  };
}

// Renovação: fecha a vigência atual (marca status) e cria uma nova
// LoanContract com o saldo remanescente entrando como lançamento
// 'saldo_abertura' — evita tentar modelar rollover dentro do mesmo
// contrato (que não tem cronograma fixo pra "encerrar e reabrir").
export async function renewGuaranteedAccount(payload = {}, actor = "system") {
  const { contractId, newLimit, newMaturityDate, newOperationDate } = payload;
  if (!contractId || !newLimit || !newMaturityDate) {
    const err = new Error("contractId, newLimit e newMaturityDate são obrigatórios");
    err.status = 400;
    throw err;
  }

  const oldContract = await store.getById("LoanContract", contractId);
  const openDate = newOperationDate || new Date().toISOString().slice(0, 10);
  // O saldo transferido precisa ser calculado NA DATA DA RENOVAÇÃO, não em
  // "hoje" — renovação costuma ser lançada com antecedência ou em lote,
  // então a data corrente do sistema pode não ter nada a ver com a data em
  // que a vigência antiga efetivamente encerra.
  const statement = await calculateGuaranteedAccountStatement({ contractId, asOfDate: openDate });

  const newContract = await store.create(
    "LoanContract",
    {
      group_id: oldContract.group_id,
      entity_id: oldContract.entity_id,
      bank_id: oldContract.bank_id,
      contract_number: `${oldContract.contract_number}-R${Date.now().toString().slice(-4)}`,
      operation_category: oldContract.operation_category,
      operation_type: oldContract.operation_type,
      operation_value: newLimit,
      fixed_rate: oldContract.fixed_rate,
      indexer: oldContract.indexer,
      indexer_spread: oldContract.indexer_spread,
      indexer_mode: oldContract.indexer_mode,
      indexer_percentage: oldContract.indexer_percentage,
      operation_date: openDate,
      final_maturity_date: newMaturityDate,
      calculation_system: "CONTA_GARANTIDA",
      status: "aprovado",
      guarantee_real_type: oldContract.guarantee_real_type,
      guarantee_personal_type: oldContract.guarantee_personal_type,
    },
    actor
  );

  if (statement.saldo_atual > 0) {
    await store.create(
      "AccountMovement",
      {
        contract_id: newContract.id,
        movement_date: openDate,
        movement_type: "saldo_abertura",
        amount: statement.saldo_atual,
        observacao: `Saldo transferido da renovação do contrato ${oldContract.contract_number}`,
      },
      actor
    );
  }

  await store.update("LoanContract", contractId, {
    status: "cancelado",
    rejection_comments: `Renovado em ${openDate} — nova vigência: contrato ${newContract.id} (${newContract.contract_number})`,
  });

  return {
    old_contract_id: contractId,
    new_contract_id: newContract.id,
    new_contract_number: newContract.contract_number,
    saldo_transferido: statement.saldo_atual,
  };
}
