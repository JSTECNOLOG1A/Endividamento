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
 */

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