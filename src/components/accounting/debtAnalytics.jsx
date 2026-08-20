/**
 * 📊 CAMADA ANALÍTICA DE ENDIVIDAMENTO CORPORATIVO
 *
 * Funções para Controller/Tesouraria:
 * - Debt Position by Date
 * - Maturity Breakdown (Circulante/Não Circulante)
 * - Interest by Competency
 * - FX Variation Consolidated
 * - Annual Debt Map
 * - Debt by Structure
 * - Maturity Curve
 * - Debt KPIs
 * - Exercício Range (mês de início configurável, para suportar ano-safra)
 * - Payment Flow by Bank/Modality/Guarantee
 */

import { combineGuaranteeLabel } from "@/lib/contractOptions";

/**
 * 1️⃣ DEBT POSITION BY DATE
 * Snapshot da dívida em uma data específica
 */
export function getDebtPositionByDate(contracts, targetDate) {
  const snapshot = {
    date: targetDate,
    totalBalance: 0,
    totalPrincipal: 0,
    totalInterestAccrued: 0,
    totalFXVariation: 0,
    byContract: [],
    byCurrency: {},
    byOperationType: {},
    byOperationCategory: {}
  };

  const targetDateObj = new Date(targetDate + "T23:59:59");

  contracts.forEach((contract) => {
    if (!contract.schedule_data) return;

    try {
      const scheduleData = JSON.parse(contract.schedule_data);
      const schedule = scheduleData.schedule || [];

      // Encontrar última linha até targetDate
      let lastRow = null;
      let accumulatedInterest = 0;
      let accumulatedFX = 0;

      for (let i = 0; i < schedule.length; i++) {
        const row = schedule[i];
        const rowDate = new Date(row.dataVencimento + "T00:00:00");

        if (rowDate <= targetDateObj) {
          lastRow = row;
          accumulatedInterest += (row.jurosFixosMes || 0) + (row.jurosVariaveisMes || 0);
          accumulatedFX += row.varCambial || 0;
        } else {
          break;
        }
      }

      if (!lastRow) return;

      const contractSnapshot = {
        contractNumber: contract.contract_number,
        balance: lastRow.sdFinal || 0,
        principal: lastRow.sdInicial_USD || lastRow.sdInicial || 0,
        interestAccrued: accumulatedInterest,
        fxVariation: accumulatedFX,
        currency: contract.currency_id || "BRL",
        operationType: contract.operation_type,
        operationCategory: contract.operation_category,
        status: contract.status
      };

      snapshot.byContract.push(contractSnapshot);
      snapshot.totalBalance += contractSnapshot.balance;
      snapshot.totalPrincipal += contractSnapshot.principal;
      snapshot.totalInterestAccrued += contractSnapshot.interestAccrued;
      snapshot.totalFXVariation += contractSnapshot.fxVariation;

      // Agrupar por moeda
      const currency = contract.currency_id || "BRL";
      if (!snapshot.byCurrency[currency]) {
        snapshot.byCurrency[currency] = {
          balance: 0,
          count: 0,
          contracts: []
        };
      }
      snapshot.byCurrency[currency].balance += contractSnapshot.balance;
      snapshot.byCurrency[currency].count += 1;
      snapshot.byCurrency[currency].contracts.push(contractSnapshot);

      // Agrupar por operation_type
      const opType = contract.operation_type || "UNKNOWN";
      if (!snapshot.byOperationType[opType]) {
        snapshot.byOperationType[opType] = { balance: 0, count: 0 };
      }
      snapshot.byOperationType[opType].balance += contractSnapshot.balance;
      snapshot.byOperationType[opType].count += 1;

      // Agrupar por operation_category
      const opCategory = contract.operation_category || "UNKNOWN";
      if (!snapshot.byOperationCategory[opCategory]) {
        snapshot.byOperationCategory[opCategory] = { balance: 0, count: 0 };
      }
      snapshot.byOperationCategory[opCategory].balance += contractSnapshot.balance;
      snapshot.byOperationCategory[opCategory].count += 1;
    } catch (error) {
      console.warn(`Erro ao processar contrato ${contract.contract_number}:`, error);
    }
  });

  return {
    ...snapshot,
    totalBalance: Math.round(snapshot.totalBalance * 100) / 100,
    totalPrincipal: Math.round(snapshot.totalPrincipal * 100) / 100,
    totalInterestAccrued: Math.round(snapshot.totalInterestAccrued * 100) / 100,
    totalFXVariation: Math.round(snapshot.totalFXVariation * 100) / 100
  };
}

/**
 * 2️⃣ DEBT MATURITY BREAKDOWN
 * Separar vencimentos: Circulante (0-12m) vs Não Circulante (>12m)
 */
export function getDebtMaturityBreakdown(contracts, baseDate) {
  const baseDateObj = new Date(baseDate + "T00:00:00");

  const breakdown = {
    baseDate: baseDate,
    shortTerm: { // 0-12 meses
      balance: 0,
      contracts: [],
      dueDate: null
    },
    longTerm: { // >12 meses
      balance: 0,
      contracts: [],
      dueDate: null
    },
    dueSoon: { // <30 dias
      balance: 0,
      contracts: []
    },
    overdue: {
      balance: 0,
      contracts: []
    }
  };

  contracts.forEach((contract) => {
    if (!contract.schedule_data) return;

    try {
      const scheduleData = JSON.parse(contract.schedule_data);
      const schedule = scheduleData.schedule || [];

      // Encontrar primeira linha após baseDate com amortização
      let shortTermBalance = 0;
      let longTermBalance = 0;
      let dueSoonBalance = 0;
      let overdueBalance = 0;
      let shortTermMaturity = null;
      let longTermMaturity = null;

      schedule.forEach((row) => {
        const rowDate = new Date(row.dataVencimento + "T00:00:00");
        const daysToMaturity = Math.ceil((rowDate - baseDateObj) / (1000 * 60 * 60 * 24));
        const monthsToMaturity = Math.floor(daysToMaturity / 30.44);

        if (row.amortizacao > 0) {
          if (daysToMaturity < 0) {
            // Vencido
            overdueBalance += row.amortizacao;
          } else if (daysToMaturity <= 30) {
            // Vence em <30 dias
            dueSoonBalance += row.amortizacao;
            shortTermBalance += row.amortizacao;
            shortTermMaturity = shortTermMaturity ? new Date(Math.min(new Date(shortTermMaturity).getTime(), rowDate.getTime())) : rowDate;
          } else if (monthsToMaturity <= 12) {
            // Circulante
            shortTermBalance += row.amortizacao;
            shortTermMaturity = shortTermMaturity ? new Date(Math.max(new Date(shortTermMaturity).getTime(), rowDate.getTime())) : rowDate;
          } else {
            // Não circulante
            longTermBalance += row.amortizacao;
            longTermMaturity = longTermMaturity ? new Date(Math.max(new Date(longTermMaturity).getTime(), rowDate.getTime())) : rowDate;
          }
        }
      });

      if (shortTermBalance > 0) {
        breakdown.shortTerm.balance += shortTermBalance;
        breakdown.shortTerm.contracts.push({
          contractNumber: contract.contract_number,
          balance: shortTermBalance,
          maturity: shortTermMaturity?.toISOString().split('T')[0]
        });
        breakdown.shortTerm.dueDate = breakdown.shortTerm.dueDate 
          ? new Date(Math.max(new Date(breakdown.shortTerm.dueDate).getTime(), shortTermMaturity?.getTime() || 0)).toISOString().split('T')[0]
          : shortTermMaturity?.toISOString().split('T')[0];
      }

      if (longTermBalance > 0) {
        breakdown.longTerm.balance += longTermBalance;
        breakdown.longTerm.contracts.push({
          contractNumber: contract.contract_number,
          balance: longTermBalance,
          maturity: longTermMaturity?.toISOString().split('T')[0]
        });
        breakdown.longTerm.dueDate = breakdown.longTerm.dueDate
          ? new Date(Math.max(new Date(breakdown.longTerm.dueDate).getTime(), longTermMaturity?.getTime() || 0)).toISOString().split('T')[0]
          : longTermMaturity?.toISOString().split('T')[0];
      }

      if (dueSoonBalance > 0) {
        breakdown.dueSoon.balance += dueSoonBalance;
        breakdown.dueSoon.contracts.push({
          contractNumber: contract.contract_number,
          balance: dueSoonBalance
        });
      }

      if (overdueBalance > 0) {
        breakdown.overdue.balance += overdueBalance;
        breakdown.overdue.contracts.push({
          contractNumber: contract.contract_number,
          balance: overdueBalance
        });
      }
    } catch (error) {
      console.warn(`Erro ao processar contrato ${contract.contract_number}:`, error);
    }
  });

  return {
    ...breakdown,
    shortTerm: {
      ...breakdown.shortTerm,
      balance: Math.round(breakdown.shortTerm.balance * 100) / 100
    },
    longTerm: {
      ...breakdown.longTerm,
      balance: Math.round(breakdown.longTerm.balance * 100) / 100
    },
    dueSoon: {
      ...breakdown.dueSoon,
      balance: Math.round(breakdown.dueSoon.balance * 100) / 100
    },
    overdue: {
      ...breakdown.overdue,
      balance: Math.round(breakdown.overdue.balance * 100) / 100
    }
  };
}

/**
 * 2️⃣b CIRCULANTE / NÃO CIRCULANTE POR CONTRATO
 * Mesma classificação de getDebtMaturityBreakdown (saldo de principal a
 * vencer em até 12 meses = circulante; acima disso = não circulante), mas
 * calculada para UM contrato por vez e indexada por contract.id — usada na
 * tabela de Contratos, onde cada linha precisa do próprio saldo, sem
 * depender de agrupar por número de contrato (que não é garantidamente
 * único entre bancos/entidades diferentes).
 *
 * Parcelas já vencidas (dataVencimento no passado em relação a baseDate)
 * entram no circulante — são, por definição, uma obrigação corrente.
 */
export function getContractCirculanteSplit(contract, baseDate) {
  const result = { shortTerm: 0, longTerm: 0 };
  if (!contract?.schedule_data) return result;

  let schedule;
  try {
    schedule = JSON.parse(contract.schedule_data).schedule || [];
  } catch {
    return result;
  }

  const baseDateObj = new Date(baseDate + "T00:00:00");
  schedule.forEach((row) => {
    if (!(row.amortizacao > 0)) return;
    const rowDate = new Date(row.dataVencimento + "T00:00:00");
    const daysToMaturity = Math.ceil((rowDate - baseDateObj) / (1000 * 60 * 60 * 24));
    if (daysToMaturity < 0) {
      result.shortTerm += row.amortizacao; // Vencido — obrigação corrente.
      return;
    }
    const monthsToMaturity = Math.floor(daysToMaturity / 30.44);
    if (monthsToMaturity <= 12) result.shortTerm += row.amortizacao;
    else result.longTerm += row.amortizacao;
  });

  return {
    shortTerm: Math.round(result.shortTerm * 100) / 100,
    longTerm: Math.round(result.longTerm * 100) / 100,
  };
}

/**
 * 3️⃣ INTEREST BY MONTH
 * Juros apropriados por mês
 */
export function getInterestByMonth(contracts, year, month) {
  const targetMonth = parseInt(month);
  const targetYear = parseInt(year);

  const monthData = {
    year,
    month,
    fixedInterest: 0,
    variableInterest: 0,
    totalInterest: 0,
    byContract: []
  };

  contracts.forEach((contract) => {
    if (!contract.schedule_data) return;

    try {
      const scheduleData = JSON.parse(contract.schedule_data);
      const schedule = scheduleData.schedule || [];

      let contractInterest = 0;
      let contractFixed = 0;
      let contractVariable = 0;
      let contractDetails = [];

      schedule.forEach((row) => {
        const rowDate = new Date(row.dataVencimento);
        if (rowDate.getMonth() + 1 === targetMonth && rowDate.getFullYear() === targetYear) {
          const fixed = row.jurosFixosMes || 0;
          const variable = row.jurosVariaveisMes || 0;
          const total = fixed + variable;

          contractInterest += total;
          contractFixed += fixed;
          contractVariable += variable;

          contractDetails.push({
            parcela: row.parcela,
            dataVencimento: row.dataVencimento,
            jurosFixo: fixed,
            jurosVariavel: variable,
            jurosTotal: total
          });
        }
      });

      if (contractInterest > 0) {
        monthData.fixedInterest += contractFixed;
        monthData.variableInterest += contractVariable;
        monthData.totalInterest += contractInterest;

        monthData.byContract.push({
          contractNumber: contract.contract_number,
          fixedInterest: contractFixed,
          variableInterest: contractVariable,
          totalInterest: contractInterest,
          details: contractDetails
        });
      }
    } catch (error) {
      console.warn(`Erro ao processar contrato ${contract.contract_number}:`, error);
    }
  });

  return {
    ...monthData,
    fixedInterest: Math.round(monthData.fixedInterest * 100) / 100,
    variableInterest: Math.round(monthData.variableInterest * 100) / 100,
    totalInterest: Math.round(monthData.totalInterest * 100) / 100
  };
}

/**
 * Juros por período
 */
export function getInterestByPeriod(contracts, dateFrom, dateTo) {
  const fromDate = new Date(dateFrom + "T00:00:00");
  const toDate = new Date(dateTo + "T23:59:59");

  const periodData = {
    dateFrom,
    dateTo,
    fixedInterest: 0,
    variableInterest: 0,
    totalInterest: 0,
    byMonth: {}
  };

  contracts.forEach((contract) => {
    if (!contract.schedule_data) return;

    try {
      const scheduleData = JSON.parse(contract.schedule_data);
      const schedule = scheduleData.schedule || [];

      schedule.forEach((row) => {
        const rowDate = new Date(row.dataVencimento + "T00:00:00");

        if (rowDate >= fromDate && rowDate <= toDate) {
          const fixed = row.jurosFixosMes || 0;
          const variable = row.jurosVariaveisMes || 0;

          periodData.fixedInterest += fixed;
          periodData.variableInterest += variable;
          periodData.totalInterest += fixed + variable;

          // Agrupar por mês
          const monthKey = rowDate.toISOString().slice(0, 7); // YYYY-MM
          if (!periodData.byMonth[monthKey]) {
            periodData.byMonth[monthKey] = { fixed: 0, variable: 0, total: 0 };
          }
          periodData.byMonth[monthKey].fixed += fixed;
          periodData.byMonth[monthKey].variable += variable;
          periodData.byMonth[monthKey].total += fixed + variable;
        }
      });
    } catch (error) {
      console.warn(`Erro ao processar contrato ${contract.contract_number}:`, error);
    }
  });

  return {
    ...periodData,
    fixedInterest: Math.round(periodData.fixedInterest * 100) / 100,
    variableInterest: Math.round(periodData.variableInterest * 100) / 100,
    totalInterest: Math.round(periodData.totalInterest * 100) / 100
  };
}

/**
 * 4️⃣ FX VARIATION BY PERIOD
 * Variação cambial consolidada
 */
export function getFXVariationByPeriod(contracts, dateFrom, dateTo) {
  const fromDate = new Date(dateFrom + "T00:00:00");
  const toDate = new Date(dateTo + "T23:59:59");

  const fxData = {
    dateFrom,
    dateTo,
    totalVariation: 0,
    byContract: [],
    byMonth: {}
  };

  contracts.forEach((contract) => {
    if (!contract.schedule_data || !contract.currency_id) return;

    try {
      const scheduleData = JSON.parse(contract.schedule_data);
      const schedule = scheduleData.schedule || [];

      let contractVariation = 0;

      schedule.forEach((row) => {
        const rowDate = new Date(row.dataVencimento + "T00:00:00");

        if (rowDate >= fromDate && rowDate <= toDate) {
          const variation = row.varCambial || 0;
          contractVariation += variation;
          fxData.totalVariation += variation;

          // Agrupar por mês
          const monthKey = rowDate.toISOString().slice(0, 7);
          if (!fxData.byMonth[monthKey]) {
            fxData.byMonth[monthKey] = 0;
          }
          fxData.byMonth[monthKey] += variation;
        }
      });

      if (contractVariation !== 0) {
        fxData.byContract.push({
          contractNumber: contract.contract_number,
          currency: contract.currency_id,
          variation: contractVariation
        });
      }
    } catch (error) {
      console.warn(`Erro ao processar contrato ${contract.contract_number}:`, error);
    }
  });

  return {
    ...fxData,
    totalVariation: Math.round(fxData.totalVariation * 100) / 100
  };
}

/**
 * 5️⃣ ANNUAL DEBT MAP
 * Visão histórica ano a ano
 */
export function getDebtAnnualMap(contracts) {
  const annualMap = {};

  contracts.forEach((contract) => {
    if (!contract.schedule_data) return;

    try {
      const scheduleData = JSON.parse(contract.schedule_data);
      const schedule = scheduleData.schedule || [];

      let previousBalance = (scheduleData.principal || 0);
      let captionAmount = 0;

      schedule.forEach((row) => {
        const rowDate = new Date(row.dataVencimento);
        const year = rowDate.getFullYear();

        if (!annualMap[year]) {
          annualMap[year] = {
            initialBalance: 0,
            captures: 0,
            amortizations: 0,
            finalBalance: 0,
            contracts: []
          };
        }

        if (!annualMap[year].contracts.includes(contract.contract_number)) {
          annualMap[year].contracts.push(contract.contract_number);
        }

        annualMap[year].amortizations += row.amortizacao || 0;
        annualMap[year].finalBalance = row.sdFinal || 0;
      });

      // Atribuir saldo inicial
      const firstRow = schedule[0];
      if (firstRow) {
        const firstYear = new Date(firstRow.dataVencimento).getFullYear();
        annualMap[firstYear].initialBalance += previousBalance;
      }
    } catch (error) {
      console.warn(`Erro ao processar contrato ${contract.contract_number}:`, error);
    }
  });

  // Ordenar por ano
  const sorted = Object.keys(annualMap)
    .sort()
    .reduce((acc, year) => {
      acc[year] = annualMap[year];
      return acc;
    }, {});

  return sorted;
}

/**
 * 6️⃣ DEBT BY STRUCTURE
 * Quebra por operation_type e operation_category
 */
export function getDebtByStructure(contracts, targetDate) {
  const structure = {
    date: targetDate,
    byOperationType: {},
    byOperationCategory: {},
    byOperationTypeAndCategory: {}
  };

  const targetDateObj = new Date(targetDate + "T23:59:59");

  contracts.forEach((contract) => {
    if (!contract.schedule_data) return;

    try {
      const scheduleData = JSON.parse(contract.schedule_data);
      const schedule = scheduleData.schedule || [];

      let lastRow = null;
      for (let i = 0; i < schedule.length; i++) {
        const row = schedule[i];
        const rowDate = new Date(row.dataVencimento + "T00:00:00");
        if (rowDate <= targetDateObj) {
          lastRow = row;
        } else {
          break;
        }
      }

      if (!lastRow) return;

      const balance = lastRow.sdFinal || 0;
      const opType = contract.operation_type || "UNKNOWN";
      const opCategory = contract.operation_category || "UNKNOWN";
      const key = `${opCategory}_${opType}`;

      // Por tipo
      if (!structure.byOperationType[opType]) {
        structure.byOperationType[opType] = { balance: 0, count: 0, contracts: [] };
      }
      structure.byOperationType[opType].balance += balance;
      structure.byOperationType[opType].count += 1;
      structure.byOperationType[opType].contracts.push(contract.contract_number);

      // Por categoria
      if (!structure.byOperationCategory[opCategory]) {
        structure.byOperationCategory[opCategory] = { balance: 0, count: 0, contracts: [] };
      }
      structure.byOperationCategory[opCategory].balance += balance;
      structure.byOperationCategory[opCategory].count += 1;
      structure.byOperationCategory[opCategory].contracts.push(contract.contract_number);

      // Por tipo + categoria
      if (!structure.byOperationTypeAndCategory[key]) {
        structure.byOperationTypeAndCategory[key] = { balance: 0, count: 0 };
      }
      structure.byOperationTypeAndCategory[key].balance += balance;
      structure.byOperationTypeAndCategory[key].count += 1;
    } catch (error) {
      console.warn(`Erro ao processar contrato ${contract.contract_number}:`, error);
    }
  });

  return structure;
}

/**
 * 7️⃣ DEBT MATURITY CURVE
 * Cronograma de vencimentos (amortizações)
 */
export function getDebtMaturityCurve(contracts) {
  const curve = {};

  contracts.forEach((contract) => {
    if (!contract.schedule_data) return;

    try {
      const scheduleData = JSON.parse(contract.schedule_data);
      const schedule = scheduleData.schedule || [];

      schedule.forEach((row) => {
        if ((row.amortizacao || 0) > 0) {
          const monthKey = row.dataVencimento.slice(0, 7); // YYYY-MM

          if (!curve[monthKey]) {
            curve[monthKey] = {
              date: monthKey,
              principalDue: 0,
              interestDue: 0,
              totalPayment: 0,
              contracts: []
            };
          }

          curve[monthKey].principalDue += row.amortizacao || 0;
          curve[monthKey].interestDue += (row.jurosFixosMes || 0) + (row.jurosVariaveisMes || 0);
          curve[monthKey].totalPayment += row.prestacao || 0;

          if (!curve[monthKey].contracts.includes(contract.contract_number)) {
            curve[monthKey].contracts.push(contract.contract_number);
          }
        }
      });
    } catch (error) {
      console.warn(`Erro ao processar contrato ${contract.contract_number}:`, error);
    }
  });

  // Ordenar por data
  const sorted = Object.keys(curve)
    .sort()
    .slice(0, 36) // Próximos 3 anos
    .reduce((acc, monthKey) => {
      acc[monthKey] = {
        ...curve[monthKey],
        principalDue: Math.round(curve[monthKey].principalDue * 100) / 100,
        interestDue: Math.round(curve[monthKey].interestDue * 100) / 100,
        totalPayment: Math.round(curve[monthKey].totalPayment * 100) / 100
      };
      return acc;
    }, {});

  return sorted;
}

/**
 * 8️⃣ DEBT KPIs
 * Métricas estratégicas
 */
export function getDebtKPIs(contracts, targetDate) {
  const position = getDebtPositionByDate(contracts, targetDate);
  const maturity = getDebtMaturityBreakdown(contracts, targetDate);
  const curve = getDebtMaturityCurve(contracts);

  // Calcular prazo médio ponderado
  let totalWeightedMonths = 0;
  let totalPrincipal = 0;

  Object.values(curve).forEach((month) => {
    const [year, monthNum] = month.date.split('-');
    const monthDate = new Date(year, monthNum - 1);
    const targetDateObj = new Date(targetDate);
    const monthsToMaturity = Math.ceil((monthDate - targetDateObj) / (1000 * 60 * 60 * 24 * 30.44));
    
    totalWeightedMonths += month.principalDue * Math.max(0, monthsToMaturity);
    totalPrincipal += month.principalDue;
  });

  const averageMaturityMonths = totalPrincipal > 0 ? Math.round((totalWeightedMonths / totalPrincipal) * 10) / 10 : 0;

  // Custo médio anual
  const totalInterestAnnual = Object.values(curve)
    .reduce((sum, month) => sum + month.interestDue, 0) * 12;
  const averageCost = position.totalBalance > 0 ? ((totalInterestAnnual / position.totalBalance) * 100) : 0;

  // % em moeda estrangeira
  const fxBalance = Object.values(position.byCurrency)
    .filter(c => c !== 'BRL')
    .reduce((sum, c) => sum + c.balance, 0);
  const fxPercentage = position.totalBalance > 0 ? ((fxBalance / position.totalBalance) * 100) : 0;

  return {
    date: targetDate,
    totalDebt: position.totalBalance,
    shortTermDebt: maturity.shortTerm.balance,
    longTermDebt: maturity.longTerm.balance,
    shortTermPercentage: position.totalBalance > 0 ? ((maturity.shortTerm.balance / position.totalBalance) * 100).toFixed(2) : 0,
    longTermPercentage: position.totalBalance > 0 ? ((maturity.longTerm.balance / position.totalBalance) * 100).toFixed(2) : 0,
    overdueDays: maturity.overdue.balance > 0 ? 'CRÍTICO' : 'OK',
    dueSoonDays: maturity.dueSoon.balance,
    averageMaturityMonths: averageMaturityMonths,
    averageCostAnnual: Math.round(averageCost * 100) / 100,
    foreignCurrencyPercentage: Math.round(fxPercentage * 100) / 100,
    numberOfContracts: contracts.filter(c => c.schedule_data).length,
    averageContractSize: position.totalBalance / contracts.filter(c => c.schedule_data).length
  };
}

/**
 * 9️⃣ EXERCÍCIO RANGE
 * Calcula a data de início do "exercício" corrente, dado um mês de início
 * configurável (1-12, sem rótulos de safra — puramente numérico/genérico).
 * Isso permite tanto ano civil (startMonth=1) quanto ano-safra (ex.: cana
 * abril-março → startMonth=4, soja agosto-julho → startMonth=8), sem
 * hardcodar nenhum nome de cultura.
 *
 * Regra: pega a ocorrência mais recente de "dia 1 do mês de início" que
 * seja <= data-base. Se o mês da data-base for anterior ao mês de início,
 * o exercício começou no ano civil anterior (efeito de virada de ano).
 *
 * @param {string} baseDate - Data-base (YYYY-MM-DD)
 * @param {number} startMonth - Mês de início do exercício (1-12)
 * @returns {string} Data de início do exercício (YYYY-MM-DD)
 */
export function getExercicioStart(baseDate, startMonth) {
  const baseDateObj = new Date(baseDate + "T00:00:00");
  const baseYear = baseDateObj.getFullYear();
  const baseMonth = baseDateObj.getMonth() + 1; // 1-12
  const normalizedStartMonth = Math.min(12, Math.max(1, parseInt(startMonth) || 1));

  const exercicioYear = baseMonth < normalizedStartMonth ? baseYear - 1 : baseYear;

  return `${exercicioYear}-${String(normalizedStartMonth).padStart(2, "0")}-01`;
}

/**
 * 🔟 PAYMENT FLOW BY BANK / MODALITY / GUARANTEE
 * Fluxo de pagamentos FUTUROS (estritamente após a data-base), agrupado por
 * Banco + Modalidade (operation_type) + Garantia (rótulo combinado Real +
 * Pessoal), com colunas por ano civil — os próximos `yearSpan` anos a partir
 * do ano da data-base, mais uma coluna "catch-all" para tudo além disso.
 *
 * Cada linha traz os totais de Principal e de Juros separadamente por ano,
 * para permitir alternar a visão entre "Só Principal" e "Principal + Juros"
 * sem precisar reprocessar os contratos.
 *
 * @param {Array} contracts - Contratos (já filtrados para status aprovado)
 * @param {string} baseDate - Data-base (YYYY-MM-DD)
 * @param {number} yearSpan - Quantidade de colunas de ano explícitas (padrão 5)
 * @returns {{ years: number[], catchAllLabel: string, rows: Array }}
 */
export function getPaymentFlowByBankModalityGuarantee(contracts, baseDate, yearSpan = 5) {
  const baseDateObj = new Date(baseDate + "T00:00:00");
  const baseYear = baseDateObj.getFullYear();
  const years = Array.from({ length: yearSpan }, (_, i) => baseYear + i);
  const lastExplicitYear = years[years.length - 1];
  const catchAllLabel = `Após ${lastExplicitYear}`;

  const rowsMap = new Map();

  contracts.forEach((contract) => {
    if (!contract.schedule_data) return;

    let schedule;
    try {
      const parsed = JSON.parse(contract.schedule_data);
      schedule = parsed.schedule || [];
    } catch (error) {
      console.warn(`Erro ao processar contrato ${contract.contract_number}:`, error);
      return;
    }

    const guaranteeLabel = combineGuaranteeLabel(contract.guarantee_real_type, contract.guarantee_personal_type);
    const key = `${contract.bank_id || "sem_banco"}|${contract.operation_type || "sem_tipo"}|${guaranteeLabel}`;

    if (!rowsMap.has(key)) {
      rowsMap.set(key, {
        bankId: contract.bank_id || null,
        operationType: contract.operation_type || null,
        operationCategory: contract.operation_category || null,
        guarantee: guaranteeLabel,
        byYear: {}, // year -> { principal, interest }
        catchAll: { principal: 0, interest: 0 },
      });
    }
    const rowEntry = rowsMap.get(key);

    schedule.forEach((row) => {
      const rowDate = new Date(row.dataVencimento + "T00:00:00");
      if (rowDate <= baseDateObj) return; // só fluxo FUTURO, estritamente após a data-base

      const principal = row.amortizacao || 0;
      const interest = (row.jurosFixosMes || 0) + (row.jurosVariaveisMes || 0);
      if (principal === 0 && interest === 0) return;

      const rowYear = rowDate.getFullYear();
      if (rowYear <= lastExplicitYear) {
        if (!rowEntry.byYear[rowYear]) rowEntry.byYear[rowYear] = { principal: 0, interest: 0 };
        rowEntry.byYear[rowYear].principal += principal;
        rowEntry.byYear[rowYear].interest += interest;
      } else {
        rowEntry.catchAll.principal += principal;
        rowEntry.catchAll.interest += interest;
      }
    });
  });

  const rows = Array.from(rowsMap.values())
    .map((r) => ({
      ...r,
      byYear: Object.fromEntries(
        Object.entries(r.byYear).map(([year, v]) => [
          year,
          { principal: Math.round(v.principal * 100) / 100, interest: Math.round(v.interest * 100) / 100 },
        ])
      ),
      catchAll: {
        principal: Math.round(r.catchAll.principal * 100) / 100,
        interest: Math.round(r.catchAll.interest * 100) / 100,
      },
    }))
    .filter((r) => {
      const hasYearData = Object.values(r.byYear).some((v) => v.principal > 0 || v.interest > 0);
      const hasCatchAll = r.catchAll.principal > 0 || r.catchAll.interest > 0;
      return hasYearData || hasCatchAll;
    });

  return { years, catchAllLabel, rows };
}

/**
 * 1️⃣1️⃣ MONTHLY ROLL-FORWARD (Movimentação Contábil do Mês)
 * Concilia o saldo contábil do início ao fim de um mês de competência,
 * quebrado em 3 componentes que sempre somam ao saldo total: Principal,
 * Juros e Variação Cambial.
 *
 * Modelo (consistente com o motor de cálculo — CalculationEngine.js):
 * - Cada parcela do cronograma acrescenta juros do período (jurosFixosMes +
 *   jurosVariaveisMes) ao "ledger de juros" e SUBTRAI o que foi efetivamente
 *   pago em caixa (jurosPagos). O que não foi pago fica capitalizado no
 *   saldo — exatamente como o motor faz ao somar `jurosCapitalizados` ao
 *   saldo devedor.
 * - Amortização (principal pago) reduz o "ledger de principal"; o desembolso
 *   inicial (sdInicial da primeira parcela) entra nesse ledger como nova
 *   captação, contabilizada como "Apropriação de Principal" apenas se cair
 *   dentro do mês analisado (senão já fazia parte do saldo de abertura).
 * - Variação cambial (`varCambial`) acumula no "ledger de câmbio" — é uma
 *   reavaliação contábil (regime de competência), sem uma baixa em caixa
 *   separada nesta estrutura de dados.
 * Por construção, abertura + apropriações − pagamentos = fechamento, em
 * cada uma das 3 colunas e no total.
 *
 * @param {Array} contracts - Contratos (já filtrados para status aprovado)
 * @param {number|string} year - Ano do mês de competência
 * @param {number|string} month - Mês de competência (1-12)
 */
export function getMonthlyRollForward(contracts, year, month) {
  const yearNum = parseInt(year);
  const monthNum = parseInt(month);

  const monthStart = new Date(yearNum, monthNum - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
  const prevMonthEnd = new Date(yearNum, monthNum - 1, 0, 23, 59, 59, 999);

  const totals = {
    openingPrincipal: 0, openingInterest: 0, openingFx: 0,
    newPrincipal: 0, interestAccrued: 0, fxAccrued: 0,
    principalPaid: 0, interestPaid: 0,
    closingPrincipal: 0, closingInterest: 0, closingFx: 0,
  };

  contracts.forEach((contract) => {
    if (!contract.schedule_data) return;

    let schedule;
    try {
      const parsed = JSON.parse(contract.schedule_data);
      schedule = parsed.schedule || [];
    } catch (error) {
      console.warn(`Erro ao processar contrato ${contract.contract_number}:`, error);
      return;
    }
    if (schedule.length === 0) return;

    let principalLedger = 0;
    let jurosLedger = 0;
    let fxLedger = 0;
    let openingSnapshot = null;
    let closingSnapshot = null;

    schedule.forEach((row, idx) => {
      const rowDate = new Date(row.dataVencimento + "T12:00:00");

      // Saldo de abertura: capturado ANTES de aplicar a movimentação desta
      // linha, na primeira parcela cuja data é posterior ao fim do mês
      // anterior (ou seja, o ledger acumulado só com o que já existia).
      if (!openingSnapshot && rowDate > prevMonthEnd) {
        openingSnapshot = { principal: principalLedger, interest: jurosLedger, fx: fxLedger };
      }

      const isWithinMonth = rowDate >= monthStart && rowDate <= monthEnd;
      const newPrincipalRow = idx === 0 ? (row.sdInicial || 0) : 0;
      const interestAccruedRow = (row.jurosFixosMes || 0) + (row.jurosVariaveisMes || 0);
      const interestPaidRow = row.jurosPagos || 0;
      const fxAccruedRow = row.varCambial || 0;
      const principalPaidRow = row.amortizacao || 0;

      if (isWithinMonth) {
        totals.newPrincipal += newPrincipalRow;
        totals.interestAccrued += interestAccruedRow;
        totals.interestPaid += interestPaidRow;
        totals.fxAccrued += fxAccruedRow;
        totals.principalPaid += principalPaidRow;
      }

      // Aplica a movimentação desta linha ao ledger corrente (sempre, para
      // manter o saldo acumulado correto para as parcelas seguintes).
      principalLedger += newPrincipalRow - principalPaidRow;
      jurosLedger += interestAccruedRow - interestPaidRow;
      fxLedger += fxAccruedRow;

      if (rowDate <= monthEnd) {
        closingSnapshot = { principal: principalLedger, interest: jurosLedger, fx: fxLedger };
      }
    });

    // Contrato já quitado antes do mês analisado: abertura = fechamento
    // (o único snapshot capturado foi o de fechamento, no laço acima).
    if (!openingSnapshot) openingSnapshot = closingSnapshot || { principal: 0, interest: 0, fx: 0 };
    // Contrato ainda não iniciado até o fim do mês analisado: fechamento = abertura.
    if (!closingSnapshot) closingSnapshot = openingSnapshot;

    totals.openingPrincipal += openingSnapshot.principal;
    totals.openingInterest += openingSnapshot.interest;
    totals.openingFx += openingSnapshot.fx;
    totals.closingPrincipal += closingSnapshot.principal;
    totals.closingInterest += closingSnapshot.interest;
    totals.closingFx += closingSnapshot.fx;
  });

  const r2 = (v) => Math.round(v * 100) / 100;

  const opening = {
    principal: r2(totals.openingPrincipal),
    interest: r2(totals.openingInterest),
    fx: r2(totals.openingFx),
  };
  opening.total = r2(opening.principal + opening.interest + opening.fx);

  const accruals = {
    principal: r2(totals.newPrincipal),
    interest: r2(totals.interestAccrued),
    fx: r2(totals.fxAccrued),
  };
  accruals.total = r2(accruals.principal + accruals.interest + accruals.fx);

  const payments = {
    principal: r2(totals.principalPaid),
    interest: r2(totals.interestPaid),
    fx: 0,
  };
  payments.total = r2(payments.principal + payments.interest + payments.fx);

  const closing = {
    principal: r2(totals.closingPrincipal),
    interest: r2(totals.closingInterest),
    fx: r2(totals.closingFx),
  };
  closing.total = r2(closing.principal + closing.interest + closing.fx);

  return { year: yearNum, month: monthNum, opening, accruals, payments, closing };
}