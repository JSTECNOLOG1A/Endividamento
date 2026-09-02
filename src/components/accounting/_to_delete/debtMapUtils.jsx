/**
 * Utilitários para cálculo de Taxa Média Ponderada e estrutura hierárquica
 * da árvore de endividamento
 */

/**
 * Calcula taxa média ponderada para um conjunto de dívidas
 * @param {Array} debts - Array com {balance, fixedRate, indexer, indexerSpread}
 * @returns {number} Taxa anual média ponderada
 */
export function calculateWeightedAverageRate(debts) {
  if (!debts || debts.length === 0) return 0;

  const totalBalance = debts.reduce((sum, d) => sum + (d.balance || 0), 0);
  if (totalBalance === 0) return 0;

  const weightedSum = debts.reduce((sum, d) => {
    const rate = d.fixedRate || 0;
    return sum + (rate * (d.balance || 0));
  }, 0);

  return weightedSum / totalBalance;
}

/**
 * Classifica dívida como Circulante ou Não Circulante
 * @param {string} dueDateStr - Data de vencimento (YYYY-MM-DD)
 * @param {string} baseDateStr - Data-base do relatório (YYYY-MM-DD)
 * @returns {string} "Circulante" ou "Não Circulante"
 */
export function classifyMaturity(dueDateStr, baseDateStr) {
  if (!dueDateStr || !baseDateStr) return "Circulante";

  const dueDate = new Date(dueDateStr);
  const baseDate = new Date(baseDateStr);
  
  // Diferença em dias
  const daysDiff = Math.floor((dueDate - baseDate) / (1000 * 60 * 60 * 24));
  
  // Circulante: até 365 dias (1 ano) a partir da data-base
  return daysDiff <= 365 ? "Circulante" : "Não Circulante";
}

/**
 * Extrai schedule_data do contrato (se armazenado como JSON string)
 */
function parseScheduleData(contract) {
  if (!contract.schedule_data) {
    console.log(`Contrato ${contract.id} sem schedule_data`);
    return [];
  }
  
  if (typeof contract.schedule_data === 'string') {
    try {
      const parsed = JSON.parse(contract.schedule_data);
      // Se for objeto com propriedade "schedule", retorna o array
      if (parsed && parsed.schedule && Array.isArray(parsed.schedule)) {
        return parsed.schedule;
      }
      // Se for array direto, retorna
      if (Array.isArray(parsed)) {
        return parsed;
      }
      console.log(`Contrato ${contract.id} schedule_data formato inválido:`, parsed);
      return [];
    } catch (e) {
      console.log(`Contrato ${contract.id} schedule_data JSON inválido:`, e.message);
      return [];
    }
  }
  
  // Se for array direto
  if (Array.isArray(contract.schedule_data)) {
    return contract.schedule_data;
  }
  
  // Se for objeto com propriedade "schedule"
  if (contract.schedule_data && Array.isArray(contract.schedule_data.schedule)) {
    return contract.schedule_data.schedule;
  }
  
  console.log(`Contrato ${contract.id} schedule_data tipo inválido:`, typeof contract.schedule_data);
  return [];
}

/**
 * Calcula saldo devedor em uma data específica
 * @param {Array} schedule - Array de parcelas
 * @param {string} targetDate - Data alvo (YYYY-MM-DD)
 * @returns {number} Saldo devedor na data
 */
export function getBalanceAtDate(schedule, targetDate) {
  // Parse se for string (contrato com schedule_data em JSON)
  const scheduleArray = typeof schedule === 'string' ? (() => {
    try {
      return JSON.parse(schedule);
    } catch {
      return [];
    }
  })() : (Array.isArray(schedule) ? schedule : []);
  
  if (!scheduleArray || scheduleArray.length === 0) return 0;

  let lastBalance = 0;
  for (const row of scheduleArray) {
    if (row.dataVencimento <= targetDate) {
      lastBalance = row.sdFinal || 0;
    } else {
      break;
    }
  }
  
  return Math.max(0, lastBalance);
}

/**
 * Monta estrutura hierárquica da árvore de endividamento
 * Estrutura: {Circulante/Não Circulante} → {Banco} → {Modalidade} → {Contratos}
 * 
 * @param {Array} contracts - Array de contratos
 * @param {string} baseDate - Data-base (YYYY-MM-DD)
 * @returns {Object} Estrutura hierárquica
 */
export function buildDebtHierarchy(contracts, baseDate) {
  const hierarchy = {
    Circulante: {},
    "Não Circulante": {}
  };

  if (!Array.isArray(contracts)) return hierarchy;

  contracts.forEach(contract => {
    if (!contract) {
      console.log("Contrato nulo");
      return;
    }
    if (contract.status === "cancelado") {
      console.log(`Contrato ${contract.id} cancelado`);
      return;
    }

    // Extrair schedule
    const schedule = parseScheduleData(contract);
    if (!Array.isArray(schedule) || schedule.length === 0) {
      console.log(`Contrato ${contract.id} sem schedule_data válido`);
      return;
    }

    // Calcular saldo na data-base
    const balance = getBalanceAtDate(schedule, baseDate);
    console.log(`Contrato ${contract.id}: saldo = ${balance}, baseDate = ${baseDate}`);
    if (balance <= 0) {
      console.log(`Contrato ${contract.id} saldo zero ou negativo`);
      return;
    }

    // Classificar como Circulante ou Não Circulante
    const lastPayment = schedule[schedule.length - 1];
    const maturityClass = classifyMaturity(lastPayment?.dataVencimento, baseDate);

    // Extrair informações
    const bank = contract.bank_id || "Sem Banco";
    const operationType = contract.operation_type || "Sem Tipo";
    const rate = contract.fixed_rate || 0;

    // Inicializar estrutura se necessário
    if (!hierarchy[maturityClass][bank]) {
      hierarchy[maturityClass][bank] = {};
    }
    if (!hierarchy[maturityClass][bank][operationType]) {
      hierarchy[maturityClass][bank][operationType] = {
        contracts: [],
        totalBalance: 0,
        totalRate: 0 // Para cálculo de taxa média ponderada
      };
    }

    // Adicionar contrato
    hierarchy[maturityClass][bank][operationType].contracts.push({
      id: contract.id,
      contractNumber: contract.contract_number,
      balance: balance,
      fixedRate: rate
    });

    hierarchy[maturityClass][bank][operationType].totalBalance += balance;
    hierarchy[maturityClass][bank][operationType].totalRate += rate * balance; // Numerador para ponderação
  });

  return hierarchy;
}

/**
 * Formata hierarquia para exibição/exportação
 * Retorna array de linhas com nível de indentação para exibição em árvore
 */
export function formatHierarchyForDisplay(hierarchy) {
  const rows = [];
  let rowId = 0;

  Object.entries(hierarchy).forEach(([maturityClass, bankData]) => {
    // Cabeçalho de classificação (Circulante/Não Circulante)
    const maturityTotal = Object.entries(bankData).reduce((sum, [_, bankInfo]) => {
      return sum + Object.entries(bankInfo).reduce((bs, [_, modeData]) => bs + modeData.totalBalance, 0);
    }, 0);

    if (maturityTotal > 0) {
      rows.push({
        id: `maturity-${rowId++}`,
        level: 0,
        type: "maturity",
        label: maturityClass,
        balance: maturityTotal,
        expandable: true,
        expanded: true,
        children: []
      });

      const maturityRowIdx = rows.length - 1;

      // Bancos
      Object.entries(bankData).forEach(([bank, modalities]) => {
        const bankTotal = Object.entries(modalities).reduce((sum, [_, modeData]) => sum + modeData.totalBalance, 0);

        if (bankTotal > 0) {
          const bankRow = {
            id: `bank-${rowId++}`,
            level: 1,
            type: "bank",
            label: bank,
            balance: bankTotal,
            expandable: true,
            expanded: false,
            children: [],
            parentIdx: maturityRowIdx
          };

          const bankRowIdx = rows.length;
          rows.push(bankRow);
          rows[maturityRowIdx].children.push(bankRowIdx);

          // Modalidades
          Object.entries(modalities).forEach(([operationType, modeData]) => {
            const { contracts, totalBalance, totalRate } = modeData;
            const weightedRate = totalBalance > 0 ? totalRate / totalBalance : 0;

            const modeRow = {
              id: `mode-${rowId++}`,
              level: 2,
              type: "modality",
              label: operationType,
              balance: totalBalance,
              rate: weightedRate,
              expandable: contracts.length > 1,
              expanded: false,
              children: [],
              parentIdx: bankRowIdx
            };

            const modeRowIdx = rows.length;
            rows.push(modeRow);
            rows[bankRowIdx].children.push(modeRowIdx);

            // Contratos individuais (se houver mais de um)
            if (contracts.length > 1) {
              contracts.forEach((contract, idx) => {
                const contractRow = {
                  id: `contract-${contract.id}`,
                  level: 3,
                  type: "contract",
                  label: `Contrato ${contract.contractNumber}`,
                  balance: contract.balance,
                  rate: contract.fixedRate,
                  expandable: false,
                  expanded: false,
                  parentIdx: modeRowIdx
                };

                const contractRowIdx = rows.length;
                rows.push(contractRow);
                modeRow.children.push(contractRowIdx);
              });
            }
          });
        }
      });
    }
  });

  return rows;
}

/**
 * Gera dados para exportação em Excel
 * Formata como tabela com indentação visual
 */
export function generateExcelData(rows) {
  const excelRows = [];

  // Cabeçalho
  excelRows.push(["Descrição", "Saldo (R$)", "Taxa Média Ponderada"]);

  // Processar linhas
  rows.forEach(row => {
    if (!row.visible && row.expanded !== undefined) return; // Filtrar linhas colapsadas

    const indent = "  ".repeat(row.level); // Indentação visual
    const typeLabel = row.type === "modality" ? ` (${row.rate.toFixed(2)}% a.a.)` : "";

    excelRows.push([
      indent + row.label + typeLabel,
      row.balance.toFixed(2),
      row.rate ? row.rate.toFixed(4) : ""
    ]);
  });

  return excelRows;
}

/**
 * Monta estrutura hierárquica por PERÍODO (Ano → Mês → Banco → Modalidade → Contratos)
 * @param {Array} contracts - Array de contratos
 * @returns {Object} Estrutura por período
 */
export function buildDebtByMonth(contracts) {
  const hierarchy = {};

  if (!Array.isArray(contracts)) return hierarchy;

  contracts.forEach(contract => {
    if (!contract || contract.status === "cancelado") return;

    // Extrair schedule
    const schedule = parseScheduleData(contract);
    if (!Array.isArray(schedule) || schedule.length === 0) return;

    // Iterar por cada parcela do schedule
    schedule.forEach(row => {
      if (!row.dataVencimento || !row.amortizacao) return;

      const [year, month, day] = row.dataVencimento.split('-');
      const monthName = new Date(`${year}-${month}-01`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      const monthKey = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)}`;

      // Inicializar estrutura
      if (!hierarchy[year]) hierarchy[year] = {};
      if (!hierarchy[year][monthKey]) hierarchy[year][monthKey] = {};
      if (!hierarchy[year][monthKey][contract.bank_id]) {
        hierarchy[year][monthKey][contract.bank_id] = {};
      }
      if (!hierarchy[year][monthKey][contract.bank_id][contract.operation_type]) {
        hierarchy[year][monthKey][contract.bank_id][contract.operation_type] = {
          contracts: [],
          totalBalance: 0,
          totalRate: 0
        };
      }

      // Adicionar dados da parcela
      const balance = row.sdFinal || 0;
      const rate = contract.fixed_rate || 0;

      hierarchy[year][monthKey][contract.bank_id][contract.operation_type].contracts.push({
        id: contract.id,
        contractNumber: contract.contract_number,
        balance: balance,
        fixedRate: rate
      });

      hierarchy[year][monthKey][contract.bank_id][contract.operation_type].totalBalance += balance;
      hierarchy[year][monthKey][contract.bank_id][contract.operation_type].totalRate += rate * balance;
    });
  });

  return hierarchy;
}

/**
 * Formata hierarquia por mês para exibição
 */
export function formatByMonthForDisplay(hierarchy) {
  const rows = [];
  let rowId = 0;

  // Ordenar anos decrescente
  const sortedYears = Object.keys(hierarchy).sort((a, b) => b - a);

  sortedYears.forEach(year => {
    const monthData = hierarchy[year];
    const yearTotal = Object.entries(monthData).reduce((sum, [_, months]) => {
      return sum + Object.entries(months).reduce((bs, [_, banks]) => {
        return bs + Object.entries(banks).reduce((ms, [_, modes]) => ms + modes.totalBalance, 0);
      }, 0);
    }, 0);

    if (yearTotal <= 0) return;

    // Ano
    rows.push({
      id: `year-${rowId++}`,
      level: 0,
      type: "year",
      label: year,
      balance: yearTotal,
      expandable: true,
      expanded: true,
      children: []
    });

    const yearRowIdx = rows.length - 1;

    // Ordenar meses cronologicamente
    const sortedMonths = Object.keys(monthData).sort((a, b) => {
      const dateA = new Date(monthData[a][Object.keys(monthData[a])[0]][Object.keys(monthData[a][Object.keys(monthData[a])[0]])[0]].contracts[0]?.dataVencimento);
      const dateB = new Date(monthData[b][Object.keys(monthData[b])[0]][Object.keys(monthData[b][Object.keys(monthData[b])[0]])[0]].contracts[0]?.dataVencimento);
      return dateA - dateB;
    });

    sortedMonths.forEach(monthKey => {
      const banks = monthData[monthKey];
      const monthTotal = Object.entries(banks).reduce((sum, [_, modes]) => {
        return sum + Object.entries(modes).reduce((ms, [_, modeData]) => ms + modeData.totalBalance, 0);
      }, 0);

      if (monthTotal <= 0) return;

      // Mês
      const monthRow = {
        id: `month-${rowId++}`,
        level: 1,
        type: "month",
        label: monthKey,
        balance: monthTotal,
        expandable: true,
        expanded: false,
        children: [],
        parentIdx: yearRowIdx
      };

      const monthRowIdx = rows.length;
      rows.push(monthRow);
      rows[yearRowIdx].children.push(monthRowIdx);

      // Bancos
      Object.entries(banks).forEach(([bank, modalities]) => {
        const bankTotal = Object.entries(modalities).reduce((sum, [_, modeData]) => sum + modeData.totalBalance, 0);

        if (bankTotal <= 0) return;

        const bankRow = {
          id: `bank-${rowId++}`,
          level: 2,
          type: "bank",
          label: bank || "Sem Banco",
          balance: bankTotal,
          expandable: true,
          expanded: false,
          children: [],
          parentIdx: monthRowIdx
        };

        const bankRowIdx = rows.length;
        rows.push(bankRow);
        rows[monthRowIdx].children.push(bankRowIdx);

        // Modalidades
        Object.entries(modalities).forEach(([operationType, modeData]) => {
          const { contracts, totalBalance, totalRate } = modeData;
          const weightedRate = totalBalance > 0 ? totalRate / totalBalance : 0;

          const modeRow = {
            id: `mode-${rowId++}`,
            level: 3,
            type: "modality",
            label: operationType || "Sem Tipo",
            balance: totalBalance,
            rate: weightedRate,
            expandable: contracts.length > 1,
            expanded: false,
            children: [],
            parentIdx: bankRowIdx
          };

          const modeRowIdx = rows.length;
          rows.push(modeRow);
          rows[bankRowIdx].children.push(modeRowIdx);

          // Contratos
          if (contracts.length > 1) {
            contracts.forEach(contract => {
              const contractRow = {
                id: `contract-${contract.id}`,
                level: 4,
                type: "contract",
                label: `Contrato ${contract.contractNumber}`,
                balance: contract.balance,
                rate: contract.fixedRate,
                expandable: false,
                expanded: false,
                parentIdx: modeRowIdx
              };

              const contractRowIdx = rows.length;
              rows.push(contractRow);
              modeRow.children.push(contractRowIdx);
            });
          }
        });
      });
    });
  });

  return rows;
}