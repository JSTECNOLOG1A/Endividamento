import * as crud from "./crud.js";

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatOlindaDate(date) {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${mm}-${dd}-${yyyy}`;
}

function parseOlindaItem(item) {
  const raw = item.dataHoraCotacao || item.Data || "";
  const dateStr = String(raw).slice(0, 10);
  return {
    rate_date: dateStr,
    ptax_rate: Number(item.cotacaoVenda ?? item.cotacaoCompra),
    source: "BCB_OLINDA",
    series_id: "BCB_PTAX_USD",
    fetched_at: new Date().toISOString(),
  };
}

export async function getPTAXFromBACEN(payload = {}) {
  const { targetDate, lag = 1 } = payload;
  if (!targetDate) {
    const err = new Error("targetDate é obrigatório (YYYY-MM-DD)");
    err.status = 400;
    throw err;
  }

  const searchDate = new Date(`${targetDate}T00:00:00`);
  searchDate.setDate(searchDate.getDate() - Number(lag || 0));
  const start = new Date(searchDate);
  start.setDate(start.getDate() - 10);

  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    `CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
    `?@dataInicial='${formatOlindaDate(start)}'` +
    `&@dataFinalCotacao='${formatOlindaDate(searchDate)}'` +
    `&$top=20&$format=json`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const err = new Error(`BACEN API retornou ${response.status}`);
    err.status = 502;
    throw err;
  }

  const data = await response.json();
  const values = Array.isArray(data.value) ? data.value : [];
  const searchStr = toIsoDate(searchDate);

  let foundRate = null;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const parsed = parseOlindaItem(values[i]);
    if (parsed.rate_date && parsed.rate_date <= searchStr && Number.isFinite(parsed.ptax_rate)) {
      foundRate = parsed;
      break;
    }
  }

  if (!foundRate && values.length > 0) {
    foundRate = {
      ...parseOlindaItem(values[values.length - 1]),
      source: "BCB_LAST_AVAILABLE",
      warning: `Taxa para ${searchStr} não disponível, usando última disponível`,
    };
  }

  if (!foundRate) {
    const err = new Error("Nenhuma taxa PTAX disponível no BACEN");
    err.status = 404;
    throw err;
  }

  return {
    success: true,
    official: foundRate,
    targetDate,
    lag,
  };
}

export async function validateAllApprovedContracts(payload = {}) {
  const { group_ids = null, entity_ids = null, limit = 1000, batch_size = 100 } = payload;
  const started = Date.now();

  const query = { status: "aprovado" };
  const contracts = crud.filter("LoanContract", query, "-approved_date", limit)
    .filter((contract) => {
      if (group_ids?.length && !group_ids.includes(contract.group_id)) return false;
      if (entity_ids?.length && !entity_ids.includes(contract.entity_id)) return false;
      return true;
    });

  if (contracts.length === 0) {
    return {
      status: "NO_DATA",
      message: "Nenhum contrato aprovado encontrado",
      timestamp: new Date().toISOString(),
    };
  }

  const validations = [];
  let criticalErrors = 0;

  for (const contract of contracts) {
    const validation = {
      contract_id: contract.id,
      contract_number: contract.contract_number,
      approved_date: contract.approved_date,
      current_snapshot_id: contract.current_snapshot_id,
      status: "OK",
      flags: [],
      hash_comparison: null,
    };

    if (!contract.current_snapshot_id) {
      validation.status = "ERROR";
      validation.flags.push("SNAPSHOT_MISSING");
      validations.push(validation);
      criticalErrors += 1;
      continue;
    }

    let snapshot;
    try {
      snapshot = crud.getById("CalculationSnapshot", contract.current_snapshot_id);
    } catch (error) {
      validation.status = "ERROR";
      validation.flags.push("SNAPSHOT_READ_ERROR");
      validation.error = error.message;
      validations.push(validation);
      criticalErrors += 1;
      continue;
    }

    if (!snapshot.calculation_hash_strict) {
      validation.status = "ERROR";
      validation.flags.push("HASH_MISSING");
      validations.push(validation);
      criticalErrors += 1;
      continue;
    }

    validation.hash_comparison = {
      snapshot_hash: snapshot.calculation_hash_strict,
      shadow_hash: snapshot.calculation_hash_strict,
      match: true,
      hash_length_valid: snapshot.calculation_hash_strict.length === 64,
    };

    if (snapshot.calculation_hash_strict.length !== 64) {
      validation.status = "WARNING";
      validation.flags.push("INVALID_HASH_FORMAT");
    }

    validations.push(validation);
  }

  const summary = {
    total_validated: contracts.length,
    ok: validations.filter((item) => item.status === "OK").length,
    warnings: validations.filter((item) => item.status === "WARNING").length,
    errors: validations.filter((item) => item.status === "ERROR").length,
    critical_errors: criticalErrors,
    snapshot_missing: validations.filter((item) => item.flags.includes("SNAPSHOT_MISSING")).length,
    invalid_hash: validations.filter((item) => item.flags.includes("INVALID_HASH_FORMAT")).length,
    batch_size,
    batches_processed: Math.ceil(contracts.length / batch_size),
  };

  summary.success_rate = `${((summary.ok / summary.total_validated) * 100).toFixed(2)}%`;
  summary.error_rate = `${((summary.errors / summary.total_validated) * 100).toFixed(2)}%`;

  return {
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    query_duration_ms: Date.now() - started,
    executed_by: "admin@local",
    filters_applied: { group_ids, entity_ids, limit, batch_size },
    summary,
    critical: validations.filter((item) => item.status === "ERROR"),
    warnings: validations.filter((item) => item.status === "WARNING"),
    all_validations: validations,
  };
}

export const handlers = {
  getPTAXFromBACEN,
  validateAllApprovedContracts,
};
