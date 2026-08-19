/**
 * 🏦 MOTOR DE CÁLCULO FINANCEIRO — NÚCLEO ISOLADO
 * 
 * VERSÃO: 1.0.0
 * 
 * REGRAS ARQUITETURAIS (IMUTÁVEIS):
 * ❌ PROIBIDO: Importar qualquer componente de UI
 * ❌ PROIBIDO: Acessar estado externo ou cache global
 * ❌ PROIBIDO: Side effects (localStorage, API calls)
 * ✅ PERMITIDO: Apenas params de entrada
 * ✅ PERMITIDO: Apenas retornar objeto puro
 * 
 * REGRAS MATEMÁTICAS (CONTRATO):
 * 1. CAPITALIZAÇÃO COMPOSTA: Sempre (indexador × spread) - 1, NUNCA soma aritmética
 * 2. DATAS REGRESSIVAS: Se finalMaturityDate existe → cálculo SEMPRE regressivo
 * 3. AMERICANO/BULLET: Exige finalMaturityDate (principal só no vencimento final)
 * 4. STRATEGIES: Focam APENAS em amortização — Engine controla contexto, datas e juros compostos
 * 
 * Arquitetura: 
 * - Strategy Pattern para amortização (SAC, PRICE, etc.)
 * - Factory Pattern para indexadores (CDI, SELIC, USD, etc.)
 * - Validação Central de Contexto (antes de delegar às Strategies)
 * - Política de Arredondamento Institucional (roundMoney)
 * - Calculation Fingerprint (SHA-256) para auditoria
 */

/**
 * 🔐 VERSÃO DO MOTOR DE CÁLCULO
 * Incrementar sempre que houver mudança matemática
 */
export const ENGINE_VERSION = "1.2.2"; // +Ancoragem de vencimentos no dia de referência + próximo DU

/**
 * 🔐 BUILD ID DO MOTOR
 * Identificador único de build (commit hash simulado)
 * Em produção: substituir por git_commit_hash real
 */
export const ENGINE_BUILD_ID = "build-20260815-due-anchor";

/**
 * 🔐 POLÍTICA DE ARREDONDAMENTO
 * Define método e momento de arredondamento
 */
export const ROUNDING_POLICY = {
  method: "HALF_EVEN", // Banker's Rounding
  money_decimals: 2,
  percent_decimals: 6,
  exchange_decimals: 4,
  stage_rounding: false, // PROIBIDO arredondar em etapas intermediárias
  description: "BANKERS_ROUNDING_FINAL_ONLY"
};

import { SACStrategy } from "./strategies/SACStrategy.js";
import { PRICEStrategy } from "./strategies/PRICEStrategy.js";
import { AMERICANOStrategy } from "./strategies/AMERICANOStrategy.js";
import { BULLETStrategy } from "./strategies/BULLETStrategy.js";
import { PERCENTAGE_RESIDUAL_Strategy } from "./strategies/PERCENTAGE_RESIDUAL_Strategy.js";
import { IndexerFactory } from "./indexers/IndexerFactory.js";
import { roundMoney, roundPercent, roundExchangeRate } from "./roundMoney.js";

// 🔐 ETAPA 1: Integração Passiva do PrecisionLayer (ZERO SIDE EFFECTS)
import {
  toDecimal,
  toNumber,
  round,
  roundDecimal,
  isValid,
  isEqual,
  convertCurrency,
  exchangeVariation,
  formatCurrency,
  compoundAmount,
  simpleInterest,
  equivalentRate,
  accumulationFactor,
  PRECISION_MODES,
  initPrecision
} from "./PrecisionLayer.js";

// 🔐 ETAPA 2: Imports assíncronos
import { PrecisionAudit } from "./PrecisionAudit.js";
import * as ScheduleIntegrity from "./ScheduleIntegrity.js";
import { AuditLog } from "./AuditLog.js";
import { createPrecisionGovernance } from "./PrecisionGovernance.js";

function getPrecisionAudit() {
  return PrecisionAudit;
}

function getScheduleIntegrity() {
  return ScheduleIntegrity;
}

function getAuditLog() {
  return { AuditLog };
}

function getPrecisionGovernance() {
  return createPrecisionGovernance;
}

/**
 * 🔐 CALCULATION FINGERPRINT STRICT (DETERMINÍSTICO)
 * Hash SHA-256 idêntico para mesmos inputs (100% reprodutível)
 * ⭐ CRÍTICO: Sem timestamp, sem instance_id, sem voláteis
 * Uso: Validar integridade matemática, comparar cálculos
 * @param {Object} inputs - Parâmetros de entrada
 * @param {string} engineVersion - Versão do motor
 * @returns {Promise<string>} Hash SHA-256 hexadecimal (determinístico)
 */
async function generateCalculationHashStrict(inputs, engineVersion) {
  // Objeto canônico SEM timestamp (DETERMINÍSTICO para reprodutibilidade)
  const canonical = {
    engineVersion,
    operationValue: inputs.operationValue,
    signalValue: inputs.signalValue || 0,
    iofValue: inputs.iofValue || 0,
    iofFinanced: inputs.iofFinanced || false,
    encargoGarantiaValue: inputs.encargoGarantiaValue || 0,
    encargoGarantiaFinanced: inputs.encargoGarantiaFinanced || false,
    otherFees: inputs.otherFees || 0,
    otherFeesFinanced: inputs.otherFeesFinanced || false,
    fixedRate: inputs.fixedRate,
    indexer: inputs.indexer || "NA",
    indexerSpread: inputs.indexerSpread || 0,
    operationDate: inputs.operationDate,
    principalGraceMonths: inputs.principalGraceMonths || 0,
    interestGraceMonths: inputs.interestGraceMonths || 0,
    graceInterestBehavior: inputs.graceInterestBehavior || "CAPITALIZAR",
    amortizationTrigger: inputs.amortizationTrigger || "END_OF_GRACE",
    principalInstallments: inputs.principalInstallments,
    interestInstallments: inputs.interestInstallments,
    principalFrequency: inputs.principalFrequency || "1",
    interestFrequency: inputs.interestFrequency || "1",
    calculationSystem: inputs.calculationSystem,
    totalTermMonths: inputs.totalTermMonths,
    finalMaturityDate: inputs.finalMaturityDate,
    currencyId: inputs.currencyId,
    exchangeLag: inputs.exchangeLag || 1,
    amount_foreign: inputs.amount_foreign,
    percentageBase: inputs.percentageBase || "saldo_devedor"
  };
  
  const canonicalString = JSON.stringify(canonical, Object.keys(canonical).sort());
  const encoder = new TextEncoder();
  const data = encoder.encode(canonicalString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 🔐 CALCULATION FINGERPRINT INSTANCE (COM TIMESTAMP)
 * Gera hash SHA-256 único incluindo timestamp (identificação de evento/instância)
 * ⭐ CRÍTICO: Com timestamp, identifica THIS calculation event unicamente
 * Uso: Audit log, rastreamento de instância, blockchain-like logging
 * @param {Object} inputs - Parâmetros de entrada do cálculo
 * @param {string} engineVersion - Versão do motor
 * @returns {Promise<string>} Hash SHA-256 hexadecimal (único por instância)
 */
async function generateCalculationHash(inputs, engineVersion) {
  const timestamp = new Date().toISOString();  // ⭐ VOLÁTIL: diferente cada vez
  
  // Montar objeto canônico para hash COM timestamp
  const canonical = {
    engineVersion,
    timestamp,
    operationValue: inputs.operationValue,
    signalValue: inputs.signalValue || 0,
    iofValue: inputs.iofValue || 0,
    iofFinanced: inputs.iofFinanced || false,
    encargoGarantiaValue: inputs.encargoGarantiaValue || 0,
    encargoGarantiaFinanced: inputs.encargoGarantiaFinanced || false,
    otherFees: inputs.otherFees || 0,
    otherFeesFinanced: inputs.otherFeesFinanced || false,
    fixedRate: inputs.fixedRate,
    indexer: inputs.indexer || "NA",
    indexerSpread: inputs.indexerSpread || 0,
    operationDate: inputs.operationDate,
    principalGraceMonths: inputs.principalGraceMonths || 0,
    interestGraceMonths: inputs.interestGraceMonths || 0,
    graceInterestBehavior: inputs.graceInterestBehavior || "CAPITALIZAR",
    amortizationTrigger: inputs.amortizationTrigger || "END_OF_GRACE",
    principalInstallments: inputs.principalInstallments,
    interestInstallments: inputs.interestInstallments,
    principalFrequency: inputs.principalFrequency || "1",
    interestFrequency: inputs.interestFrequency || "1",
    calculationSystem: inputs.calculationSystem,
    totalTermMonths: inputs.totalTermMonths,
    finalMaturityDate: inputs.finalMaturityDate,
    currencyId: inputs.currencyId,
    exchangeLag: inputs.exchangeLag || 1,
    amount_foreign: inputs.amount_foreign,
    percentageBase: inputs.percentageBase || "saldo_devedor"
  };
  
  // Serializar para JSON (ordenado)
  const canonicalString = JSON.stringify(canonical, Object.keys(canonical).sort());
  
  // Gerar hash SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(canonicalString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex;
}

/**
 * Interpreta YYYY-MM-DD (ou Date) como calendário local, sem deslocar por UTC.
 */
function parseLocalDate(dateInput) {
  if (dateInput instanceof Date) {
    return new Date(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate());
  }
  if (!dateInput) return null;
  const iso = String(dateInput).trim().split("T")[0];
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function toISODateLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function holidayDateValue(holiday) {
  const raw = typeof holiday === "string" ? holiday : holiday?.holiday_date;
  return raw ? String(raw).split("T")[0] : "";
}

/**
 * Soma meses a uma data garantindo a trava de fim de mês (evita overflow)
 * Exemplo: 31/01 + 1 = 28/02 (não 31/03), 31/01 + 2 = 31/03, 31/01 + 3 = 30/04
 */
function addMonths(date, months) {
  const source = date instanceof Date ? date : parseLocalDate(date);
  const nominalDay = source.getDate();
  const d = new Date(source.getFullYear(), source.getMonth(), 1);
  d.setMonth(d.getMonth() + months);
  const lastDayOfTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(nominalDay, lastDayOfTargetMonth));
  return d;
}

// Verifica se é dia útil (exclui sábados, domingos e feriados)
function isBusinessDay(date, holidays = []) {
  const d = date instanceof Date ? date : parseLocalDate(date);
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const dateStr = toISODateLocal(d);
  return !holidays.some(h => holidayDateValue(h) === dateStr);
}

// Postergar: próximo dia útil. O mês seguinte reancora no dia de referência (não herda o adiamento).
function nextBusinessDay(date, holidays = []) {
  const d = parseLocalDate(date);
  while (!isBusinessDay(d, holidays)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/**
 * Data nominal no dia de referência do mês (ou último dia se o mês for menor),
 * depois postergada para o próximo dia útil em FDS/feriado.
 */
function anchoredDueDate(year, monthIndex, referenceDay, holidays = []) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.min(Math.max(1, referenceDay), lastDay);
  return nextBusinessDay(new Date(year, monthIndex, day), holidays);
}

// Conta dias corridos entre duas datas
function daysBetween(d1, d2) {
  const t1 = new Date(d1).getTime();
  const t2 = new Date(d2).getTime();
  const days = Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
  
  // ⚠️ VALIDAÇÃO CRÍTICA: Detectar dias negativos (bug de ordenação)
  if (days < 0) {
    console.error('🚨 ERRO CRÍTICO: Dias negativos detectados!', {
      dataAnterior: d1,
      dataVencimento: d2,
      diasCalculados: days,
      explicacao: 'Data anterior é MAIOR que data vencimento - ordenação invertida!'
    });
    throw new Error(`Erro de ordenação: Data anterior (${d1}) é posterior à data vencimento (${d2}). Dias calculados: ${days}`);
  }
  
  return days;
}

// Conta dias úteis entre duas datas (exclui fins de semana e feriados)
function businessDaysBetween(d1, d2, holidays = []) {
  let count = 0;
  const start = new Date(d1);
  const end = new Date(d2);
  const current = new Date(start);
  current.setDate(current.getDate() + 1);
  while (current <= end) {
    if (isBusinessDay(current, holidays)) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

// Taxa anual para taxa do período (base 360 dias corridos ou 252 DU)
function fixedRateForPeriod(annualRate, days, useBase252 = false) {
  const base = useBase252 ? 252 : 360;
  return Math.pow(1 + annualRate / 100, days / base) - 1;
}

// Taxa anual para fator acumulado (base 252 DU - exponencial)
function indexerFactorForPeriod(annualRate, businessDays) {
  return Math.pow(1 + annualRate / 100, businessDays / 252) - 1;
}



// Mapeia frequência para meses
function frequencyToMonths(freq) {
  if (freq === "bullet") return 0;
  return parseInt(freq) || 1;
}

// Gera datas de vencimento no mesmo dia do mês (não é data + 30/31 dias).
// FDS/feriado posterga só aquele mês; o seguinte reancora no dia de referência.
function generateDueDates(startDate, count, frequencyMonths, referenceDayOfMonth = null, endDate = null, holidays = []) {
  const dates = [];
  const dateReference = endDate ? parseLocalDate(endDate) : parseLocalDate(startDate);
  const isRegressive = !!endDate;
  const refDay = referenceDayOfMonth || dateReference.getDate();
  
  for (let i = 1; i <= count; i++) {
    const d = isRegressive
      ? addMonths(dateReference, -((count - i) * frequencyMonths))
      : addMonths(parseLocalDate(startDate), i * frequencyMonths);
    dates.push(anchoredDueDate(d.getFullYear(), d.getMonth(), refDay, holidays));
  }
  return dates;
}





import { validateLegalCompliance, validateCalculationContext } from "./LegalComplianceValidator.js";

/**
 * Converte data BR (DD/MM/YYYY) ou ISO (YYYY-MM-DD) para ISO
 */
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  
  const str = String(dateStr).trim();
  
  // Se já está no formato ISO (YYYY-MM-DD)
  if (str.match(/^\d{4}-\d{2}-\d{2}$/)) return str;
  
  // Se está no formato BR (DD/MM/YYYY)
  if (str.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
    const [day, month, year] = str.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Se está com hífens mas em formato BR (DD-MM-YYYY)
  if (str.match(/^\d{2}-\d{2}-\d{4}$/)) {
    const [day, month, year] = str.split('-');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Se tem timestamp (ISO completo)
  if (str.includes('T')) {
    return str.split('T')[0];
  }
  
  console.warn('⚠️ Formato de data não reconhecido:', dateStr);
  return str;
}

/**
 * Busca taxa PTAX com fallback Nearest Past
 * @param {string} targetDate - Data alvo (YYYY-MM-DD)
 * @param {number} lag - Defasagem (0=D, 1=D-1, 2=D-2)
 * @param {Array} rates - Array ordenado ASC: [{rate_date, ptax_rate, source, created_at}]
 * @returns {{rate: number, series_id: string}} Taxa PTAX com ID da série
 */
function getExchangeRate(targetDate, lag, rates) {
  if (!rates || rates.length === 0) return { rate: 1, series_id: null }; // Fallback: BRL=1
  
  // Calcular data de busca com lag
  const searchDate = new Date(targetDate);
  searchDate.setDate(searchDate.getDate() - lag);
  const searchStr = searchDate.toISOString().split('T')[0];
  
  // 🔐 CORREÇÃO: Buscar a MAIS RECENTE taxa <= searchStr
  // Array está ordenado ASC, então precisamos da ÚLTIMA que atende o critério
  let found = null;
  for (let i = rates.length - 1; i >= 0; i--) {
    if (rates[i].rate_date <= searchStr) {
      found = rates[i];
      break;
    }
  }
  
  if (!found) {
    const lastRate = rates[rates.length - 1]?.ptax_rate;
    const seriesId = rates[rates.length - 1]?.series_id || "BCB_PTAX_USD";
    console.warn(`⚠️ PTAX não encontrada para ${searchStr}, usando última taxa: ${lastRate}`);
    
    // 🔐 VALIDAÇÃO: Garantir que lastRate é válida
    if (!lastRate || lastRate <= 0) {
      throw new Error(`Falha crítica: Nenhuma taxa PTAX válida disponível para ${searchStr}`);
    }
    
    return { rate: lastRate, series_id: seriesId };
  }
  
  return { rate: found.ptax_rate, series_id: found.series_id || "BCB_PTAX_USD" };
}

/**
 * Função principal de cálculo
 */
export async function calculateAmortizationSchedule(params) {
  // 🔐 ETAPA 1: Inicializar PrecisionLayer com config padrão (idempotente, não executa se já inicializado)
  initPrecision();
  
  // 🔐 ETAPA 2: Inicializar auditoria de precisão APENAS se enable_precision_audit !== false
  let precisionAudit = null;
  if (params.enable_precision_audit !== false) {
    const PrecisionAuditClass = getPrecisionAudit();
    precisionAudit = new PrecisionAuditClass();
  }
  
  // 🔐 MODO: SIMULAÇÃO vs CONTRATO APROVADO
  const simulationMode = params.simulation_mode !== false; // Default: true (simulação)
  const contractStatus = params.contract_status || "SIMULATION"; // SIMULATION, APPROVED, REOPENED
  
  // 🔐 ETAPA 3: Flags de Controle de Governança
  const enableIntegrityChecks = params.enable_integrity_checks !== false; // Default: true
  const enableAuditLog = params.enable_audit_log !== false; // Default: true
  const failOnIntegrityError = params.fail_on_integrity_error === true; // Default: false
  const failOnPrecisionError = params.fail_on_precision_error === true; // Default: false
  
  // 🔐 VALIDAÇÃO: Contrato aprovado NÃO pode ser recalculado (imutabilidade)
  if (contractStatus === "APPROVED" && !params.force_recalculation) {
    throw new Error(
      `[ERRO_IMUTABILIDADE] Contrato aprovado não pode ser recalculado. ` +
      `Status: ${contractStatus}. Para recalcular, use action: REOPEN_CONTRACT.`
    );
  }
  
  // 🔐 VALIDAÇÕES DE RISCO JURÍDICO (antes de qualquer cálculo)
  validateLegalCompliance(params);
  
  // Validar contexto matemático ANTES de qualquer cálculo
  validateCalculationContext(params);
  
  // 🔐 CALCULATION FINGERPRINT (Ambos: Strict + Instance)
  // 📌 STRICT: determinístico, reprodutível, para validação matemática
  // 📌 INSTANCE: com timestamp, único para cada cálculo, para audit trail
  const calculatedAt = new Date().toISOString();
  const calculationHashStrict = await generateCalculationHashStrict(params, ENGINE_VERSION);  // Determinístico
  const calculationHashInstance = await generateCalculationHash(params, ENGINE_VERSION);  // Único (timestamp)
  
  // ⚠️ DEBUG CRÍTICO: Capturar TODOS os parâmetros brutos antes de qualquer processamento
  console.log('🚨 PARAMS RECEBIDOS (RAW):', {
    operationDate_raw: params.operationDate,
    operationDate_type: typeof params.operationDate,
    firstPaymentDate_raw: params.firstPaymentDate,
    firstPaymentDate_type: typeof params.firstPaymentDate,
    finalMaturityDate_raw: params.finalMaturityDate,
    finalMaturityDate_type: typeof params.finalMaturityDate,
    principalGraceMonths: params.principalGraceMonths,
    interestGraceMonths: params.interestGraceMonths,
    principalInstallments: params.principalInstallments,
    calculationSystem: params.calculationSystem,
    graceInterestBehavior: params.graceInterestBehavior,
    graceAction: params.graceAction,
    currencyId: params.currencyId,
    exchangeLag: params.exchangeLag
  });
  
  const {
    operationValue,
    signalValue = 0,
    iofValue = 0,
    iofFinanced = false,
    encargoGarantiaValue = 0, // NOVO: Encargo por Concessão de Garantia (ECG)
    encargoGarantiaFinanced = false, // NOVO: ECG financiado (soma ao principal)
    otherFees = 0,
    otherFeesFinanced = false,
    mipValue = 0, // NOVO: Seguro MIP
    mipEmbedded = false, // NOVO: MIP embutido na parcela
    dfiValue = 0, // NOVO: Seguro DFI
    dfiEmbedded = false, // NOVO: DFI embutido na parcela
    otherInsuranceValue = 0, // NOVO: Outros seguros
    otherInsuranceEmbedded = false, // NOVO: Seguros embutidos
    fixedRate, // % a.a.
    indexer = "NA",
    indexerSpread = 0,
    operationDate: rawOperationDate,
    firstPaymentDate: rawFirstPaymentDate, // Dia de referência dos vencimentos
    first_payment_date: rawFirstPaymentDateSnake,
    principalGraceMonths = 0,
    interestGraceMonths = 0,
    graceAction = "capitalizar", // DEPRECATED - usar graceInterestBehavior
    graceInterestBehavior = null, // NOVO: "CAPITALIZAR", "INTEREST_ONLY", "BALLOON"
    amortizationTrigger = "END_OF_GRACE", // NOVO: "END_OF_GRACE" ou "GRACE_PLUS_FREQ"
    principalInstallments,
    interestInstallments,
    principalFrequency = "1",
    interestFrequency = "1",
    calculationSystem,
    cdiRates = [], // Array de {rate_date, annual_rate, rate_type}
    holidays = [], // Array de {holiday_date}
    customDates = null, // Datas customizadas pelo usuário
    totalTermMonths = null, // Prazo total em meses (usado no AMERICANO)
    finalMaturityDate: rawFinalMaturityDate = null, // Data final exata para BULLET/AMERICANO
    amortizationSchedule = null, // Para PERCENTAGE_RESIDUAL: {1: 0.24, 2: 0.28, ...}
    percentageBase = "saldo_devedor", // Para PERCENTAGE_RESIDUAL: "saldo_devedor" ou "principal"
    currencyId = null, // NOVO: ID da moeda (USD, EUR, etc)
    exchangeLag = 1, // NOVO: Defasagem PTAX (0=D, 1=D-1, 2=D-2)
    exchangeRates = [], // NOVO: Array de {rate_date, ptax_rate, source, created_at}
    amount_foreign = null, // NOVO: Valor em moeda estrangeira
  } = params;
  
  // 🔐 VALIDAÇÃO 1: Inputs críticos
  if (operationValue <= 0) {
    throw new Error("Valor da operação deve ser maior que zero");
  }
  
  if (fixedRate < 0) {
    throw new Error("Taxa de juros não pode ser negativa");
  }
  
  // 🔐 VALIDAÇÃO 2: Operação USD exige exchange_rates
  const isUSD = currencyId && currencyId !== "";
  
  // 🔐 VALIDAÇÃO CRÍTICA: USD exige amount_foreign > 0
  if (isUSD) {
    const af = Number(amount_foreign);
    if (!Number.isFinite(af) || af <= 0) {
      throw new Error(
        "Operação em moeda estrangeira exige 'amount_foreign' > 0 (valor em USD). " +
        "Verifique o preenchimento/parse do campo no formulário."
      );
    }
  }
  
  if (isUSD && (!exchangeRates || exchangeRates.length === 0)) {
    throw new Error(
      "Operação em USD exige tabela de taxas de câmbio. " +
      "Carregue as taxas PTAX antes de calcular o contrato."
    );
  }
  
  // 🔐 VALIDAÇÃO 3: PTAX válidas
  if (isUSD && exchangeRates.some(r => r.ptax_rate <= 0)) {
    throw new Error("Taxa PTAX inválida detectada (≤ 0). Verifique os dados importados.");
  }
  
  // ✅ FALLBACK RETROCOMPATIBILIDADE: Mapear grace_action legado para graceInterestBehavior
  let effectiveGraceInterestBehavior = graceInterestBehavior;
  if (!effectiveGraceInterestBehavior) {
    if (graceAction === "pagar") {
      effectiveGraceInterestBehavior = "INTEREST_ONLY";
    } else {
      effectiveGraceInterestBehavior = "CAPITALIZAR";
    }
  }

  // Normalizar datas para formato ISO
  const operationDate = normalizeDate(rawOperationDate);
  const firstPaymentDate = normalizeDate(rawFirstPaymentDate || rawFirstPaymentDateSnake);
  const finalMaturityDate = normalizeDate(rawFinalMaturityDate);
  
  // Debug: verificar datas normalizadas
  console.log('📅 Datas normalizadas:', {
    operationDate,
    firstPaymentDate,
    finalMaturityDate,
    original_operationDate: rawOperationDate
  });

  // 🔐 SNAPSHOT DE TAXAS: Usar snapshot se contrato aprovado, senão usar taxas atuais
  let effectiveCdiRates = cdiRates;
  let effectiveExchangeRates = exchangeRates;
  let usedSnapshotRates = false;
  
  effectiveCdiRates = Array.isArray(effectiveCdiRates) ? effectiveCdiRates : [];
  effectiveExchangeRates = Array.isArray(effectiveExchangeRates) ? effectiveExchangeRates : [];
  
  if (!simulationMode && params.rate_snapshot) {
    // Contrato aprovado: USAR SNAPSHOT (imutabilidade)
    effectiveCdiRates = params.rate_snapshot.cdi_rates_used || cdiRates;
    effectiveExchangeRates = params.rate_snapshot.ptax_rates_used || exchangeRates;
    usedSnapshotRates = true;
    console.log('🔐 USANDO SNAPSHOT DE TAXAS (Contrato Aprovado)');
  }
  
  // Separar taxas por tipo (para factory de indexadores)
  const cdiByType = {
    CDI: effectiveCdiRates.filter(r => r.rate_type === "CDI"),
    SELIC: effectiveCdiRates.filter(r => r.rate_type === "SELIC"),
  };

  // Inicializar factory de indexadores
  const indexerFactory = new IndexerFactory(
    cdiByType.CDI,
    cdiByType.SELIC,
    [] // dollarRates podem ser adicionadas depois
  );

  // 1️⃣ PRIMEIRO: Definir a taxa PTAX inicial (Momento Zero)
  let initialPtaxData = { rate: 1, series_id: null };
  if (isUSD) {
    // Busca a PTAX da data da operação para servir de base
    initialPtaxData = getExchangeRate(operationDate, exchangeLag, exchangeRates);
  }

  // 2️⃣ SEGUNDO: Inicializar as variáveis de controle do loop
  let prevPtaxRate = initialPtaxData.rate; 
  let ptaxSeriesId = initialPtaxData.series_id;

  // 3️⃣ TERCEIRO: Calcular o Principal na Moeda Base
  let principal;
  if (isUSD && amount_foreign) {
    // ✅ CORREÇÃO DA DUPLA CONVERSÃO:
    // O principal para o cálculo deve ser o valor em DÓLAR (ex: 2.573.531,00)
    principal = amount_foreign; 
    
    // Se houver sinal ou taxas em BRL, converte para USD antes de abater do principal
    if (signalValue > 0) principal -= (signalValue / prevPtaxRate);
    if (iofFinanced) principal += (iofValue / prevPtaxRate);
    if (encargoGarantiaFinanced) principal += (encargoGarantiaValue / prevPtaxRate);
    if (otherFeesFinanced) principal += (otherFees / prevPtaxRate);
  } else {
    // Operação padrão em BRL
    principal = operationValue - signalValue;
    if (iofFinanced) principal += iofValue;
    if (encargoGarantiaFinanced) principal += encargoGarantiaValue;
    if (otherFeesFinanced) principal += otherFees;
  }

  // 4️⃣ QUARTO: Definir o saldo inicial para o loop das estratégias
  let sdInicialUSD = principal;

  const principalFreqMonths = frequencyToMonths(principalFrequency);
  const interestFreqMonths = frequencyToMonths(interestFrequency);

  // 2. Gerar cronograma MENSAL (sempre mês a mês para conciliação contábil)
  const startDate = parseLocalDate(operationDate);
  const hasFirstPaymentDate = !!(firstPaymentDate && String(firstPaymentDate).trim());
  const dueAnchorDate = hasFirstPaymentDate ? parseLocalDate(firstPaymentDate) : startDate;
  
  console.log('🔍 Debug startDate:', {
    operationDate,
    startDate: toISODateLocal(startDate),
    firstPaymentDate,
    dueAnchorDate: dueAnchorDate ? toISODateLocal(dueAnchorDate) : null,
    usingOperationDateFallback: !hasFirstPaymentDate
  });

  // Mapear quando há pagamentos de principal e juros
  const principalPaymentMonths = new Set();
  const interestPaymentMonths = new Set();
  let totalMonths = 0;
  
  const hasFinalDate = finalMaturityDate && String(finalMaturityDate).trim() !== "";

  // Preenchido → Dia de Referência. Vazio → Data da Operação (mesmo dia do mês).
  const referenceDayOfMonth = dueAnchorDate.getDate();

  if (hasFinalDate) {
    const finalDate = parseLocalDate(finalMaturityDate);
    if (totalTermMonths && totalTermMonths > 0) {
      totalMonths = totalTermMonths;
    } else {
      // Cada linha da tabela usa sempre o dia da âncora (referenceDayOfMonth,
      // acima) — o dia do vencimento final é ignorado no bucket ano/mês, só
      // o mês/ano importam aqui. Por isso a diferença é sempre em blocos de
      // ano/mês "cheios", sem ajuste pelo dia do mês.
      const anchorForCount = hasFirstPaymentDate ? dueAnchorDate : startDate;
      const yearDiff = finalDate.getFullYear() - anchorForCount.getFullYear();
      const monthDiff = finalDate.getMonth() - anchorForCount.getMonth();
      totalMonths = yearDiff * 12 + monthDiff;
      // Com Referência preenchida, a 1ª parcela já é a própria Referência
      // ("mês 0" do loop abaixo), então é preciso +1 mês para a última
      // parcela cair exatamente na Data Vencimento Final. Sem Referência, a
      // 1ª parcela já é gerada 1 mês após a Data da Operação (ver loop
      // "monthIdx + 1" mais abaixo), então não soma nada aqui.
      if (hasFirstPaymentDate) {
        totalMonths += 1;
      }
    }
  }
  
  // AMERICANO e BULLET: pagamento final no mês = prazo total (ou diferença com finalMaturityDate)
  if (calculationSystem === "AMERICANO" || calculationSystem === "BULLET") {
    // Se finalMaturityDate foi usado acima, totalMonths já foi calculado corretamente
    // Senão, usar totalTermMonths fornecido
    const bulletMonth = finalMaturityDate ? totalMonths : (totalTermMonths || (principalGraceMonths + (principalInstallments * principalFreqMonths)));
    principalPaymentMonths.add(bulletMonth);
    
    // Juros: BULLET = junto com principal, AMERICANO = periodicidade normal
    if (calculationSystem === "BULLET") {
      interestPaymentMonths.add(bulletMonth);
    } else {
      for (let i = 1; i <= interestInstallments; i++) {
        const monthOffset = interestGraceMonths + (i * interestFreqMonths);
        interestPaymentMonths.add(monthOffset);
      }
    }
    
    if (!finalMaturityDate) {
      // Só calcular totalMonths aqui se não foi calculado acima (sem finalMaturityDate)
      totalMonths = calculationSystem === "BULLET" ? bulletMonth : Math.max(bulletMonth, interestGraceMonths + (interestInstallments * interestFreqMonths));
    }
  } else if (calculationSystem === "PERCENTAGE_RESIDUAL") {
    // PERCENTAGE_RESIDUAL: primeira PMT imediatamente após carência
    for (let i = 1; i <= principalInstallments; i++) {
      let monthOffset;
      
      if (amortizationTrigger === "END_OF_GRACE") {
        monthOffset = principalGraceMonths + (i * principalFreqMonths);
      } else if (amortizationTrigger === "NEXT_MONTH") {
        monthOffset = principalGraceMonths + 1 + ((i - 1) * principalFreqMonths);
      } else { // GRACE_PLUS_FREQ
        monthOffset = principalGraceMonths + principalFreqMonths + ((i - 1) * principalFreqMonths);
      }
      
      principalPaymentMonths.add(Math.max(1, monthOffset));
    }
    
    // Juros seguem sua própria carência e periodicidade
    for (let i = 1; i <= interestInstallments; i++) {
      const monthOffset = interestGraceMonths + (i * interestFreqMonths);
      interestPaymentMonths.add(monthOffset);
    }
    
    // Total de meses: usar totalTermMonths se fornecido, senão calcular
    if (!totalMonths || totalMonths === 0) {
      const maxPrincipalMonth = principalGraceMonths + (principalInstallments * principalFreqMonths);
      const maxInterestMonth = interestGraceMonths + (interestInstallments * interestFreqMonths);
      totalMonths = Math.max(maxPrincipalMonth, maxInterestMonth);
    }
  } else {
    // Outros sistemas: respeitar amortizationTrigger
    for (let i = 1; i <= principalInstallments; i++) {
      let monthOffset;
      
      if (amortizationTrigger === "END_OF_GRACE") {
        // Primeira parcela no último mês da carência, demais seguem frequência
        monthOffset = principalGraceMonths + (i * principalFreqMonths);
      } else if (amortizationTrigger === "NEXT_MONTH") {
        // Primeira parcela um mês após carência, demais seguem frequência
        monthOffset = principalGraceMonths + 1 + ((i - 1) * principalFreqMonths);
      } else { // GRACE_PLUS_FREQ
        // Primeira parcela carência + 1 frequência, demais seguem frequência
        monthOffset = principalGraceMonths + principalFreqMonths + ((i - 1) * principalFreqMonths);
      }
      
      principalPaymentMonths.add(Math.max(1, monthOffset));
    }
    
    for (let i = 1; i <= interestInstallments; i++) {
      const monthOffset = interestGraceMonths + (i * interestFreqMonths);
      interestPaymentMonths.add(monthOffset);
    }
    
    // Total de meses: usar totalTermMonths se fornecido, senão calcular
    if (!totalMonths || totalMonths === 0) {
      const maxPrincipalMonth = principalGraceMonths + (principalInstallments * principalFreqMonths);
      const maxInterestMonth = interestGraceMonths + (interestInstallments * interestFreqMonths);
      totalMonths = Math.max(maxPrincipalMonth, maxInterestMonth);
    }
    
    console.log('🔍 Mapeamento de pagamentos:', {
      principalGraceMonths,
      interestGraceMonths,
      principalInstallments,
      interestInstallments,
      totalMonths,
      totalTermMonths,
      principalPaymentMonths: Array.from(principalPaymentMonths).sort((a,b) => a-b),
      interestPaymentMonths: Array.from(interestPaymentMonths).sort((a,b) => a-b)
    });
  }
  
  // Gerar uma linha por MÊS (sempre sequencial, um mês por linha para conciliação contábil)
  const mergedEvents = [];
  
  // Se customDates foi fornecido, usar essas datas
  if (customDates && customDates.length > 0) {
    // 🔐 VALIDAÇÃO: Garantir ordenação crescente
    for (let i = 1; i < customDates.length; i++) {
      const prev = parseLocalDate(customDates[i - 1]);
      const curr = parseLocalDate(customDates[i]);
      if (curr <= prev) {
        throw new Error(
          `Data customizada na posição ${i} (${customDates[i]}) não é posterior à anterior (${customDates[i - 1]}). ` +
          `Datas devem estar em ordem crescente.`
        );
      }
    }
    
    for (let monthIdx = 0; monthIdx < customDates.length; monthIdx++) {
      const hasPrincipal = principalPaymentMonths.has(monthIdx + 1);
      const hasInterest = interestPaymentMonths.has(monthIdx + 1);
      
      mergedEvents.push({
        date: parseLocalDate(customDates[monthIdx]),
        monthNumber: monthIdx + 1,
        hasPrincipal: hasPrincipal,
        hasInterest: hasInterest,
      });
    }
  } else {
    console.log('🔍 Gerando datas:', {
      totalMonths,
      referenceDayOfMonth,
      firstPaymentDate,
      dueAnchor: toISODateLocal(dueAnchorDate),
      usingOperationDateFallback: !hasFirstPaymentDate,
      operationDate: toISODateLocal(startDate),
      hasFinalDate
    });
    
    for (let monthIdx = 0; monthIdx < totalMonths; monthIdx++) {
      const hasPrincipal = principalPaymentMonths.has(monthIdx + 1);
      const hasInterest = interestPaymentMonths.has(monthIdx + 1);

      // Preenchido: calendário começa no Dia de Referência.
      // Vazio: usa a Data da Operação; 1º vencimento = 1 mês depois (mesmo dia).
      const monthDate = hasFirstPaymentDate
        ? addMonths(dueAnchorDate, monthIdx)
        : addMonths(startDate, monthIdx + 1);
      const dueDate = anchoredDueDate(
        monthDate.getFullYear(),
        monthDate.getMonth(),
        referenceDayOfMonth,
        holidays
      );
      
      console.log(`📅 Gerando Mês ${monthIdx + 1}/${totalMonths}:`, {
        monthIdx,
        referenceDayOfMonth,
        dueDate: toISODateLocal(dueDate),
        hasPrincipal,
        hasInterest
      });
      
      mergedEvents.push({
        date: dueDate,
        monthNumber: monthIdx + 1,
        hasPrincipal,
        hasInterest,
      });
    }
  }

  // 3. Calcular tabela
  const schedule = [];
  
  // 🔐 VALIDAÇÃO CRÍTICA: Garantir que PTAX inicial é válida (evitar NaN no primeiro loop)
  let cdiSeriesId = null; // ID da série temporal CDI/SELIC
  if (isUSD) {
    if (!prevPtaxRate || prevPtaxRate <= 0 || isNaN(prevPtaxRate)) {
      throw new Error(`Taxa PTAX inicial inválida: ${prevPtaxRate}. Verifique os dados de exchangeRates para a data ${operationDate}.`);
    }
  }
  
  // Extrair serie_id do indexador
  if (indexer !== "NA" && cdiByType[indexer] && cdiByType[indexer].length > 0) {
    cdiSeriesId = cdiByType[indexer][0].series_id || `BCB_${indexer}`;
  }
  
  // Função auxiliar para gerar UUID v4 (chave primária para integração ERP)
  function generateUUID() {
    // 🔐 FALLBACK SEGURO: Compatível Node e Browser
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    
    // Fallback RFC4122 v4 compatível
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  // prevDate sempre começa da data de operação
  let prevDate = startDate;
  let lastInterestPaymentDate = startDate; // Rastreia último pagamento de juros
  let parcela = 0;
  let acumulatedUnpaidInterest = 0; // Juros acumulados não pagos

  // Inicializar estratégia de cálculo
  let strategy = null;
  const isBulletSystem = calculationSystem === "BULLET";
  
  if (calculationSystem === "SAC") {
    strategy = new SACStrategy(sdInicialUSD, principalInstallments);
  } else if (calculationSystem === "PRICE") {
    // PRICE: usar taxa mensal equivalente (pro rata mês, não pro rata dia)
    const periodsPerYear = 12 / principalFreqMonths; // Ex: mensal=12, trimestral=4
    let priceRate = Math.pow(1 + fixedRate / 100, 1 / periodsPerYear) - 1;
    if (indexer !== "NA") {
      const spreadPeriodRate = Math.pow(1 + indexerSpread / 100, 1 / periodsPerYear) - 1;
      priceRate = (1 + priceRate) * (1 + spreadPeriodRate) - 1;
    }
    // PRICE valida BALLOON no construtor (vai lançar erro se incompatível)
    strategy = new PRICEStrategy(sdInicialUSD, principalInstallments, priceRate, interestGraceMonths, effectiveGraceInterestBehavior);
  } else if (calculationSystem === "AMERICANO") {
    strategy = new AMERICANOStrategy(sdInicialUSD);
  } else if (calculationSystem === "BULLET") {
    strategy = new BULLETStrategy(sdInicialUSD);
  } else if (calculationSystem === "PERCENTAGE_RESIDUAL") {
    // Parsear percentuais: "24.18,28.09,32.72" → {1: 0.2418, 2: 0.2809, 3: 0.3272}
    const parsedSchedule = {};
    if (amortizationSchedule && typeof amortizationSchedule === 'string') {
      const percentages = amortizationSchedule.split(',').map(p => parseFloat(p.trim()) / 100);
      percentages.forEach((p, idx) => {
        parsedSchedule[idx + 1] = p;
      });
    }
    // Mapear percentageBase para calcBase com nomes corretos
    const calcBase = percentageBase === "principal" ? "SALDO_PRINCIPAL" : "SALDO_DEVEDOR";
    strategy = new PERCENTAGE_RESIDUAL_Strategy(parsedSchedule, interestGraceMonths, calcBase);
  } else {
    strategy = new SACStrategy(principal, principalInstallments);
  }
  
  const strategyWarnings = [];
  
  // Adicionar warning de anatocismo se CAPITALIZAR
  if (effectiveGraceInterestBehavior === "CAPITALIZAR" && interestGraceMonths > 0) {
    strategyWarnings.push({
      type: "ANATOCISM",
      message: "⚠️ Anatocismo: Juros capitalizados durante a carência geram juros sobre juros. Esta prática está sujeita a regulamentação específica no Brasil.",
    });
  }
  
  // Verificar se estamos dentro do período de carência de juros
  const isWithinInterestGrace = (monthIdx) => monthIdx <= interestGraceMonths;
  
  // Contador de parcelas de principal (para PERCENTAGE_RESIDUAL)
  let principalPaymentIndex = 0;
  
  // Acumulador de juros balloon (separado do SD)
  let totalJurosAcruados = 0;

  for (let i = 0; i < mergedEvents.length; i++) {
    const evt = mergedEvents[i];
    parcela++;
    
    // 💱 Buscar PTAX do período com validação
    let currentPtaxRate = 1; // Fallback seguro
    if (isUSD) {
     const safeExchangeRates = effectiveExchangeRates || [];
     const ptaxData = getExchangeRate(toISODateLocal(evt.date), exchangeLag, safeExchangeRates);
     currentPtaxRate = ptaxData.rate;

     // 🔐 VALIDAÇÃO: Detectar PTAX inválida antes de calcular
     if (!currentPtaxRate || currentPtaxRate <= 0 || isNaN(currentPtaxRate)) {
       throw new Error(
         `Parcela ${parcela}: Taxa PTAX inválida (${currentPtaxRate}) para data ${toISODateLocal(evt.date)}. ` +
         `Verifique os dados de exchangeRates.`
       );
     }
    }

    // 🔍 DEBUG: Rastrear cada iteração do loop
    if (i < 3 || principalGraceMonths > 0) {
      console.log(`📊 Parcela ${parcela}:`, {
        prevDate: toISODateLocal(prevDate),
        currentDate: toISODateLocal(evt.date),
        monthNumber: evt.monthNumber,
        hasPrincipal: evt.hasPrincipal,
        hasInterest: evt.hasInterest,
        sdInicialUSD,
        currentPtaxRate
      });
    }

    const dias = daysBetween(prevDate, evt.date);
    const du = businessDaysBetween(prevDate, evt.date, holidays);

    // Calcular juros sobre SD Inicial USD (já atualizado com capitalizações anteriores)
    // PRICE: usar taxa mensal equivalente (mesmo período da PMT)
    // Outros sistemas: usar dias corridos
    let fixedInterestRate;
    if (calculationSystem === "PRICE") {
      // Taxa mensal equivalente (mesma usada no PMT)
      const periodsPerYear = 12 / principalFreqMonths;
      fixedInterestRate = Math.pow(1 + fixedRate / 100, 1 / periodsPerYear) - 1;
    } else {
      // Taxa baseada em dias corridos para outros sistemas
      fixedInterestRate = fixedRateForPeriod(fixedRate, dias);
    }
    const jurosFixosMes = sdInicialUSD * fixedInterestRate;

    let jurosVariaveisMes = 0;
    let indexerPeriodRate = 0;
    let indexerProjected = false;
    if (indexer !== "NA") {
     // Delegar ao factory de indexadores
     const indexAccum = indexerFactory.getFactor(indexer, toISODateLocal(prevDate), toISODateLocal(evt.date), holidays);
     const spreadRate = indexerFactorForPeriod(indexerSpread, du);

     // REGRA 1 (Imutável): CAPITALIZAÇÃO COMPOSTA
     // Indexador e spread SEMPRE multiplicam (não somam)
     // Fórmula: (índice × (1 + spread)) - 1
     // Justificativa: Em mercado financeiro, dois fatores capitalizam compostos
     // Diferença em milhões: centavos se tornam milhares ao longo dos anos
     indexerPeriodRate = (indexAccum.factor * (1 + spreadRate)) - 1;
     jurosVariaveisMes = sdInicialUSD * indexerPeriodRate;

     // Rastrear se há projeção para warning
     if (indexAccum.hasProjection) {
       indexerProjected = true;
     }
    }

    const jurosTotal = jurosFixosMes + jurosVariaveisMes;

    // 🔐 ETAPA 2: Shadow Calculation para Juros (Padrão Bancário)
    // Decimal é fonte de verdade, nunca reutilizar Number do fluxo principal
    if (precisionAudit) {
      // Recalcular desde a origem em Decimal
      const jurosFixosMes_dec = toDecimal(sdInicialUSD).times(toDecimal(fixedInterestRate));
      const jurosFixosMes_rounded = roundDecimal(jurosFixosMes_dec, 2);
      precisionAudit.logIfDifferent("jurosFixosMes", jurosFixosMes, toNumber(jurosFixosMes_rounded), parcela);

      let jurosVariaveisMes_dec = toDecimal(0);
      if (jurosVariaveisMes > 0) {
        jurosVariaveisMes_dec = toDecimal(sdInicialUSD).times(toDecimal(indexerPeriodRate));
        const jurosVariaveisMes_rounded = roundDecimal(jurosVariaveisMes_dec, 2);
        precisionAudit.logIfDifferent("jurosVariaveisMes", jurosVariaveisMes, toNumber(jurosVariaveisMes_rounded), parcela);
      }

      // Recalcular jurosTotal desde as parcelas decimais (mesma ordem)
      const jurosTotal_dec = jurosFixosMes_dec.plus(jurosVariaveisMes_dec);
      const jurosTotal_rounded = roundDecimal(jurosTotal_dec, 2);
      precisionAudit.logIfDifferent("jurosTotal", jurosTotal, toNumber(jurosTotal_rounded), parcela);
    }

    // Incrementar contador de parcelas de principal
    if (evt.hasPrincipal) {
      principalPaymentIndex++;
    }

    // 🔐 VALIDAÇÃO 4: Detectar anomalias em juros
    if (jurosTotal < 0 || isNaN(jurosTotal)) {
      throw new Error(`Parcela ${parcela}: Juros inválidos calculados (${jurosTotal}). Verifique as taxas e configurações.`);
    }

    // Delegar cálculo de amortização e prestação à estratégia (em USD)
    const isLastPayment = i === mergedEvents.length - 1;
    const strategyResult = strategy.calculatePayment(evt, jurosTotal, acumulatedUnpaidInterest, isLastPayment, sdInicialUSD + jurosTotal, sdInicialUSD, principalPaymentIndex, effectiveGraceInterestBehavior);
    
    // 🔐 PADRONIZAÇÃO: Garantir que todos os campos obrigatórios existam
    const {
      amortizacao: amortizacaoUSD = 0,
      prestacao: prestacaoUSD = 0,
      acumulatedUnpaidInterest: updatedAccumulated = 0,
      jurosCapitalizados = 0,
      jurosPagos = 0,
      jurosAcruados = 0
    } = strategyResult;

    acumulatedUnpaidInterest = updatedAccumulated;
    
    // Calcular SD Atualizado USD baseado no comportamento dos juros
    let sdAtualizadoUSD;
    
    if (jurosCapitalizados > 0) {
      // CAPITALIZAR: SD cresce com juros (anatocismo)
      sdAtualizadoUSD = sdInicialUSD + jurosCapitalizados;
    } else if (jurosAcruados > 0) {
      // BALLOON: SD não cresce, juros ficam congelados
      totalJurosAcruados += jurosAcruados;
      sdAtualizadoUSD = sdInicialUSD;
    } else if (!evt.hasPrincipal && !evt.hasInterest) {
      // INTEREST_ONLY (sem pagamento): juros acumulam mas SD não cresce
      sdAtualizadoUSD = sdInicialUSD;
    } else {
      // Pagamento normal: SD não é afetado por juros (serão pagos na prestação)
      sdAtualizadoUSD = sdInicialUSD;
    }
    
    // 🔐 ETAPA 2: Shadow Calculation para Saldo Atualizado
    if (precisionAudit && jurosCapitalizados > 0) {
      const sdAtualizadoUSD_decimal = toNumber(toDecimal(sdInicialUSD).plus(toDecimal(jurosCapitalizados)));
      precisionAudit.logIfDifferent("sdAtualizadoUSD", sdAtualizadoUSD, sdAtualizadoUSD_decimal, parcela);
    }

    // Coletar avisos da estratégia
    const warnings = strategy.getWarnings();
    if (warnings.length > 0) {
      strategyWarnings.push(...warnings);
    }

    // SD Final USD = SD Atualizado - Amortização (respeita comportamento de carência)
    let sdFinalUSD = sdAtualizadoUSD - amortizacaoUSD;
    if (sdFinalUSD < 0.01) sdFinalUSD = 0;
    
    // 🔐 ETAPA 2: Shadow Calculation para Saldo Final USD (Padrão Bancário)
    // Replicar EXATAMENTE: ordem, arredondamento e regra de corte
    if (precisionAudit) {
      const sdFinalUSD_dec = toDecimal(sdAtualizadoUSD).minus(toDecimal(amortizacaoUSD));
      let sdFinalUSD_shadow = sdFinalUSD_dec;
      
      // Replicar regra de corte: if (sdFinalUSD < 0.01) sdFinalUSD = 0;
      if (sdFinalUSD_shadow.abs().lt(0.01)) {
        sdFinalUSD_shadow = toDecimal(0);
      }
      
      const sdFinalUSD_rounded = roundDecimal(sdFinalUSD_shadow, 2);
      precisionAudit.logIfDifferent("sdFinalUSD", sdFinalUSD, toNumber(sdFinalUSD_rounded), parcela);
    }
    
    // 🔐 VALIDAÇÃO 5: Detectar saldo devedor negativo (permitir -0.01 por arredondamento)
    if (sdFinalUSD < -0.01) {
      throw new Error(`Parcela ${parcela}: Saldo devedor negativo detectado (${sdFinalUSD} USD). Erro de cálculo crítico.`);
    }
    
    // 💱 CONVERTER USD → BRL (Engine é o tradutor)
    // IMPORTANTE: No modelo USD, juros são calculados sobre o SD em USD
    // Conversão: jurosUSD × PTAX = juros em BRL
    // SD Inicial em BRL é SEMPRE (Saldo em USD * PTAX Anterior)
    const sdInicialBRL = isUSD ? (sdInicialUSD * prevPtaxRate) : sdInicialUSD;
    const sdAtualizadoBRL = sdAtualizadoUSD * currentPtaxRate;
    // SD Final em BRL é SEMPRE (Saldo Final em USD * PTAX Atual)
    const sdFinalBRL = isUSD ? (sdFinalUSD * currentPtaxRate) : sdFinalUSD;
    const amortizacaoBRL = amortizacaoUSD * currentPtaxRate;
    const prestacaoBRL = prestacaoUSD * currentPtaxRate;
    const jurosFixosBRL = jurosFixosMes * currentPtaxRate;
    const jurosVariaveisBRL = jurosVariaveisMes * currentPtaxRate;
    
    // 🔐 ETAPA 2: Shadow Calculation para Conversão Cambial (Padrão Bancário)
    // Manter Decimal até arredondamento final, aplicar EXATAMENTE mesmo arredondamento
    if (precisionAudit && isUSD) {
      const sdInicialBRL_dec = toDecimal(sdInicialUSD).times(toDecimal(prevPtaxRate));
      const sdInicialBRL_rounded = roundDecimal(sdInicialBRL_dec, 2);
      precisionAudit.logIfDifferent("sdInicialBRL", sdInicialBRL, toNumber(sdInicialBRL_rounded), parcela);
      
      const sdFinalBRL_dec = toDecimal(sdFinalUSD).times(toDecimal(currentPtaxRate));
      const sdFinalBRL_rounded = roundDecimal(sdFinalBRL_dec, 2);
      precisionAudit.logIfDifferent("sdFinalBRL", sdFinalBRL, toNumber(sdFinalBRL_rounded), parcela);
      
      const amortizacaoBRL_dec = toDecimal(amortizacaoUSD).times(toDecimal(currentPtaxRate));
      const amortizacaoBRL_rounded = roundDecimal(amortizacaoBRL_dec, 2);
      precisionAudit.logIfDifferent("amortizacaoBRL", amortizacaoBRL, toNumber(amortizacaoBRL_rounded), parcela);
    }
    
    // 💱 Calcular varCambial isolada (Regime de Competência)
    // CRÍTICO: Arredondar imediatamente para evitar drift de centavos
    const varCambialPrincipal = isUSD 
      ? roundTo(sdInicialUSD * (currentPtaxRate - prevPtaxRate), 2)
      : 0;
    
    // 🔐 GARANTIR EXPOSIÇÃO DE CAMPOS PARA TESTES (antes de criar blocoContabil)
    const ajusteCambialMes = isUSD 
      ? roundTo(varCambialPrincipal, 2) 
      : 0;
    const jurosCapitalizadosBRL = isUSD 
      ? roundTo((jurosCapitalizados || 0) * currentPtaxRate, 2)
      : roundTo(jurosCapitalizados, 2);

    // 📊 BLOCO CONTÁBIL (Rastreabilidade Total para Homologação)
    // 🔐 CRÍTICO: Todos os campos devem ser calculados com valores válidos (não NaN/undefined)
    const blocoContabil = isUSD ? {
      exercicio: evt.date.getFullYear(),
      periodo: evt.date.getMonth() + 1,
      
      // Auditoria de Taxas (garantir valores válidos)
      ptax_anterior: roundTo(prevPtaxRate || 1, 4),
      ptax_atual: roundTo(currentPtaxRate || 1, 4),
      delta_ptax: roundTo((currentPtaxRate || 1) - (prevPtaxRate || 1), 4),
      
      // Saldos USD
      sd_inicial_usd: roundTo(sdInicialUSD, 2),
      sd_final_usd: roundTo(sdFinalUSD, 2),
      
      // Valores em BRL (O que o teste valida)
      valorAberturaBRL: roundTo(sdInicialUSD * (prevPtaxRate || 1), 2),
      ajusteCambialMes: ajusteCambialMes, // Reutiliza variável calculada
      jurosCapitalizadosBRL: jurosCapitalizadosBRL, // Reutiliza variável calculada
      jurosPagosBRL: roundTo((jurosPagos || 0) * (currentPtaxRate || 1), 2),
      amortizacaoPagaBRL: roundTo((amortizacaoUSD || 0) * (currentPtaxRate || 1), 2),
      
      // Fechamento
      valorFechamentoBRL: roundTo(sdFinalUSD * (currentPtaxRate || 1), 2)
    } : null;

    schedule.push({
      id: generateUUID(),
      parcela,
      dataVencimento: toISODateLocal(evt.date),
      
      // 🔐 FASE 1 PASSO 1: JUROS USD NATIVOS (valores ANTES da conversão BRL)
      jurosFixosMes_USD: isUSD ? roundTo(jurosFixosMes, 2) : null,
      jurosVariaveisMes_USD: isUSD ? roundTo(jurosVariaveisMes, 2) : null,
      jurosTotal_USD: isUSD ? roundTo(jurosTotal, 2) : null,
      
      // USD (campos originais - mantidos)
      sdInicial_USD: isUSD ? roundTo(sdInicialUSD, 2) : null,
      sdAtualizado_USD: isUSD ? roundTo(sdAtualizadoUSD, 2) : null,
      sdFinal_USD: isUSD ? roundTo(sdFinalUSD, 2) : null,
      amortizacao_USD: isUSD ? roundTo(amortizacaoUSD, 2) : null,
      prestacao_USD: isUSD ? roundTo(prestacaoUSD, 2) : null,
      ptax_rate: isUSD ? roundTo(currentPtaxRate, 4) : null,
      
      // 🔐 FASE 1 PASSO 2: CAMPOS BRL FINANCEIROS (fxAtual - view helpers)
      sdInicial_BRL_fxAtual: isUSD ? roundTo(sdInicialUSD * currentPtaxRate, 2) : null,
      jurosTotal_BRL_fxAtual: isUSD ? roundTo(jurosTotal * currentPtaxRate, 2) : null,
      amortizacao_BRL_fxAtual: isUSD ? roundTo(amortizacaoUSD * currentPtaxRate, 2) : null,
      prestacao_BRL_fxAtual: isUSD ? roundTo(prestacaoUSD * currentPtaxRate, 2) : null,
      sdFinal_BRL_fxAtual: isUSD ? roundTo(sdFinalUSD * currentPtaxRate, 2) : null,
      
      // BRL (campos originais - mantidos sem alteração)
      sdInicial: roundTo(sdInicialBRL, 2),
      varCambial: roundTo(varCambialPrincipal, 2),
      indexadorPercent: roundTo(indexerPeriodRate * 100, 6),
      jurosFixosMes: roundTo(jurosFixosBRL, 2),
      jurosVariaveisMes: roundTo(jurosVariaveisBRL, 2),
      jurosAcruados: roundTo(jurosAcruados || 0, 2),
      jurosCapitalizados: roundTo(jurosCapitalizados, 2),
      jurosPagos: roundTo(jurosPagos, 2),
      sdAtualizado: roundTo(sdAtualizadoBRL, 2),
      amortizacao: roundTo(amortizacaoBRL, 2),
      prestacao: roundTo(prestacaoBRL, 2),
      sdFinal: roundTo(sdFinalBRL, 2),
      diasCorridos: dias,
      diasUteis: du,
      
      // 📊 Bloco Contábil (objeto completo para Aba de Contabilidade)
      blocoContabil: blocoContabil,
      
      // 🔐 EXPOSIÇÃO EXPLÍCITA PARA SUITE DE TESTES (raiz do objeto)
      ajusteCambialMes: ajusteCambialMes,
      jurosCapitalizadosBRL: jurosCapitalizadosBRL
    });

    // Atualizar rastreamento de última data de pagamento de juros
    if (evt.hasInterest) {
      lastInterestPaymentDate = evt.date;
    }

    // Próxima linha: SD Inicial USD = SD Final USD desta linha
    sdInicialUSD = sdFinalUSD;
    prevPtaxRate = currentPtaxRate; // Guardar PTAX para próximo cálculo de varCambial
    prevDate = evt.date;
  }

  // 🔐 FASE 1.3: VALIDAÇÃO FINAL
  let totalAmortization = 0, totalAmortizationUSD = 0, maxNegativeValue = 0;
  for (let i = 0; i < schedule.length; i++) {
    const row = schedule[i];
    [row.sdInicial, row.sdFinal, row.prestacao, row.jurosFixosMes, row.jurosVariaveisMes, row.amortizacao].forEach(f => {
      if (!Number.isFinite(f)) throw new Error(`[FINANCIAL_INTEGRITY_ERROR] Parcela ${i + 1}: Campo inválido`);
    });
    totalAmortization += (row.amortizacao || 0);
    if (isUSD && row.amortizacao_USD !== null) totalAmortizationUSD += (row.amortizacao_USD || 0);
    if (row.sdFinal < 0) maxNegativeValue = Math.min(maxNegativeValue, row.sdFinal);
    if (i < schedule.length - 1 && isUSD && Math.abs(row.sdFinal_USD - schedule[i + 1].sdInicial_USD) > 0.01) {
      throw new Error(`[FINANCIAL_INTEGRITY_ERROR] Quebra continuidade USD: Parcela ${row.parcela} → ${schedule[i + 1].parcela}`);
    }
  }
  
  // 🔐 CORREÇÃO CARÊNCIA CAPITALIZADA: Usar saldo pós-carência como base
  const firstPrincipalRow = schedule.find(r => (isUSD ? r.amortizacao_USD : r.amortizacao) > 0);
  const hasGrace = effectiveGraceInterestBehavior === "CAPITALIZAR" && principalGraceMonths > 0;
  let principalValidacao = principal;
  if (hasGrace && firstPrincipalRow) {
    principalValidacao = isUSD ? firstPrincipalRow.sdInicial_USD : firstPrincipalRow.sdInicial;
  }
  
  // 🔐 AJUSTE FINAL: Usar base correta (pós-carência se capitalizada)
  const lastRow = schedule[schedule.length - 1];
  if (isUSD) {
    const diffUSD = principalValidacao - totalAmortizationUSD;
    if (Math.abs(diffUSD) > 0 && Math.abs(diffUSD) <= 1.00) {
      lastRow.amortizacao_USD = roundTo((lastRow.amortizacao_USD || 0) + diffUSD, 2);
      lastRow.prestacao_USD = roundTo((lastRow.prestacao_USD || 0) + diffUSD, 2);
      lastRow.amortizacao = roundTo(lastRow.amortizacao_USD * lastRow.ptax_rate, 2);
      lastRow.prestacao = roundTo(lastRow.prestacao_USD * lastRow.ptax_rate, 2);
      lastRow.amortizacao_BRL_fxAtual = lastRow.amortizacao;
      lastRow.prestacao_BRL_fxAtual = lastRow.prestacao;
      lastRow.sdFinal_USD = 0; lastRow.sdFinal = 0; lastRow.sdFinal_BRL_fxAtual = 0;
      if (lastRow.blocoContabil) { lastRow.blocoContabil.amortizacaoPagaBRL = lastRow.amortizacao; lastRow.blocoContabil.valorFechamentoBRL = 0; }
      totalAmortizationUSD += diffUSD;
    }
  } else {
    const diffBRL = principalValidacao - totalAmortization;
    if (Math.abs(diffBRL) > 0 && Math.abs(diffBRL) <= 1.00) {
      lastRow.amortizacao = roundTo((lastRow.amortizacao || 0) + diffBRL, 2);
      lastRow.prestacao = roundTo((lastRow.prestacao || 0) + diffBRL, 2);
      lastRow.sdFinal = 0; totalAmortization += diffBRL;
    }
  }
  
  // 🔐 VALIDAÇÃO FINAL
  const amortizationDiff = isUSD ? Math.abs(totalAmortizationUSD - principalValidacao) : Math.abs(totalAmortization - principalValidacao);
  if (amortizationDiff > 0.01) {
    // Diagnóstico detalhado — vai direto no alert() do frontend, sem
    // precisar abrir o console do navegador para investigar.
    const diag = {
      diff: Number(amortizationDiff.toFixed(2)),
      principalOriginal: Number((principal || 0).toFixed(2)),
      principalUsadoNaValidacao: Number((principalValidacao || 0).toFixed(2)),
      totalAmortizado: Number(((isUSD ? totalAmortizationUSD : totalAmortization) || 0).toFixed(2)),
      hasGrace,
      principalGraceMonths,
      graceInterestBehavior: effectiveGraceInterestBehavior,
      saldoPosCarencia: firstPrincipalRow ? Number(((isUSD ? firstPrincipalRow.sdInicial_USD : firstPrincipalRow.sdInicial) || 0).toFixed(2)) : null,
      totalParcelas: schedule.length,
      calculationSystem,
      totalTermMonths,
      principalInstallments,
      interestInstallments,
    };
    throw new Error(`[FINANCIAL_INTEGRITY_ERROR] ${JSON.stringify(diag)}`);
  }

  
  // Validação: Saldo devedor final ≈ 0 (tolerância: 0.01)
  const finalBalance = schedule.length > 0 ? schedule[schedule.length - 1].sdFinal : 0;
  if (Math.abs(finalBalance) > 0.01) {
    throw new Error(
      `[FINANCIAL_INTEGRITY_ERROR] Saldo devedor final não é zero: ${finalBalance.toFixed(2)}`
    );
  }
  
  // Validação: Nenhum saldo devedor negativo além da tolerância
  if (maxNegativeValue < -0.01) {
    throw new Error(
      `[FINANCIAL_INTEGRITY_ERROR] Saldo devedor negativo detectado: ${maxNegativeValue.toFixed(2)}`
    );
  }
  
  // 🔐 POLICY DE SNAPSHOT DE INDEXADOR: Verificar projeção de taxas
  const hasProjectedRates = strategyWarnings.some(w => w.type === "PROJECTED_RATES");
  let lastRealRateDate = null;
  let projectedRatesUsed = false;
  
  const isCdiOrSelic = indexer === "CDI" || indexer === "SELIC";
  
  if (!hasProjectedRates && isCdiOrSelic && schedule.length > 0) {
    // Obter última taxa real e data final do contrato
    const lastRateDate = effectiveCdiRates.length > 0 
      ? new Date(effectiveCdiRates[effectiveCdiRates.length - 1].rate_date)
      : null;
    const contractEndDate = new Date(schedule[schedule.length - 1].dataVencimento);
    
    if (lastRateDate && contractEndDate > lastRateDate) {
      lastRealRateDate = lastRateDate.toISOString().split('T')[0];
      projectedRatesUsed = true;
      
      strategyWarnings.push({
        type: "PROJECTED_RATES",
        message: `⚠️ PROJEÇÃO DE TAXAS: Contrato vence em ${contractEndDate.toLocaleDateString("pt-BR")}, mas última taxa ${indexer} real é de ${lastRateDate.toLocaleDateString("pt-BR")}. Sistema replicou última taxa (replicate_last_rate=true, rate_source=PROJECTED).`,
      });
    }
  }

  // 🔐 CÁLCULO DE SEGUROS (MIP, DFI, Prestamista)
  const totalInsurance = (mipValue || 0) + (dfiValue || 0) + (otherInsuranceValue || 0);
  const insurancePerInstallment = totalInsurance > 0 ? roundTo(totalInsurance / schedule.length, 2) : 0;
  
  // 🔐 APROPRIAÇÃO DE ENCARGOS (Norma BACEN)
  // IOF, ECG e Taxas Financiadas: entram no SD mas são saída de caixa no momento zero para CET
  const upFrontFees = (iofFinanced ? 0 : iofValue) + (encargoGarantiaFinanced ? 0 : encargoGarantiaValue) + (otherFeesFinanced ? 0 : otherFees);
  const financedFeesImpactOnCash = (iofFinanced ? iofValue : 0) + (encargoGarantiaFinanced ? encargoGarantiaValue : 0) + (otherFeesFinanced ? otherFees : 0);
  
  // Seguros embutidos na parcela (recorrentes)
  const insuranceEmbeddedPerInstallment = roundTo(
    ((mipEmbedded ? (mipValue || 0) : 0) +
     (dfiEmbedded ? (dfiValue || 0) : 0) +
     (otherInsuranceEmbedded ? (otherInsuranceValue || 0) : 0)) / schedule.length,
    2
  );
  
  // 🔐 DUAL-VIEW CET: Custo Nominal (USD) vs Custo Real Projetado (BRL)
  const cetNominalUSD = calculateCET(
    isUSD ? (amount_foreign || principal) : operationValue,
    upFrontFees,
    financedFeesImpactOnCash,
    schedule,
    insuranceEmbeddedPerInstallment,
    isUSD ? "USD" : "BRL",
    false // Sem conversão PTAX
  );
  
  // CET Projetado em BRL: considera conversão cambial sobre todo o fluxo futuro
  const cetProjetadoBRL = isUSD 
    ? calculateCET(
        operationValue, // Valor em BRL
        upFrontFees,
        financedFeesImpactOnCash,
        schedule,
        insuranceEmbeddedPerInstallment,
        "BRL",
        true, // Com conversão PTAX
        (effectiveExchangeRates && effectiveExchangeRates.length > 0) ? effectiveExchangeRates[effectiveExchangeRates.length - 1].ptax_rate : 1
      )
    : cetNominalUSD; // Se não for USD, ambos são iguais

  // 📋 DISCLOSURE OBRIGATÓRIO (Transparência Regulatória)
  const totalInterest = roundTo(
    schedule.reduce((s, r) => s + r.jurosFixosMes + r.jurosVariaveisMes, 0),
    2
  );
  const totalPaid = roundTo(
    schedule.reduce((s, r) => s + r.prestacao, 0),
    2
  );
  const totalFeesAndIOF = roundTo((iofValue || 0) + (encargoGarantiaValue || 0) + (otherFees || 0), 2);

  const regulatoryDisclosure = {
    principal: roundTo(principal, 2),
    totalInterest: totalInterest,
    totalInsurance: roundTo(totalInsurance, 2),
    totalFees: roundTo(otherFees || 0, 2),
    totalIOF: roundTo(iofValue || 0, 2),
    totalEncargoGarantia: roundTo(encargoGarantiaValue || 0, 2),
    totalPaid: totalPaid,
    
    // 🔐 DUAL-VIEW CET: Exposição de Caixa Real
    cetNominal: isUSD ? cetNominalUSD : cetProjetadoBRL,
    cetNominalUSD: isUSD ? cetNominalUSD : null,
    cetProjetadoBRL: isUSD ? cetProjetadoBRL : null,
    
    // Retrocompatibilidade
    cetAnnual: cetProjetadoBRL.cetAnnual,
    cetMonthly: cetProjetadoBRL.cetMonthly,
    tirEffective: cetProjetadoBRL.tirEffective,
    
    effectiveRateAnnual: roundTo(
      (Math.pow(totalPaid / (principal + totalFeesAndIOF), 1 / (schedule.length / 12)) - 1) * 100,
      2
    ),
    nominalRateAnnual: roundTo(fixedRate, 2),
    insuranceBreakdown: totalInsurance > 0 ? {
      mip: roundTo(mipValue || 0, 2),
      mipEmbedded: mipEmbedded,
      dfi: roundTo(dfiValue || 0, 2),
      dfiEmbedded: dfiEmbedded,
      other: roundTo(otherInsuranceValue || 0, 2),
      otherEmbedded: otherInsuranceEmbedded,
      perInstallment: insurancePerInstallment
    } : null,
    
    // ⚠️ AVISO: Se operação USD, CET Real pode divergir do nominal
    exchangeRateRiskDisclosure: isUSD 
      ? `⚠️ Operação em USD: CET Nominal (${cetNominalUSD.cetAnnual.toFixed(2)}% a.a.) não reflete risco cambial. CET Projetado em BRL: ${cetProjetadoBRL.cetAnnual.toFixed(2)}% a.a.`
      : null
  };
  
  // 🔐 PHASE 2.6: IDENTIFICAÇÃO DE SÉRIE DE TAXAS
  const ratesMetadata = {
    ptax_series_id: ptaxSeriesId,
    cdi_series_id: cdiSeriesId,
    rate_snapshot_used: usedSnapshotRates
  };
  

  
  // 📋 Metadados de Cálculo (Reprodutibilidade & Auditoria)
  const calculation_metadata = {
    engine_version: ENGINE_VERSION,
    engine_build_id: ENGINE_BUILD_ID,
    strategy: calculationSystem,
    strategy_version: getStrategyVersion(calculationSystem),
    calculated_at: calculatedAt,
    calculation_hash_strict: calculationHashStrict,      // 🔐 DETERMINÍSTICO: fingerprint de inputs (reprodutível)
    calculation_hash_instance: calculationHashInstance, // 🔐 ÚNICO: instance_id com timestamp
    simulation_mode: simulationMode,
    contract_status: contractStatus,
    used_snapshot_rates: usedSnapshotRates,
    currency: currencyId || "BRL",
    ptax_source: isUSD ? "BCB" : null,
    ptax_series_id: ptaxSeriesId, // PHASE 2.6
    cdi_series_id: cdiSeriesId,   // PHASE 2.6
    rounding_policy: ROUNDING_POLICY.description,
    rounding_config: {
      method: ROUNDING_POLICY.method,
      money_decimals: ROUNDING_POLICY.money_decimals,
      percent_decimals: ROUNDING_POLICY.percent_decimals,
      exchange_decimals: ROUNDING_POLICY.exchange_decimals,
      stage_rounding: ROUNDING_POLICY.stage_rounding
    },
    projected_rates_metadata: projectedRatesUsed ? {
      projected_rates_used: true,
      last_real_rate_date: lastRealRateDate,
      replicate_last_rate: true,
      rate_source: "PROJECTED"
    } : null,
    assumptions: [
      `Capitalização: ${effectiveGraceInterestBehavior}`,
      `Indexador: ${indexer}${indexer !== "NA" ? ` + ${indexerSpread}% a.a.` : ""}`,
      `Data base: ${operationDate}`,
      `Sistema: ${calculationSystem}`,
      totalInsurance > 0 ? `Seguros: R$ ${totalInsurance.toFixed(2)} total` : null,
      projectedRatesUsed ? `⚠️ Taxas projetadas após ${lastRealRateDate}` : null
    ].filter(Boolean),
    rate_snapshot: {
      // 🔐 SNAPSHOT DE TAXAS (Imutabilidade Contratual)
      // Capturado no momento da aprovação do contrato
      // Garante que recálculo futuro use exatamente as mesmas taxas
      fixed_rate: fixedRate,
      indexer: indexer,
      indexer_spread: indexerSpread,
      cdi_rates_used: indexer === "CDI" ? cdiByType.CDI.map(r => ({
        rate_date: r.rate_date,
        annual_rate: r.annual_rate
      })) : null,
      selic_rates_used: indexer === "SELIC" ? cdiByType.SELIC.map(r => ({
        rate_date: r.rate_date,
        annual_rate: r.annual_rate
      })) : null,
      ptax_rates_used: isUSD ? effectiveExchangeRates.map(r => ({
        rate_date: r.rate_date,
        ptax_rate: r.ptax_rate,
        source: r.source
      })) : null,
      snapshot_created_at: new Date().toISOString(),
      snapshot_mode: simulationMode ? "SIMULATION" : "APPROVED"
    }
  };

  // ⚠️ VALIDAÇÃO CET vs NOMINAL (Alerta de Divergência)
  const cetForValidation = isUSD ? cetProjetadoBRL.cetAnnual : cetProjetadoBRL.cetAnnual;
  
  if (cetForValidation > 0 && cetForValidation < fixedRate * 0.95) {
    strategyWarnings.push({
      type: "CET_INCONSISTENCY",
      message: `⚠️ ALERTA: CET (${cetForValidation.toFixed(2)}% a.a.) é significativamente menor que a taxa nominal (${fixedRate.toFixed(2)}% a.a.). Verifique a configuração de taxas e seguros.`
    });
  }
  
  // ⚠️ ALERTA: Divergência CET USD vs BRL (Risco Cambial)
  if (isUSD && Math.abs(cetNominalUSD.cetAnnual - cetProjetadoBRL.cetAnnual) > 2) {
    strategyWarnings.push({
      type: "EXCHANGE_RATE_RISK",
      message: `⚠️ RISCO CAMBIAL: CET Nominal USD (${cetNominalUSD.cetAnnual.toFixed(2)}%) difere de CET Projetado BRL (${cetProjetadoBRL.cetAnnual.toFixed(2)}%). Cliente deve ser alertado sobre exposição cambial.`
    });
  }
  
  // 🔐 ETAPA 2: Gerar relatório de Shadow Calculation (se auditoria foi iniciada)
  const precisionReport = precisionAudit ? precisionAudit.generateReport() : { passed: true, status: "SKIP", message: "Auditoria desativada (enable_precision_audit=false)" };

  // 🔐 MUTATION GUARD: Hash do schedule ANTES da Etapa 3
  // Garantir que governança (integridade, disclosure, audit) não muta schedule
  // 🔐 ETAPA 3.1 HARDENING: Deep Clone para isolar snapshot estático
  let scheduleHashBefore = null;
  if (params.debug_mutation_guard) {
    // CLONE PROFUNDO: Garante que o Hash seja de um snapshot estático
    const snapshot = JSON.parse(JSON.stringify(schedule));
    
    const scheduleJSON = JSON.stringify(snapshot.map(r => ({
      parcela: r.parcela,
      dataVencimento: r.dataVencimento,
      // Forçar Number e toFixed(2) para eliminar dízimas de USD
      sdInicial: Number(r.sdInicial || 0).toFixed(2),
      sdFinal: Number(r.sdFinal || 0).toFixed(2),
      amortizacao: Number(r.amortizacao || 0).toFixed(2),
      prestacao: Number(r.prestacao || 0).toFixed(2)
    })));
    
    const encoder = new TextEncoder();
    const data = encoder.encode(scheduleJSON);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    scheduleHashBefore = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    console.log(`🔐 MUTATION GUARD: Schedule hash ANTES da Etapa 3: ${scheduleHashBefore}`);
  }

  // 🔐 ETAPA 3: GOVERNANÇA BANCÁRIA (Integridade + Auditoria + Risk Flags)
  
  // 3A. Validação de Integridade Financeira
  let integrityResult = null;
  if (enableIntegrityChecks) {
    const ScheduleIntegrityMod = getScheduleIntegrity();
    const integrityContext = {
      currency: currencyId || "BRL",
      principal_base: isUSD ? principal : principal,
      principal_brl: isUSD ? principal * ((effectiveExchangeRates && effectiveExchangeRates[0] && effectiveExchangeRates[0].ptax_rate) || 1) : principal,
      operation_value: operationValue,
      fixed_rate: fixedRate,
      indexer: indexer,
      indexer_spread: indexerSpread,
      calculation_system: calculationSystem,
      grace_interest_behavior: effectiveGraceInterestBehavior,
      principal_grace_months: principalGraceMonths,
      interest_grace_months: interestGraceMonths,
      operation_date: operationDate,
      final_maturity_date: finalMaturityDate,
      is_usd: isUSD,
      exchange_rates: exchangeRates,
      exchange_lag: exchangeLag
    };
    integrityResult = ScheduleIntegrityMod.validateScheduleIntegrity(schedule, integrityContext);
    
    // Se fail_on_integrity_error e status === FAIL, lançar erro
    if (failOnIntegrityError && integrityResult.status === "FAIL") {
      throw new Error(
        `[INTEGRITY_ERROR] Validação de integridade financeira falhou: ${integrityResult.summary.message}. ` +
        `Detalhes: ${JSON.stringify(integrityResult.checks.filter(c => c.status === "FAIL").map(c => c.message))}`
      );
    }
  }
  
  // 3B. Governança de Precisão (a partir do precision_audit)
  let precisionGovernanceResult = null;
  if (precisionAudit) {
    const createPrecGovernance = getPrecisionGovernance();
    precisionGovernanceResult = createPrecGovernance(precisionReport);
    
    // Se fail_on_precision_error e status === FAIL, lançar erro
    if (failOnPrecisionError && precisionGovernanceResult.status === "FAIL") {
      throw new Error(
        `[PRECISION_ERROR] Governança de precisão falhou: ${precisionGovernanceResult.notes.join("; ")}. ` +
        `Máxima divergência: ${precisionGovernanceResult.max.rounded.toFixed(8)} no campo ${precisionGovernanceResult.max.field}.`
      );
    }
  }
  
  // 3C. Risk Flags (determinístico, somente leitura)
  const riskFlags = [];
  
  // ANATOCISM: carência com juros capitalizados
  if (effectiveGraceInterestBehavior === "CAPITALIZAR" && interestGraceMonths > 0) {
    riskFlags.push({
      flag: "ANATOCISM",
      severity: "MEDIUM",
      message: "Operação com juros capitalizados na carência. Verificar conformidade regulatória."
    });
  }
  
  // PROJECTED_RATES: se houver taxas projetadas
  if (projectedRatesUsed) {
    riskFlags.push({
      flag: "PROJECTED_RATES",
      severity: "MEDIUM",
      message: `Taxas projetadas após ${lastRealRateDate}. Contrato termina em período sem dados reais de mercado.`
    });
  }
  
  // EXCHANGE_RATE_RISK: para USD, CET nominal vs projetado
  if (isUSD && cetNominalUSD && cetProjetadoBRL) {
    const cetDiff = Math.abs(cetNominalUSD.cetAnnual - cetProjetadoBRL.cetAnnual);
    if (cetDiff > 2) {
      riskFlags.push({
        flag: "EXCHANGE_RATE_RISK",
        severity: "HIGH",
        message: `Divergência de CET entre USD (${cetNominalUSD.cetAnnual.toFixed(2)}%) e BRL (${cetProjetadoBRL.cetAnnual.toFixed(2)}%). Cliente exposto ao risco cambial.`
      });
    }
  }
  
  // PTAX_GAP: Diferenciar fallback scenarios (ETAPA 3.1 HARDENING)
  // 🔐 REFINAMENTO: Separar nearest-past (MEDIUM) vs no-rate-available (HIGH)
  let ptaxNearestPastUsed = false;
  let ptaxNoRateAvailable = false;
  
  if (isUSD && effectiveExchangeRates && effectiveExchangeRates.length > 0) {
    // Iterar parcelas e verificar tipo de fallback usado
    for (let i = 0; i < Math.min(3, schedule.length); i++) {
      const row = schedule[i];
      if (!row.ptax_rate) continue;
      
      // Buscar taxa desta parcela na tabela
      const targetDate = row.dataVencimento;
      const searchDate = new Date(targetDate);
      searchDate.setDate(searchDate.getDate() - exchangeLag);
      const searchStr = searchDate.toISOString().split('T')[0];
      
      // Verificar se encontrou exato ou usou fallback
      const exactMatch = effectiveExchangeRates.find(r => r.rate_date === searchStr);
      
      if (!exactMatch) {
        // Não encontrou taxa exata
        const hasPastRates = effectiveExchangeRates.some(r => r.rate_date < searchStr);
        const allRatesAreFuture = effectiveExchangeRates.every(r => r.rate_date > searchStr);
        
        if (hasPastRates) {
          // Cenário 1: Encontrou taxa anterior (nearest-past)
          ptaxNearestPastUsed = true;
        } else if (allRatesAreFuture) {
          // Cenário 2: Nenhuma taxa válida, usou lastRate "forçado" (projection)
          ptaxNoRateAvailable = true;
        }
      }
    }
  }
  
  // PTAX_NEAREST_PAST: Taxa anterior disponível (gap temporal, mas com histórico)
  if (isUSD && ptaxNearestPastUsed && !ptaxNoRateAvailable) {
    riskFlags.push({
      flag: "PTAX_NEAREST_PAST",
      severity: "MEDIUM",
      message: "Taxa PTAX veio de fallback (nearest-past). Contrato atravessa datas sem cotação exata no mercado."
    });
  }
  
  // PTAX_NO_RATE_AVAILABLE: Nenhuma taxa histórica válida (projeção forçada)
  if (isUSD && ptaxNoRateAvailable) {
    riskFlags.push({
      flag: "PTAX_NO_RATE_AVAILABLE",
      severity: "HIGH",
      message: "CRÍTICO: Nenhuma taxa PTAX válida para período. Sistema usou última taxa disponível (projeção forçada). Risco cambial elevado."
    });
  }
  
  // INTEGRITY_FAIL: se integridade falhou
  if (integrityResult && integrityResult.status === "FAIL") {
    riskFlags.push({
      flag: "INTEGRITY_FAIL",
      severity: "CRITICAL",
      message: `Validação de integridade falhou. ${integrityResult.summary.message}`
    });
  }
  
  // PRECISION_FAIL: se precisão falhou
  if (precisionGovernanceResult && precisionGovernanceResult.status === "FAIL") {
    riskFlags.push({
      flag: "PRECISION_FAIL",
      severity: "HIGH",
      message: `Validação de precisão falhou. ${precisionGovernanceResult.notes[0]}`
    });
  }
  
  // 3D. Disclosure Automático (determinístico, sem PII)
  const disclosureAutomated = {
    // Identificação do cálculo
    engine_version: ENGINE_VERSION,
    calculated_at: calculatedAt,
    
    // Valores de base (moeda contratual)
    principal_base: roundTo(isUSD ? principal : principal, 2),
    principal_base_currency: isUSD ? "USD" : "BRL",
    principal_brl: roundTo(isUSD ? principal * ((effectiveExchangeRates && effectiveExchangeRates[0] && effectiveExchangeRates[0].ptax_rate) || 1) : principal, 2),
    
    // Custos totais
    total_juros: roundTo(totalInterest, 2),
    total_pago: roundTo(totalPaid, 2),
    total_iof: roundTo(iofValue || 0, 2),
    total_encargo_garantia: roundTo(encargoGarantiaValue || 0, 2),
    total_taxas: roundTo(otherFees || 0, 2),
    total_seguros: roundTo(totalInsurance, 2),
    
    // Taxas efetivas (CET)
    cet_nominal: isUSD ? roundTo(cetNominalUSD.cetAnnual, 2) : roundTo(cetProjetadoBRL.cetAnnual, 2),
    cet_nominal_currency: isUSD ? "USD" : "BRL",
    cet_real_projetado: roundTo(cetProjetadoBRL.cetAnnual, 2),
    cet_real_projetado_currency: "BRL",
    
    // Taxa contratada
    taxa_nominal_anual: roundTo(fixedRate, 4),
    indexador: indexer !== "NA" ? indexer : null,
    spread_indexador: indexer !== "NA" ? roundTo(indexerSpread, 4) : null,
    
    // Informações de prazo
    total_parcelas: principalInstallments,
    total_meses: totalMonths,
    data_operacao: operationDate,
    data_vencimento: finalMaturityDate || (schedule.length > 0 ? schedule[schedule.length - 1].dataVencimento : null),
    
    // Riscos cambiais (se USD)
    currency_risk_text: isUSD 
      ? `Operação em USD. CET Nominal: ${cetNominalUSD.cetAnnual.toFixed(2)}% a.a. | CET Projetado em BRL: ${cetProjetadoBRL.cetAnnual.toFixed(2)}% a.a. Diferença: ${(cetProjetadoBRL.cetAnnual - cetNominalUSD.cetAnnual).toFixed(2)}pp (Risco Cambial)`
      : null,
    
    // Taxas projetadas
    projected_rates_used: projectedRatesUsed,
    last_real_rate_date: lastRealRateDate,
    
    // Comportamento de carência
    grace_interest_behavior: effectiveGraceInterestBehavior,
    interest_grace_months: interestGraceMonths,
    principal_grace_months: principalGraceMonths
  };
  
  // 3E. AuditLog (rastreabilidade jurídica)
  let auditLog = null;
  if (enableAuditLog) {
    const AuditLogMod = getAuditLog();
    const auditLogBuilder = new AuditLogMod.AuditLog();
    
    // Log de entrada
    auditLogBuilder.logCalculationStart({
      engineVersion: ENGINE_VERSION,
      engineBuildId: ENGINE_BUILD_ID,
      operationDate,
      operationValue,
      fixedRate,
      indexer,
      calculationSystem
    });
    
    // Log de cálculo
    auditLogBuilder.logCalculationComplete({
      schedule_length: schedule.length,
      total_principal: principal,
      total_interest: totalInterest,
      cet_annual: cetProjetadoBRL.cetAnnual,
      calculation_hash_instance: calculationHashInstance,  // Instance ID (único)
      calculation_hash_strict: calculationHashStrict      // Inputs fingerprint (determinístico)
    });
    
    // Log de validações
    if (integrityResult) {
      auditLogBuilder.logValidation({
        type: "INTEGRITY",
        status: integrityResult.status,
        checks_total: integrityResult.checks?.length || 0,
        checks_failed: integrityResult.checks?.filter(c => c.status === "FAIL")?.length || 0
      });
    }
    
    if (precisionGovernanceResult) {
      auditLogBuilder.logValidation({
        type: "PRECISION",
        status: precisionGovernanceResult.status,
        divergences_found: precisionGovernanceResult.totals?.divergences_found || 0,
        max_rounded_diff: precisionGovernanceResult.max?.rounded || 0
      });
    }
    
    // Gerar relatório
    auditLog = {
      engine_version: ENGINE_VERSION,
      engine_build_id: ENGINE_BUILD_ID,
      
      // 🔐 HASHES: Clarificação explícita
      calculation_hash_strict: calculationHashStrict,      // Determinístico (inputs fingerprint)
      calculation_hash_instance: calculationHashInstance,  // Único (com timestamp)
      
      calculated_at: calculatedAt,
      currency_base: isUSD ? "USD" : "BRL",
      rounding_policy: ROUNDING_POLICY.description,
      rate_snapshot_used: usedSnapshotRates,
      ptax_policy: isUSD ? { lag: exchangeLag, source: "BCB" } : null,
      integrity_status: integrityResult?.status || "SKIP",
      precision_governance_status: precisionGovernanceResult?.status || "SKIP",
      risk_flags_count: riskFlags.length,
      entries_count: auditLogBuilder.entries.length
    };
  }
  
  // 🔐 MUTATION GUARD: Hash do schedule DEPOIS da Etapa 3
  if (params.debug_mutation_guard && scheduleHashBefore) {
    // CLONE PROFUNDO: Garante que o Hash seja de um snapshot estático
    const snapshot = JSON.parse(JSON.stringify(schedule));
    
    const scheduleJSON = JSON.stringify(snapshot.map(r => ({
      parcela: r.parcela,
      dataVencimento: r.dataVencimento,
      // Forçar Number e toFixed(2) para eliminar dízimas de USD
      sdInicial: Number(r.sdInicial || 0).toFixed(2),
      sdFinal: Number(r.sdFinal || 0).toFixed(2),
      amortizacao: Number(r.amortizacao || 0).toFixed(2),
      prestacao: Number(r.prestacao || 0).toFixed(2)
    })));
    
    const encoder = new TextEncoder();
    const data = encoder.encode(scheduleJSON);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const scheduleHashAfter = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    
    console.log(`🔐 MUTATION GUARD: Schedule hash DEPOIS da Etapa 3: ${scheduleHashAfter}`);
    
    if (scheduleHashBefore !== scheduleHashAfter) {
      console.error(`🚨 MUTAÇÃO DETECTADA! Schedule foi alterado durante Etapa 3!`);
      throw new Error(`[MUTATION_GUARD] Schedule mutated during Stage 3 governance`);
    } else {
      console.log(`✅ MUTATION GUARD: Schedule intocado (hashes idênticos)`);
    }
  }
  
  return {
    principal: roundTo(principal, 2),
    schedule,
    totalJuros: totalInterest,
    totalPrestacao: totalPaid,
    
    // 🔐 DUAL-VIEW CET: Retrocompatibilidade + Novos Campos
    cet: cetProjetadoBRL.cetAnnual, // Retrocompatibilidade: sempre retorna CET projetado (mais conservador)
    cetAnnual: cetProjetadoBRL.cetAnnual,
    cetMonthly: cetProjetadoBRL.cetMonthly,
    tirEffective: cetProjetadoBRL.tirEffective,
    cetNominalUSD: isUSD ? cetNominalUSD : null,
    cetProjetadoBRL: cetProjetadoBRL,
    
    fixedRateNominal: roundTo(fixedRate, 4),
    hasNegativeAmortization: strategy instanceof PRICEStrategy ? strategy.hasNegativeAmortization : false,
    warnings: strategyWarnings,
    disclosure: regulatoryDisclosure,
    calculation_metadata,
    
    // 🔐 PHASE 2.6: Rates Metadata
    rates_metadata: ratesMetadata,
    
    // 🔐 ETAPA 2: Relatório de Auditoria de Precisão (Shadow Calculation)
    precision_audit: precisionReport,
    
    // 🔐 ETAPA 3: Governança Bancária (Integridade + Disclosure + Risk)
    integrity: integrityResult,
    precision_governance: precisionGovernanceResult,
    risk_flags: riskFlags,
    disclosure_automated: disclosureAutomated,
    audit_log: auditLog,
    
    // 🔐 DEBUG: Mutation guard info (apenas em dev, se solicitado)
    _mutation_guard: params.debug_mutation_guard ? {
      hash_before: scheduleHashBefore,
      status: scheduleHashBefore ? "PASSED" : "SKIPPED"
    } : undefined
  };
}

/**
 * @deprecated Use roundMoney() from ./roundMoney.js
 * Mantido apenas para retrocompatibilidade temporária
 */
function roundTo(num, decimals) {
  return roundMoney(num, decimals);
}

/**
 * 🔐 Calcula o CET (Custo Efetivo Total) conforme norma BACEN
 * Usa TIR (Taxa Interna de Retorno) mensal e anualiza com capitalização composta
 * 
 * REGRAS DE APROPRIAÇÃO (Norma BACEN):
 * - IOF Financiado e Taxas Financiadas: entram no SD mas são saída de caixa no momento zero
 * - Seguros embutidos: somados à parcela (recorrentes) no fluxo de caixa
 * - Desembolso líquido: Valor Operação - Taxas Antecipadas - IOF de Balcão
 * 
 * @param {number} operationValue - Valor total nominal da operação
 * @param {number} upFrontFees - Taxas antecipadas (não financiadas)
 * @param {number} financedFeesImpactOnCash - IOF/Taxas financiadas (saída de caixa momento zero)
 * @param {Array} schedule - Array de parcelas com campo prestacao
 * @param {number} insurancePerInstallment - Seguro embutido por parcela (MIP, DFI)
 * @param {string} currency - "USD" ou "BRL"
 * @param {boolean} convertedByPTAX - Se true, usa schedule convertido (CET Projetado BRL)
 * @param {number} projectedPTAX - Taxa PTAX projetada (última conhecida)
 * @returns {Object} { cetAnnual, cetMonthly, tirEffective }
 */
function calculateCET(
  operationValue, 
  upFrontFees, 
  financedFeesImpactOnCash, 
  schedule, 
  insurancePerInstallment = 0, 
  currency = "BRL",
  convertedByPTAX = false,
  projectedPTAX = 1
) {
  if (!schedule || schedule.length === 0) {
    return { cetAnnual: 0, cetMonthly: 0, tirEffective: 0 };
  }
  
  // 🔐 MOMENTO ZERO: Desembolso Líquido Real (Regime de Caixa)
  // = Valor Operação - Taxas Antecipadas - IOF Balcão - Taxas/IOF Financiados (impactam caixa agora)
  const netValue = operationValue - upFrontFees - financedFeesImpactOnCash;
  
  // 🔐 FLUXO DE CAIXA: Parcela + Seguros Embutidos (Recorrentes)
  const cashFlow = [netValue];
  
  schedule.forEach(item => {
    // Se for CET Projetado BRL (convertedByPTAX), usar prestação convertida
    // Se for CET Nominal USD, usar prestação em USD
    const prestacaoBase = convertedByPTAX ? item.prestacao : (item.prestacao_USD || item.prestacao);
    
    const totalOutflow = prestacaoBase + insurancePerInstallment;
    cashFlow.push(-totalOutflow);
  });
  
  // 🔐 FUNÇÃO VPL (Valor Presente Líquido)
  const getNPV = (rate) => {
    return cashFlow.reduce((acc, val, i) => acc + val / Math.pow(1 + rate, i), 0);
  };
  
  // 🔐 BUSCA TIR: Newton-Raphson (Método Iterativo Robusto)
  let rate = 0.01; // Chute inicial: 1% mensal
  let converged = false;
  
  for (let i = 0; i < 50; i++) {
    const npv = getNPV(rate);
    const df = cashFlow.reduce((acc, val, i) => acc - i * val / Math.pow(1 + rate, i + 1), 0);
    
    // Proteção contra divisão por zero
    if (Math.abs(df) < 1e-10) {
      console.warn(`⚠️ CET ${currency}: Derivada próxima de zero, convergência limitada`);
      break;
    }
    
    const newRate = rate - npv / df;
    
    // Verificar convergência
    if (Math.abs(newRate - rate) < 0.000001) {
      converged = true;
      rate = newRate;
      break;
    }
    
    // Proteção contra valores absurdos
    if (newRate < -0.5 || newRate > 10) {
      console.warn(`⚠️ CET ${currency}: Taxa fora do intervalo razoável, ajustando`);
      rate = Math.max(-0.1, Math.min(1, newRate));
    } else {
      rate = newRate;
    }
  }
  
  // ⚠️ Alerta se não convergiu
  if (!converged) {
    console.warn(`⚠️ CET ${currency}: Cálculo não convergiu completamente após 50 iterações`);
  }
  
  // 🔐 TIR MENSAL EFETIVA
  const tirMonthly = rate;
  
  // 🔐 ANUALIZAR: Capitalização Composta (Padrão Mercado)
  const cetAnnual = (Math.pow(1 + tirMonthly, 12) - 1) * 100;
  const cetMonthly = tirMonthly * 100;
  
  return {
    cetAnnual: roundTo(cetAnnual, 2),
    cetMonthly: roundTo(cetMonthly, 6),
    tirEffective: roundTo(tirMonthly * 100, 6),
    currency: currency,
    convertedByPTAX: convertedByPTAX
  };
}

/**
 * Retorna versão da estratégia de amortização
 */
function getStrategyVersion(calculationSystem) {
  const versions = {
    SAC: "1.0.0",
    PRICE: "1.0.0",
    AMERICANO: "1.0.0",
    BULLET: "1.0.0",
    PERCENTAGE_RESIDUAL: "1.0.0"
  };
  return versions[calculationSystem] || "1.0.0";
}

export { 
  addMonths, 
  nextBusinessDay, 
  daysBetween, 
  businessDaysBetween, 
  roundTo, 
  calculateCET, 
  roundMoney
};