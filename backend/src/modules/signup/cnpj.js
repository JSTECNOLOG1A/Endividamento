const CNPJ_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

export function formatCnpj(value) {
  const digits = digitsOnly(value).slice(0, 14);
  if (digits.length !== 14) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function checksum(digits, weights) {
  const sum = digits.reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCnpj(value) {
  const digits = digitsOnly(value);
  if (digits.length !== 14) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  const base = digits.slice(0, 12).split("");
  const d1 = checksum(base, CNPJ_WEIGHTS_1);
  const d2 = checksum([...base, String(d1)], CNPJ_WEIGHTS_2);
  return digits.slice(12) === `${d1}${d2}`;
}

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) out[key] = obj[key] ?? "";
  return out;
}

function joinAddress(parts) {
  return parts.filter(Boolean).join(", ");
}

function fromBrasilApi(data) {
  const cnpj = formatCnpj(data.cnpj);
  return {
    source: "brasilapi",
    cnpj,
    razao_social: data.razao_social || "",
    nome_fantasia: data.nome_fantasia || "",
    situacao: data.descricao_situacao_cadastral || "",
    data_abertura: data.data_inicio_atividade || "",
    natureza_juridica: data.natureza_juridica || "",
    porte: data.porte || data.descricao_porte || "",
    capital_social: data.capital_social ?? "",
    cnae: data.cnae_fiscal_descricao || "",
    cnae_codigo: data.cnae_fiscal != null ? String(data.cnae_fiscal) : "",
    logradouro: data.logradouro || "",
    numero: data.numero || "",
    complemento: data.complemento || "",
    bairro: data.bairro || "",
    municipio: data.municipio || "",
    uf: data.uf || "",
    cep: digitsOnly(data.cep),
    telefone: data.ddd_telefone_1 || "",
    email: data.email || "",
    endereco: joinAddress([
      [data.logradouro, data.numero].filter(Boolean).join(", "),
      data.complemento,
      data.bairro,
      [data.municipio, data.uf].filter(Boolean).join(" / "),
      data.cep,
    ]),
    qsa: Array.isArray(data.qsa) ? data.qsa : [],
  };
}

function fromReceitaWs(data) {
  const activity = Array.isArray(data.atividade_principal) ? data.atividade_principal[0] : null;
  return {
    source: "receitaws",
    cnpj: formatCnpj(data.cnpj),
    razao_social: data.nome || "",
    nome_fantasia: data.fantasia || "",
    situacao: data.situacao || "",
    data_abertura: data.abertura || "",
    natureza_juridica: data.natureza_juridica || "",
    porte: data.porte || "",
    capital_social: data.capital_social || "",
    cnae: activity?.text || "",
    cnae_codigo: activity?.code || "",
    logradouro: data.logradouro || "",
    numero: data.numero || "",
    complemento: data.complemento || "",
    bairro: data.bairro || "",
    municipio: data.municipio || "",
    uf: data.uf || "",
    cep: digitsOnly(data.cep),
    telefone: data.telefone || "",
    email: data.email || "",
    endereco: joinAddress([
      [data.logradouro, data.numero].filter(Boolean).join(", "),
      data.complemento,
      data.bairro,
      [data.municipio, data.uf].filter(Boolean).join(" / "),
      data.cep,
    ]),
    qsa: Array.isArray(data.qsa) ? data.qsa : [],
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  return { ok: response.ok, status: response.status, payload };
}

export async function lookupCnpj(value) {
  const cnpj = digitsOnly(value);
  if (!isValidCnpj(cnpj)) {
    throw httpError(400, "CNPJ inválido", "INVALID_CNPJ");
  }

  const brasil = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (brasil.ok && brasil.payload?.cnpj) {
    return fromBrasilApi(brasil.payload);
  }
  if (brasil.status === 404) {
    throw httpError(404, "CNPJ não encontrado na Receita Federal", "CNPJ_NOT_FOUND");
  }

  const receita = await fetchJson(`https://receitaws.com.br/v1/cnpj/${cnpj}`);
  if (receita.ok && receita.payload?.status === "OK") {
    return fromReceitaWs(receita.payload);
  }
  if (receita.payload?.status === "ERROR") {
    throw httpError(404, receita.payload.message || "CNPJ não encontrado na Receita Federal", "CNPJ_NOT_FOUND");
  }
  if (brasil.status === 429 || receita.status === 429) {
    throw httpError(429, "Consulta de CNPJ temporariamente indisponível. Tente novamente em instantes.", "CNPJ_RATE_LIMIT");
  }

  throw httpError(502, "Não foi possível consultar o CNPJ na Receita Federal", "CNPJ_LOOKUP_FAILED");
}

export function publicCompany(data) {
  return pick(data || {}, [
    "cnpj", "razao_social", "nome_fantasia", "situacao", "data_abertura",
    "natureza_juridica", "porte", "capital_social", "cnae", "cnae_codigo",
    "logradouro", "numero", "complemento", "bairro", "municipio", "uf", "cep",
    "telefone", "email", "endereco",
  ]);
}
