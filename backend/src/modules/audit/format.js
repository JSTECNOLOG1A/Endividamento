const SECRET_KEYS = /password|secret|token|credential|authorization|hash|authheader/i;
const SKIP_DIFF = new Set([
  "updated_date",
  "created_date",
  "updatedAt",
  "createdAt",
  "extra_json",
  "schedule_data",
  "status_history",
  "exchange_rates",
  "audit_log_snapshot",
  "disclosure_snapshot",
  "risk_flags_snapshot",
  "runs",
]);

const ROTINA_BY_RESOURCE = {
  Group: "Governança",
  CompanyEntity: "Governança",
  Bank: "Governança",
  BankAccount: "Governança",
  Nature: "Governança",
  ChartOfAccount: "Governança",
  PayableTitle: "Contas a pagar",
  ReceivableTitle: "Contas a receber",
  LoanContract: "Contratos",
  CalculationSnapshot: "Contratos",
  CDIRate: "Indexadores",
  Holiday: "Indexadores",
  Currency: "Indexadores",
  Integration: "Integrações",
  ScheduledJob: "Agendamento",
  User: "Autenticação",
  Tenant: "Cadastro",
  TenantSignup: "Cadastro",
  Function: "Processamento",
};

const ACTION_LABELS = {
  CREATE: "Inclusão",
  BULK_CREATE: "Inclusão em lote",
  UPDATE: "Alteração",
  DELETE: "Exclusão",
  STATUS: "Alteração de status",
  LOGIN: "Login",
  LOGOUT: "Logout",
  CONTEXT_SWITCH: "Acesso a cliente",
  CONTEXT_ALL: "Visão de todos os clientes",
  RUN: "Execução",
  CALCULATE: "Cálculo",
  INTEGRATE: "Integração",
  REVERSE: "Estorno",
  CLASSIFY: "Classificação",
  CONSULT: "Consulta",
};

const LABEL_FIELDS = [
  "nome", "entity_name", "group_name", "bank_name", "contract_number",
  "full_name", "email", "codigo", "code", "descricao", "account_code", "account_name",
  "titulo_numero", "tarefaLabel", "tarefa", "label",
];

export function rotinaFor(resourceType, fallback) {
  return fallback || ROTINA_BY_RESOURCE[resourceType] || resourceType || "Sistema";
}

export function actionLabel(action) {
  return ACTION_LABELS[action] || action || "—";
}

export function sanitizeValue(value, key = "") {
  if (SECRET_KEYS.test(key)) return "[oculto]";
  if (value == null) return null;
  if (typeof value === "string") {
    if (value.length > 400) return `${value.slice(0, 400)}…`;
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const limit = key === "titulos" || key === "results" ? 100 : 20;
    return value.slice(0, limit).map((item, index) => sanitizeValue(item, String(index)));
  }
  if (typeof value === "object") return sanitizeRecord(value);
  return String(value).slice(0, 200);
}

export function sanitizeRecord(row) {
  if (!row || typeof row !== "object") return row ?? null;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (SECRET_KEYS.test(key)) {
      out[key] = "[oculto]";
      continue;
    }
    if (SKIP_DIFF.has(key) && value != null && typeof value === "object") {
      out[key] = "[conteúdo omitido]";
      continue;
    }
    out[key] = sanitizeValue(value, key);
  }
  return out;
}

function asText(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function diffRecords(before, after) {
  if (!before || !after) return [];
  const left = before && typeof before === "object" ? before : {};
  const right = after && typeof after === "object" ? after : {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => !SECRET_KEYS.test(key) && !SKIP_DIFF.has(key))
    .sort();
  const changes = [];
  for (const campo of keys) {
    const de = asText(left[campo]);
    const para = asText(right[campo]);
    if (de === para) continue;
    changes.push({ campo, de, para });
  }
  return changes;
}

export function registroFrom(resourceType, row, fallbackId) {
  if (!row || typeof row !== "object") return fallbackId || "—";
  for (const field of LABEL_FIELDS) {
    const value = row[field];
    if (value != null && String(value).trim()) {
      if (field === "titulo_numero") {
        return [row.prefixo, value, row.parcela].filter(Boolean).join(" ").trim();
      }
      if (field === "codigo" && row.descricao) return `${value} — ${row.descricao}`;
      return String(value).trim();
    }
  }
  if (row.prefixo && row.titulo_numero) {
    return [row.prefixo, row.titulo_numero, row.parcela].filter(Boolean).join(" ");
  }
  return fallbackId || row.id || resourceType || "—";
}

export function processingTypeFor(action, explicit, origem) {
  if (explicit) return explicit;
  if (origem === "automatico") return "automatico";
  if (action === "LOGIN" || action === "LOGOUT") return "autenticacao";
  if (["INTEGRATE", "REVERSE", "CLASSIFY", "CONSULT", "RUN", "CALCULATE"].includes(action)) {
    return "processamento";
  }
  return "manual";
}

export function summarizeResult(result) {
  if (result == null || typeof result !== "object") return result ?? null;
  const out = {};
  for (const [key, value] of Object.entries(result)) {
    if (Array.isArray(value) && value.length > 8) {
      out[key] = `${value.length} itens`;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const encoded = safeJsonLength(value);
      out[key] = encoded > 1500 ? "[resumo]" : summarizeResult(value);
      continue;
    }
    out[key] = sanitizeValue(value, key);
  }
  return out;
}

function safeJsonLength(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function clip(text, size = 90) {
  const value = String(text || "").trim();
  if (!value) return "—";
  return value.length > size ? `${value.slice(0, size)}…` : value;
}

export function sideSummary(action, before, after, changes, registro) {
  if (after?.resumo) {
    return { de: before ? clip(registro) : "—", para: clip(after.resumo) };
  }
  if (Array.isArray(after?.titulos) && after.titulos.length) {
    const labels = after.titulos.map((row) => row.label || row.id).filter(Boolean);
    return { de: "—", para: clip(labels.join(", ")) };
  }
  if (action === "CREATE" || action === "BULK_CREATE") {
    return { de: "—", para: clip(registro) };
  }
  if (action === "DELETE") {
    return { de: clip(registro), para: "excluído" };
  }
  if (changes.length) {
    const first = changes[0];
    const extra = changes.length > 1 ? ` (+${changes.length - 1})` : "";
    return {
      de: clip(`${first.campo}: ${first.de}`),
      para: clip(`${first.campo}: ${first.para}${extra}`),
    };
  }
  if (after?.message) return { de: "—", para: clip(after.message) };
  if (action === "LOGIN") return { de: "—", para: clip(registro || after?.email) };
  if (action === "LOGOUT") return { de: clip(registro), para: "—" };
  return {
    de: before ? "registro anterior" : "—",
    para: after ? "registro atual" : "—",
  };
}
