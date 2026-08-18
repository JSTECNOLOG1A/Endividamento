import { roundMoney } from "@engine/roundMoney.js";

// Recalcula o CET Anual e a Taxa Nominal de um contrato JÁ SALVO, usando
// somente dados já persistidos (o próprio contrato + o cronograma salvo em
// schedule_data) — sem precisar rodar o motor de cálculo completo (que
// exigiria taxas CDI/feriados atualizados, e poderia divergir do que foi
// originalmente apresentado no momento do cálculo/aprovação).
//
// A fórmula abaixo é uma cópia fiel de calculateCET() em
// backend/src/engine/CalculationEngine.js (a mesma usada para o CET Anual
// exibido durante o cálculo/edição do contrato — o campo `cetAnnual` do
// disclosure regulatório). Qualquer alteração na fórmula do motor deve ser
// espelhada aqui.
function calculateCET(operationValue, upFrontFees, financedFeesImpactOnCash, schedule, insurancePerInstallment = 0) {
  if (!schedule || schedule.length === 0) {
    return { cetAnnual: 0, cetMonthly: 0 };
  }

  const netValue = operationValue - upFrontFees - financedFeesImpactOnCash;
  const cashFlow = [netValue];
  schedule.forEach((item) => {
    const prestacao = item.prestacao || 0;
    cashFlow.push(-(prestacao + insurancePerInstallment));
  });

  const getNPV = (rate) => cashFlow.reduce((acc, val, i) => acc + val / Math.pow(1 + rate, i), 0);

  let rate = 0.01; // Chute inicial: 1% ao mês
  for (let i = 0; i < 50; i++) {
    const npv = getNPV(rate);
    const df = cashFlow.reduce((acc, val, idx) => acc - (idx * val) / Math.pow(1 + rate, idx + 1), 0);
    if (Math.abs(df) < 1e-10) break;
    const newRate = rate - npv / df;
    if (Math.abs(newRate - rate) < 0.000001) {
      rate = newRate;
      break;
    }
    rate = newRate < -0.5 || newRate > 10 ? Math.max(-0.1, Math.min(1, newRate)) : newRate;
  }

  const cetAnnual = (Math.pow(1 + rate, 12) - 1) * 100;
  return {
    cetAnnual: roundMoney(cetAnnual, 2),
    cetMonthly: roundMoney(rate * 100, 6),
  };
}

export function computeContractCET(contract, schedule) {
  if (!contract) return { cet: 0, fixedRateNominal: 0 };
  if (!schedule || schedule.length === 0) {
    return { cet: 0, fixedRateNominal: contract.fixed_rate || 0 };
  }

  const iofValue = contract.iof_value || 0;
  const encargoGarantiaValue = contract.encargo_garantia_value || 0;
  const otherFees = contract.other_fees || 0;

  // Mesma apropriação de encargos do motor: taxas/IOF não financiados saem
  // de caixa no momento zero; os financiados entram no saldo devedor, mas
  // também impactam o caixa no momento zero para fins de CET.
  const upFrontFees =
    (contract.iof_financed ? 0 : iofValue) +
    (contract.encargo_garantia_financed ? 0 : encargoGarantiaValue) +
    (contract.other_fees_financed ? 0 : otherFees);

  const financedFeesImpactOnCash =
    (contract.iof_financed ? iofValue : 0) +
    (contract.encargo_garantia_financed ? encargoGarantiaValue : 0) +
    (contract.other_fees_financed ? otherFees : 0);

  const totalInsurance = (contract.mip_value || 0) + (contract.dfi_value || 0) + (contract.other_insurance_value || 0);
  const insuranceEmbeddedPerInstallment =
    totalInsurance > 0
      ? roundMoney(
          ((contract.mip_embedded ? contract.mip_value || 0 : 0) +
            (contract.dfi_embedded ? contract.dfi_value || 0 : 0) +
            (contract.other_insurance_embedded ? contract.other_insurance_value || 0 : 0)) /
            schedule.length,
          2
        )
      : 0;

  const { cetAnnual } = calculateCET(
    contract.operation_value || 0,
    upFrontFees,
    financedFeesImpactOnCash,
    schedule,
    insuranceEmbeddedPerInstallment
  );

  return {
    cet: cetAnnual,
    fixedRateNominal: contract.fixed_rate || 0,
  };
}
