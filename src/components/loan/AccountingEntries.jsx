/**
 * 🔐 ACCOUNTING ENTRIES — ETAPA 4A
 * 
 * Gera lançamentos contábeis a partir do schedule
 * Read-only: apenas reorganiza dados do result, sem recálculo
 */

/**
 * Gera lançamentos contábeis (débito/crédito) para cada parcela
 * Padrão: Contabilidade de Competência (IFRS/BACEN)
 * 
 * @param {Object} result - Output de calculateAmortizationSchedule()
 * @returns {Array} Array de lançamentos contábeis
 */
export function buildAccountingEntries(result, options = {}) {
  if (!result || !result.schedule) {
    throw new Error("[ACCOUNTING_ENTRIES] Result inválido: schedule ausente");
  }

  const { entry_mode = "ACCRUAL_ONLY" } = options;
  const entries = [];
  const isUSD = result.calculation_metadata?.currency === "USD";

  result.schedule.forEach((parcela, idx) => {
    const date = parcela.dataVencimento;

    // 1️⃣ LANÇAMENTO PRINCIPAL: Juros (débito) vs SD/Caixa (crédito)
    if (parcela.jurosFixosMes + parcela.jurosVariaveisMes > 0) {
      const totalJuros = parcela.jurosFixosMes + parcela.jurosVariaveisMes;
      entries.push({
        date,
        parcel: idx + 1,
        type: "INTEREST",
        description: `Juros - Parcela ${idx + 1}`,
        entries: [
          {
            account: "6111.01",
            description: "Juros de Operações",
            debit: totalJuros,
            credit: 0
          },
          {
            account: "2111.01",
            description: "Juros a Pagar",
            debit: 0,
            credit: totalJuros
          }
        ]
      });
    }

    // 2️⃣ LANÇAMENTO PRINCIPAL: Amortização (débito) vs Saldo Devedor (crédito)
    if (parcela.amortizacao > 0) {
      entries.push({
        date,
        parcel: idx + 1,
        type: "PRINCIPAL",
        description: `Amortização - Parcela ${idx + 1}`,
        entries: [
          {
            account: "2111.02",
            description: "Principal a Pagar",
            debit: parcela.amortizacao,
            credit: 0
          },
          {
            account: "1121.01",
            description: "Financiamentos (SD)",
            debit: 0,
            credit: parcela.amortizacao
          }
        ]
      });
    }

    // 3️⃣ LANÇAMENTO CAMBIAL: Variação (USD → BRL)
    // 🔐 ETAPA 4A: Corrigida lógica débito/crédito — ganho/perda sempre ÚNICA entrada
    if (isUSD && parcela.varCambial !== 0) {
      const isGain = parcela.varCambial > 0;
      const accountCode = isGain ? "4611.01" : "5611.01"; // Ganho ou Perda
      const amount = Math.abs(parcela.varCambial);

      entries.push({
        date,
        parcel: idx + 1,
        type: "EXCHANGE",
        description: `${isGain ? "Ganho" : "Perda"} Cambial - Parcela ${idx + 1}`,
        entries: [
          {
            account: accountCode,
            description: isGain ? "Ganho Cambial" : "Perda Cambial",
            debit: isGain ? amount : 0,
            credit: isGain ? 0 : amount
          },
          {
            account: "1121.01",
            description: "Financiamentos (Variação Cambial)",
            debit: isGain ? 0 : amount, // Perda aumenta SD, Ganho reduz
            credit: isGain ? amount : 0
          }
        ]
      });
    }

    // 4️⃣ LANÇAMENTO CAPITALIZADOS: Juros capitalizados (se aplicável)
    if (parcela.jurosCapitalizados > 0) {
      entries.push({
        date,
        parcel: idx + 1,
        type: "CAPITALIZATION",
        description: `Juros Capitalizados - Parcela ${idx + 1}`,
        entries: [
          {
            account: "2111.01",
            description: "Juros Capitalizados",
            debit: 0,
            credit: parcela.jurosCapitalizados
          },
          {
            account: "1121.01",
            description: "Financiamentos (Capitalização)",
            debit: parcela.jurosCapitalizados,
            credit: 0
          }
        ]
      });
    }

    // 5️⃣ LANÇAMENTO RECEIPT: Pagamento (débito caixa vs juros+principal)
    // 🔐 ETAPA 4A: Só gerar RECEIPT se entry_mode !== ACCRUAL_ONLY E há evento de pagamento real
    const hasPaymentEvent = parcela.paid === true || (parcela.paid_amount && parcela.paid_amount > 0);
    const totalPagamento = parcela.jurosPagos + parcela.amortizacao;
    
    if (entry_mode !== "ACCRUAL_ONLY" && hasPaymentEvent && totalPagamento > 0) {
      entries.push({
        date,
        parcel: idx + 1,
        type: "RECEIPT",
        description: `Recebimento - Parcela ${idx + 1}`,
        entries: [
          {
            account: "1111.01",
            description: "Caixa",
            debit: totalPagamento,
            credit: 0
          },
          {
            account: "2111.01",
            description: "Juros a Pagar",
            debit: 0,
            credit: parcela.jurosPagos
          },
          {
            account: "2111.02",
            description: "Principal a Pagar",
            debit: 0,
            credit: parcela.amortizacao
          }
        ]
      });
    }
  });

  return entries;
}

/**
 * Formata lançamentos contábeis para CSV (para Excel/sistemas legados)
 * @param {Array} entries - Output de buildAccountingEntries()
 * @returns {string} CSV formatado
 */
export function formatAccountingEntriesCSV(entries) {
  const rows = [
    ["Data", "Parcela", "Tipo", "Descrição", "Conta", "Débito", "Crédito"].join(",")
  ];

  entries.forEach((entry) => {
    entry.entries.forEach((line) => {
      rows.push(
        [
          entry.date,
          entry.parcel,
          entry.type,
          entry.description,
          line.account,
          line.debit > 0 ? line.debit.toFixed(2) : "",
          line.credit > 0 ? line.credit.toFixed(2) : ""
        ].join(",")
      );
    });
  });

  return rows.join("\n");
}

/**
 * Formata lançamentos contábeis para JSON (para APIs/ERP systems)
 * @param {Array} entries - Output de buildAccountingEntries()
 * @returns {string} JSON formatado
 */
export function formatAccountingEntriesJSON(entries) {
  return JSON.stringify(
    entries.map((entry) => ({
      ...entry,
      entries: entry.entries.map((line) => ({
        account: line.account,
        description: line.description,
        debit: line.debit > 0 ? line.debit : null,
        credit: line.credit > 0 ? line.credit : null,
        amount: Math.max(line.debit, line.credit)
      }))
    })),
    null,
    2
  );
}

/**
 * Valida integridade dos lançamentos (débito = crédito)
 * 🔐 ETAPA 4A: Suporta múltiplos validation_scope
 * @param {Array} entries - Output de buildAccountingEntries()
 * @param {Object} options - { validation_scope: "event"|"date"|"month" }
 * @returns {Object} { valid: boolean, balance_by_scope: {} }
 */
export function validateAccountingEntries(entries, options = {}) {
  const { validation_scope = "date" } = options;
  const balanceByScope = {};

  entries.forEach((entry) => {
    let scopeKey;

    if (validation_scope === "event") {
      // Por evento individual
      scopeKey = `${entry.date}_${entry.parcel}_${entry.type}`;
    } else if (validation_scope === "month") {
      // Por mês (YYYY-MM)
      scopeKey = entry.date.substring(0, 7);
    } else {
      // Por data (padrão)
      scopeKey = entry.date;
    }

    if (!balanceByScope[scopeKey]) {
      balanceByScope[scopeKey] = { debit: 0, credit: 0 };
    }

    entry.entries.forEach((line) => {
      balanceByScope[scopeKey].debit += line.debit || 0;
      balanceByScope[scopeKey].credit += line.credit || 0;
    });
  });

  // Verificar se débito = crédito em cada escopo (tolerância 0.01)
  const valid = Object.values(balanceByScope).every(
    (balance) => Math.abs(balance.debit - balance.credit) < 0.01
  );

  return { valid, validation_scope, balance_by_scope: balanceByScope };
}

export default {
  buildAccountingEntries,
  formatAccountingEntriesCSV,
  formatAccountingEntriesJSON,
  validateAccountingEntries
};