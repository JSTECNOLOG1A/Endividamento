import { pool } from "../../db/pool.js";
import { requireTenantContext, selectResourceForTenant } from "../tenants/scope.js";

// Regras de gravação dos parcelamentos de tributos (Gestão Tributária) quando chegam pelo CRUD genérico.
// O dado digitado à mão nunca pode parecer oficial: a procedência é sempre carimbada aqui, nunca vem do cliente.

export const TAX_ENTITIES = new Set(["TaxAgreement", "TaxInstallment"]);

export const TAX_NOT_FOUND = {
  TaxAgreement: "Parcelamento não encontrado",
  TaxInstallment: "Parcela não encontrada",
};

const MANUAL_ORIGIN = "manual";

const AGREEMENT_SPHERES = new Set(["federal", "estadual"]);
const RESERVED_SPHERES = new Set(["municipal"]);
const AGREEMENT_STATUSES = new Set(["ativo", "quitado", "rescindido", "suspenso"]);
const INSTALLMENT_STATUSES = new Set(["em_aberto", "paga_aguardando_reconhecimento", "reconhecida", "cancelada"]);
const PAID_STATUSES = new Set(["paga_aguardando_reconhecimento", "reconhecida"]);

const BRAZILIAN_STATES = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

const AGREEMENT_WRITABLE = [
  "entity_id", "esfera", "orgao", "uf", "modalidade", "tributo", "codigo_parcelamento", "data_adesao",
  "qtd_parcelas", "saldo_oficial", "saldo_data_base", "situacao", "ultima_conferencia", "observacoes",
];
const INSTALLMENT_WRITABLE = [
  "agreement_id", "numero_parcela", "vencimento", "valor", "situacao", "data_pagamento", "valor_pago", "observacoes",
];

const SHORT_TEXT_MAX = 200;
const LONG_TEXT_MAX = 4000;
const MONEY_MAX = 1e15;
const MAX_INSTALLMENTS = 1000;

// Nome do campo como o usuário vê na tela (sem artigo, para caber em "no campo <x>").
export const TAX_FIELD_LABELS = {
  entity_id: "empresa",
  esfera: "esfera",
  orgao: "órgão",
  uf: "UF",
  modalidade: "modalidade",
  tributo: "tributo",
  codigo_parcelamento: "número do parcelamento",
  data_adesao: "data de adesão",
  qtd_parcelas: "quantidade de parcelas",
  saldo_oficial: "saldo",
  saldo_data_base: "data-base do saldo",
  situacao: "situação",
  ultima_conferencia: "última conferência",
  observacoes: "observações",
  agreement_id: "parcelamento",
  numero_parcela: "número da parcela",
  vencimento: "vencimento",
  valor: "valor da parcela",
  data_pagamento: "data de pagamento",
  valor_pago: "valor pago",
};

// Órgãos sugeridos na tela: digitados com outra caixa, gravam na grafia canônica (evita o mesmo acordo duas vezes).
const CANONICAL_AGENCIES = new Map([
  ["receita federal", "Receita Federal"],
  ["pgfn", "PGFN"],
]);

function validationError(field, message, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.code = "TAX_VALIDATION";
  err.details = { field };
  return err;
}

function isBlank(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function parseText(field, value, max = SHORT_TEXT_MAX) {
  if (isBlank(value)) return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw validationError(field, `Preencha o campo ${TAX_FIELD_LABELS[field]} com um texto.`);
  }
  const text = String(value).trim();
  if (text.length > max) {
    throw validationError(field, `O campo ${TAX_FIELD_LABELS[field]} aceita no máximo ${max} caracteres.`);
  }
  return text;
}

// Texto que compõe a chave do parcelamento: sem espaço sobrando nas pontas nem repetido no meio.
function parseKeyText(field, value) {
  const text = parseText(field, value);
  return text === null ? null : text.replace(/\s+/g, " ");
}

function parseAgency(value) {
  const text = parseKeyText("orgao", value);
  return text === null ? null : CANONICAL_AGENCIES.get(text.toLowerCase()) || text;
}

function isCivilDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

// Data civil (AAAA-MM-DD), sem horário nem fuso: o vencimento de tributo é o dia do calendário, não um instante.
function parseDate(field, value) {
  if (isBlank(value)) return null;
  const text = typeof value === "string" ? value.trim() : "";
  if (!isCivilDate(text)) {
    throw validationError(field, `Informe uma data válida no campo ${TAX_FIELD_LABELS[field]}.`);
  }
  return text;
}

function parseNumber(field, value) {
  if (isBlank(value)) return null;
  if (typeof value !== "number" && typeof value !== "string") {
    throw validationError(field, `Informe um número válido no campo ${TAX_FIELD_LABELS[field]}.`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) >= MONEY_MAX) {
    throw validationError(field, `Informe um número válido no campo ${TAX_FIELD_LABELS[field]}.`);
  }
  return n;
}

function parseMoney(field, value, negativeMessage) {
  const n = parseNumber(field, value);
  if (n !== null && n < 0) throw validationError(field, negativeMessage);
  return n;
}

function parsePositiveInteger(field, value, message, max) {
  const n = parseNumber(field, value);
  if (n === null) return null;
  if (!Number.isInteger(n) || n <= 0 || (max && n > max)) throw validationError(field, message);
  return n;
}

function todayInBrazil() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function pickWritable(data, writable) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw validationError(null, "Os dados enviados são inválidos.");
  }
  const picked = {};
  for (const key of writable) {
    if (Object.prototype.hasOwnProperty.call(data, key)) picked[key] = data[key];
  }
  return picked;
}

async function loadEntityForAgreement(entityId, client) {
  try {
    return await selectResourceForTenant("company_entities", entityId, client);
  } catch (error) {
    if (error?.status === 404) {
      throw validationError("entity_id", "A empresa selecionada não foi encontrada neste grupo.");
    }
    throw error;
  }
}

async function loadAgreementForInstallment(agreementId, client) {
  try {
    return await selectResourceForTenant("tax_agreements", agreementId, client);
  } catch (error) {
    if (error?.status === 404) {
      throw validationError("agreement_id", "O parcelamento desta parcela não foi encontrado.");
    }
    throw error;
  }
}

function normalizeAgreementChanges(input) {
  const changes = {};
  if ("entity_id" in input) changes.entity_id = parseText("entity_id", input.entity_id);
  if ("esfera" in input) {
    const esfera = parseText("esfera", input.esfera);
    changes.esfera = esfera === null ? null : esfera.toLowerCase();
  }
  if ("orgao" in input) changes.orgao = parseAgency(input.orgao);
  if ("uf" in input) {
    const uf = parseText("uf", input.uf);
    changes.uf = uf === null ? null : uf.toUpperCase();
  }
  if ("modalidade" in input) changes.modalidade = parseKeyText("modalidade", input.modalidade);
  if ("tributo" in input) changes.tributo = parseKeyText("tributo", input.tributo);
  if ("codigo_parcelamento" in input) changes.codigo_parcelamento = parseKeyText("codigo_parcelamento", input.codigo_parcelamento);
  if ("data_adesao" in input) changes.data_adesao = parseDate("data_adesao", input.data_adesao);
  if ("qtd_parcelas" in input) {
    changes.qtd_parcelas = parsePositiveInteger(
      "qtd_parcelas",
      input.qtd_parcelas,
      `A quantidade de parcelas deve ser um número inteiro entre 1 e ${MAX_INSTALLMENTS}.`,
      MAX_INSTALLMENTS
    );
  }
  if ("saldo_oficial" in input) {
    changes.saldo_oficial = parseMoney("saldo_oficial", input.saldo_oficial, "O saldo do parcelamento não pode ser negativo.");
  }
  if ("saldo_data_base" in input) changes.saldo_data_base = parseDate("saldo_data_base", input.saldo_data_base);
  if ("situacao" in input) {
    const situacao = parseText("situacao", input.situacao);
    changes.situacao = situacao === null ? null : situacao.toLowerCase();
  }
  if ("ultima_conferencia" in input) changes.ultima_conferencia = parseDate("ultima_conferencia", input.ultima_conferencia);
  if ("observacoes" in input) changes.observacoes = parseText("observacoes", input.observacoes, LONG_TEXT_MAX);
  return changes;
}

function assertAgreementRules(merged) {
  if (!merged.entity_id) throw validationError("entity_id", "Selecione a empresa do parcelamento.");
  if (!merged.esfera) throw validationError("esfera", "Selecione a esfera do parcelamento: federal ou estadual.");
  if (RESERVED_SPHERES.has(merged.esfera)) {
    throw validationError(
      "esfera",
      "Parcelamento municipal ainda não está disponível. Cadastre apenas parcelamentos federais ou estaduais."
    );
  }
  if (!AGREEMENT_SPHERES.has(merged.esfera)) {
    throw validationError("esfera", "Esfera inválida. Escolha federal ou estadual.");
  }
  if (merged.esfera === "estadual") {
    if (!merged.uf) throw validationError("uf", "Informe a UF do parcelamento estadual.");
    if (!BRAZILIAN_STATES.has(merged.uf)) {
      throw validationError("uf", "UF inválida. Informe a sigla do estado, por exemplo SP.");
    }
  }
  if (!merged.orgao) {
    throw validationError("orgao", "Informe o órgão do parcelamento (por exemplo, Receita Federal, PGFN ou Secretaria da Fazenda).");
  }
  if (!merged.modalidade) throw validationError("modalidade", "Informe a modalidade do parcelamento.");
  if (!merged.codigo_parcelamento) throw validationError("codigo_parcelamento", "Informe o número do parcelamento.");
  if (!AGREEMENT_STATUSES.has(merged.situacao)) {
    throw validationError("situacao", "Situação do parcelamento inválida. Use ativo, quitado, rescindido ou suspenso.");
  }
  if (merged.saldo_oficial !== null && merged.saldo_oficial !== undefined && !merged.saldo_data_base) {
    throw validationError("saldo_data_base", "Informe a data-base do saldo do parcelamento.");
  }
  if (merged.ultima_conferencia && merged.ultima_conferencia > todayInBrazil()) {
    throw validationError("ultima_conferencia", "A data da última conferência não pode ser no futuro.");
  }
}

function normalizeInstallmentChanges(input) {
  const changes = {};
  if ("agreement_id" in input) changes.agreement_id = parseText("agreement_id", input.agreement_id);
  if ("numero_parcela" in input) {
    changes.numero_parcela = parsePositiveInteger(
      "numero_parcela",
      input.numero_parcela,
      "O número da parcela deve ser um número inteiro maior que zero."
    );
  }
  if ("vencimento" in input) changes.vencimento = parseDate("vencimento", input.vencimento);
  if ("valor" in input) changes.valor = parseMoney("valor", input.valor, "O valor da parcela não pode ser negativo.");
  if ("situacao" in input) {
    const situacao = parseText("situacao", input.situacao);
    changes.situacao = situacao === null ? null : situacao.toLowerCase();
  }
  if ("data_pagamento" in input) changes.data_pagamento = parseDate("data_pagamento", input.data_pagamento);
  if ("valor_pago" in input) {
    changes.valor_pago = parseMoney("valor_pago", input.valor_pago, "O valor pago não pode ser negativo.");
  }
  if ("observacoes" in input) changes.observacoes = parseText("observacoes", input.observacoes, LONG_TEXT_MAX);
  return changes;
}

function assertInstallmentRules(merged) {
  if (!merged.agreement_id) throw validationError("agreement_id", "Selecione o parcelamento desta parcela.");
  if (merged.numero_parcela === null || merged.numero_parcela === undefined) {
    throw validationError("numero_parcela", "Informe o número da parcela.");
  }
  if (!merged.vencimento) throw validationError("vencimento", "Informe o vencimento da parcela.");
  if (merged.valor === null || merged.valor === undefined) throw validationError("valor", "Informe o valor da parcela.");
  if (!INSTALLMENT_STATUSES.has(merged.situacao)) {
    throw validationError(
      "situacao",
      "Situação da parcela inválida. Use em aberto, paga aguardando reconhecimento, reconhecida ou cancelada."
    );
  }
  const hasPayment = Boolean(merged.data_pagamento) || (merged.valor_pago !== null && merged.valor_pago !== undefined);
  if (PAID_STATUSES.has(merged.situacao)) {
    if (!merged.data_pagamento) {
      throw validationError("data_pagamento", "Informe a data de pagamento para marcar a parcela como paga.");
    }
    if (merged.data_pagamento > todayInBrazil()) {
      throw validationError("data_pagamento", "A data de pagamento não pode ser no futuro.");
    }
  } else if (hasPayment) {
    const field = merged.data_pagamento ? "data_pagamento" : "valor_pago";
    const label = merged.situacao === "cancelada" ? "Parcela cancelada" : "Parcela em aberto";
    throw validationError(
      field,
      `${label} não pode ter data nem valor de pagamento. Apague esses campos ou marque a parcela como paga.`
    );
  }
}

/**
 * Monta a linha a gravar de um parcelamento ou parcela a partir do que o usuário enviou.
 * Só os campos editáveis passam; procedência, grupo e autoria são do servidor. Na edição, as regras valem
 * sobre o registro resultante (anterior + mudanças), não só sobre os campos enviados.
 */
export async function prepareTaxWrite(name, data, { previous = null, client = pool } = {}) {
  if (name === "TaxAgreement") return prepareAgreement(data, previous, client);
  if (name === "TaxInstallment") return prepareInstallment(data, previous, client);
  throw new Error(`Entidade fora da Gestão Tributária: ${name}`);
}

function sameMoney(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  return Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

// Saldo ou data-base trocados sem nova conferência: a conferência anterior não vale para o saldo novo.
function balanceChangedWithoutConference(changes, previous) {
  if (!previous || "ultima_conferencia" in changes) return false;
  const balanceChanged = "saldo_oficial" in changes && !sameMoney(changes.saldo_oficial, previous.saldo_oficial);
  const baseDateChanged = "saldo_data_base" in changes && (changes.saldo_data_base ?? null) !== (previous.saldo_data_base ?? null);
  return balanceChanged || baseDateChanged;
}

async function prepareAgreement(data, previous, client) {
  const changes = normalizeAgreementChanges(pickWritable(data, AGREEMENT_WRITABLE));
  if (balanceChangedWithoutConference(changes, previous)) changes.ultima_conferencia = null;
  const merged = { situacao: "ativo", ...(previous || {}), ...changes };
  if (merged.esfera === "federal") merged.uf = null;
  assertAgreementRules(merged);

  const row = previous ? { ...changes } : { ...merged };
  if (merged.esfera === "federal") row.uf = null;
  if (!previous || ("entity_id" in changes && changes.entity_id !== previous.entity_id)) {
    const company = await loadEntityForAgreement(merged.entity_id, client);
    row.entity_id = company.id;
    row.group_id = company.group_id;
  }
  row.origem_dado = MANUAL_ORIGIN;
  return row;
}

async function prepareInstallment(data, previous, client) {
  const changes = normalizeInstallmentChanges(pickWritable(data, INSTALLMENT_WRITABLE));
  if (previous && "agreement_id" in changes && changes.agreement_id !== previous.agreement_id) {
    throw validationError(
      "agreement_id",
      "Não é possível mover a parcela para outro parcelamento. Exclua a parcela e cadastre-a no parcelamento certo."
    );
  }
  const agreementId = previous ? previous.agreement_id : changes.agreement_id;
  delete changes.agreement_id;
  const merged = { situacao: "em_aberto", ...(previous || {}), ...changes, agreement_id: agreementId };
  assertInstallmentRules(merged);

  const row = previous ? { ...changes } : { ...merged };
  if (!previous) {
    const agreement = await loadAgreementForInstallment(merged.agreement_id, client);
    row.agreement_id = agreement.id;
    row.group_id = agreement.group_id;
  }
  row.origem_dado = MANUAL_ORIGIN;
  return row;
}

/**
 * Exclui o parcelamento e, por cascata do banco, as parcelas dele — numa transação que trava o parcelamento,
 * para que a contagem devolvida (e auditada) seja exatamente o que saiu.
 */
export async function deleteAgreementWithInstallments(id) {
  const groupId = requireTenantContext();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT id FROM tax_agreements WHERE id = $1 AND group_id = $2 FOR UPDATE`,
      [id, groupId]
    );
    if (!locked.rows[0]) {
      await client.query("ROLLBACK");
      return { deleted: false, installmentsDeleted: 0 };
    }
    const installments = await client.query(
      `SELECT count(*)::int AS total FROM tax_installments WHERE agreement_id = $1`,
      [id]
    );
    await client.query(`DELETE FROM tax_agreements WHERE id = $1 AND group_id = $2`, [id, groupId]);
    await client.query("COMMIT");
    return { deleted: true, installmentsDeleted: installments.rows[0].total };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
