/**
 * 🔐 VALIDAÇÕES DE RISCO JURÍDICO
 * Proteção contra operações inválidas ou inconsistentes
 */
export function validateLegalCompliance(params) {
  const {
    fixedRate,
    principalInstallments,
    operationDate,
    finalMaturityDate,
    operationValue
  } = params;
  
  // ❌ PROIBIDO: Taxa negativa
  if (fixedRate < 0) {
    throw new Error(
      `[ERRO_LEGAL_001] Taxa de juros negativa não permitida (${fixedRate}% a.a.). ` +
      `Verifique a configuração do contrato.`
    );
  }
  
  // ❌ PROIBIDO: Prazo zero
  if (!principalInstallments || principalInstallments <= 0) {
    throw new Error(
      `[ERRO_LEGAL_002] Prazo inválido (${principalInstallments} parcelas). ` +
      `O contrato deve ter no mínimo 1 parcela.`
    );
  }
  
  // ❌ PROIBIDO: Valor da operação zero ou negativo
  if (!operationValue || operationValue <= 0) {
    throw new Error(
      `[ERRO_LEGAL_003] Valor da operação inválido (${operationValue}). ` +
      `O contrato deve ter valor positivo.`
    );
  }
  
  // ❌ PROIBIDO: Datas inconsistentes
  if (operationDate && finalMaturityDate) {
    const opDate = new Date(operationDate);
    const matDate = new Date(finalMaturityDate);
    
    if (matDate <= opDate) {
      throw new Error(
        `[ERRO_LEGAL_004] Data de vencimento (${finalMaturityDate}) deve ser posterior à data da operação (${operationDate}).`
      );
    }
  }
  
  return true;
}

/**
 * Validação Central: Garantir que as regras imutáveis sejam aplicadas
 */
export function validateCalculationContext(params) {
  const { calculationSystem, finalMaturityDate } = params;
  
  // REGRA 3: AMERICANO/BULLET exigem finalMaturityDate
  if ((calculationSystem === "AMERICANO" || calculationSystem === "BULLET") && !finalMaturityDate) {
    throw new Error(
      `Sistema ${calculationSystem} EXIGE finalMaturityDate (data de vencimento final). ` +
      `Contexto: o Engine não pode calcular em modo progressivo para AMERICANO/BULLET.`
    );
  }
  
  return true;
}