import { pool } from "../../db/pool.js";
import { decryptSecret } from "../integrations/crypto.js";
import { fetchErpJson } from "../integrations/erpConnection.js";
import * as integrationStore from "../integrations/store.js";
import { applyProtheusContext, isProtheusErp } from "../integrations/protheus.js";
import { fetchSm0Records, matchSm0ByEntity, normalizeCnpjDigits, se2FilialFromSm0 } from "../integrations/protheusScope.js";
import { logger } from "../../logger.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function asIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => String(id || "").trim()).filter(Boolean))];
}

function formatProtheusDate(value) {
  const compact = String(value || "").slice(0, 10).replace(/\D/g, "");
  return /^\d{8}$/.test(compact) ? compact : "";
}

function padRight(value, size) {
  return String(value ?? "").trim().padEnd(size, " ").slice(0, size);
}

function padLeft(value, size) {
  const text = String(value ?? "").trim();
  if (!text) return "".padEnd(size, " ");
  const digits = text.replace(/\D/g, "");
  if (digits && digits.length <= size) return digits.padStart(size, "0");
  return text.slice(-size).padStart(size, " ");
}

function erpParcela(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "  ";
  return digits.slice(-2).padStart(2, "0");
}

function previewErpBody(data) {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 400);
}

function erpAccepted(statusCode, data) {
  if (statusCode < 200 || statusCode >= 300) return false;
  if (data && typeof data === "object") {
    if (data.success === false || data.ok === false) return false;
    const errText = data.error || data.erro || data.errorMessage || data.detailedMessage;
    if (typeof errText === "string" && errText.trim() && !/success|ok|gravado|incluido/i.test(errText)) {
      if (/erro|invalid|recus|fail|denied/i.test(errText)) return false;
    }
  }
  return true;
}

function messageFromErp(statusCode, data, ctx = {}) {
  if (statusCode === 403) {
    const empresa = ctx.empresa || "";
    const filial = ctx.filial || "";
    const user = ctx.username || "REST";
    return `Usuário ${user} sem acesso à empresa ${empresa || "?"} / filial ${filial || "?"} no Protheus. Liberar essa empresa/filial no job HTTP REST.`;
  }
  if (data == null) return `HTTP ${statusCode}`;
  if (typeof data === "string") {
    const detailed = data.match(/detailed message:\s*<\/b>\s*(?:&nbsp;)?([^<]+)/i);
    if (detailed?.[1]) {
      return detailed[1].replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
    }
    const text = data.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (/internal server error/i.test(text) && statusCode >= 500) {
      return `HTTP ${statusCode}: falha no serviço FinRestTitulos do Protheus`;
    }
    return text.slice(0, 220) || `HTTP ${statusCode}`;
  }
  if (typeof data === "object") {
    for (const key of ["errorMessage", "detailedMessage", "message", "error", "erro", "msg", "detail"]) {
      const value = data[key];
      if (typeof value !== "string") continue;
      const text = value.trim();
      if (!text || /^internal server error$/i.test(text)) continue;
      return text.slice(0, 220);
    }
  }
  return `HTTP ${statusCode}`;
}

export function buildErpTitlePayload(title, entity, sm0Match = null, codes = null) {
  const emissao = formatProtheusDate(title.emissao);
  const vencimento = formatProtheusDate(title.vencimento);
  const se2 = codes || se2FilialFromSm0(sm0Match, entity);
  const e2Filial = String(se2?.e2Filial || se2?.filial || se2?.empresa || title.filial || "").trim();
  const filialOrigem = String(se2?.filialOrigem || title.filial_origem || "").trim();
  const prefixo = padRight(title.prefixo || "", 3).trim();
  const numero = padLeft(title.titulo_numero || "", 9);
  const parcela = erpParcela(title.parcela);
  const tipo = padRight(title.tipo || "", 3).trim();
  const natureza = String(title.natureza || "").trim();
  const fornecedor = padLeft(title.fornecedor || "", 6);
  const loja = String(title.fornecedor_loja || "01").trim() || "01";
  const valor = Number(title.valor) || 0;
  return {
    E2_FILIAL: e2Filial,
    E2_FILORIG: filialOrigem,
    E2_PREFIXO: prefixo,
    E2_NUM: numero,
    E2_PARCELA: parcela,
    E2_TIPO: tipo,
    E2_NATUREZ: natureza,
    E2_FORNECE: fornecedor,
    E2_LOJA: loja,
    E2_NOMFOR: title.fornecedor_nome || "",
    E2_EMISSAO: emissao,
    E2_VENCTO: vencimento,
    E2_VENCREA: vencimento,
    E2_VENCORI: vencimento,
    E2_VALOR: valor,
    E2_MOEDA: 1,
    E2_HIST: title.historico || "",
    filial: e2Filial,
    filialOrigem: filialOrigem,
    filial_origem: filialOrigem,
    prefixo,
    numero,
    parcela,
    tipo,
    natureza,
    fornecedor,
    loja,
    emissao,
    vencimento,
    valor,
    historico: title.historico || "",
  };
}

async function loadLinkedPayableEndpoint() {
  const linked = await integrationStore.findLinkedCadastro("titulos_pagar", "POST");
  if (!linked) {
    throw httpError(400, "Nenhum endpoint POST vinculado ao cadastro Títulos a pagar. Configure em Configurações > Integrações.");
  }
  if (linked.integration.status !== "ativo") {
    throw httpError(400, `A conexão "${linked.integration.nome}" está inativa. Ative-a em Integrações.`);
  }
  const credRow = await integrationStore.findCredential(linked.integration.id);
  const credential = credRow?.credential_encrypted
    ? decryptSecret(credRow.credential_encrypted)
    : null;
  if (linked.integration.authType !== "none" && !credential) {
    throw httpError(400, "A conexão vinculada não possui credencial cadastrada.");
  }
  return { linked, credential };
}

export async function integratePayableTitles(payload = {}) {
  const ids = asIdList(payload.ids);
  if (!ids.length) throw httpError(400, "Selecione ao menos um título para integrar");

  const { linked, credential } = await loadLinkedPayableEndpoint();
  const titlesResult = await pool.query(
    `SELECT * FROM payable_titles WHERE id = ANY($1::text[]) ORDER BY vencimento ASC, parcela ASC`,
    [ids]
  );
  if (!titlesResult.rows.length) throw httpError(400, "Nenhum título encontrado");

  const entityIds = [...new Set(titlesResult.rows.map((row) => row.entity_id))];
  const entitiesResult = await pool.query(
    `SELECT * FROM company_entities WHERE id = ANY($1::text[])`,
    [entityIds]
  );
  const entityById = new Map(entitiesResult.rows.map((row) => [row.id, row]));

  let sm0Records = [];
  try {
    sm0Records = await fetchSm0Records(linked.integration, credential);
  } catch (error) {
    logger.warn({ err: error }, "falha ao ler SM0; a filial de origem usará o cadastro da entidade");
  }

  const sm0ByEntity = new Map();
  for (const entity of entitiesResult.rows) {
    sm0ByEntity.set(entity.id, matchSm0ByEntity(entity, sm0Records));
  }

  const results = [];
  let integrated = 0;
  let failed = 0;
  let skipped = 0;

  for (const title of titlesResult.rows) {
    if (title.integrado_erp) {
      skipped += 1;
      results.push({ id: title.id, ok: false, skipped: true, message: "Já integrado" });
      continue;
    }
    if (title.status !== "aberto") {
      skipped += 1;
      results.push({ id: title.id, ok: false, skipped: true, message: "Somente títulos abertos podem ser integrados" });
      continue;
    }
    if (!String(title.natureza || "").trim()) {
      failed += 1;
      results.push({ id: title.id, ok: false, message: "Classifique a natureza antes de integrar" });
      continue;
    }
    if (!String(title.fornecedor || "").trim()) {
      failed += 1;
      results.push({ id: title.id, ok: false, message: "Informe o fornecedor antes de integrar" });
      continue;
    }

    const entity = entityById.get(title.entity_id);
    if (!entity) {
      failed += 1;
      results.push({ id: title.id, ok: false, message: "Entidade do título não encontrada" });
      continue;
    }

    const resolved = sm0ByEntity.get(entity.id) || { match: null, reason: "cnpj_nao_encontrado" };
    const sm0HasCnpj = sm0Records.some((row) => row.cnpj);
    if (sm0HasCnpj && !resolved.match) {
      failed += 1;
      const cnpj = normalizeCnpjDigits(entity.document_number);
      const message = resolved.reason === "cnpj_ausente"
        ? "Informe o CNPJ da entidade para localizar a filial de origem no SM0"
        : `CNPJ ${cnpj || "da entidade"} não encontrado no cadastro de empresas do Protheus (SM0)`;
      await pool.query(
        `UPDATE payable_titles SET erp_mensagem = $2, updated_date = now() WHERE id = $1`,
        [title.id, message]
      );
      results.push({ id: title.id, ok: false, message });
      continue;
    }

    const codes = se2FilialFromSm0(resolved.match, entity);
    if (!codes) {
      failed += 1;
      const message = "Informe empresa e filial da entidade em Governança para montar a filial de origem (ex.: 03 e 01 → 0301)";
      await pool.query(
        `UPDATE payable_titles SET erp_mensagem = $2, updated_date = now() WHERE id = $1`,
        [title.id, message]
      );
      results.push({ id: title.id, ok: false, message });
      continue;
    }

    await pool.query(
      `UPDATE payable_titles SET filial = $2, filial_origem = $3, updated_date = now() WHERE id = $1`,
      [title.id, codes.filial, codes.filialOrigem]
    );
    await pool.query(
      `UPDATE payable_titles SET filial = $2, filial_origem = $3, updated_date = now()
       WHERE entity_id = $1 AND id <> $4
         AND (COALESCE(filial, '') = '' OR COALESCE(filial_origem, '') = '' OR length(regexp_replace(filial_origem, '[^0-9]', '', 'g')) <= 2)`,
      [entity.id, codes.filial, codes.filialOrigem, title.id]
    );

    const empresa = codes.empresa || linked.integration.empresa;
    const filial = codes.unidade || linked.integration.filial || codes.filial || "";
    const ctx = {
      erpNome: linked.integration.erpNome,
      grupoEmpresas: linked.integration.grupoEmpresas || "01",
      empresa,
      filial,
    };
    const path = isProtheusErp(ctx.erpNome)
      ? applyProtheusContext(linked.endpoint.path, ctx)
      : linked.endpoint.path;

    try {
      const body = buildErpTitlePayload({ ...title, filial: codes.filial, filial_origem: codes.filialOrigem }, entity, resolved.match, codes);
      logger.info({
        titleId: title.id,
        company: empresa,
        branch: filial,
        tabela: "SE2010",
        E2_FILIAL: body.E2_FILIAL,
        E2_FILORIG: body.E2_FILORIG,
        E2_PREFIXO: body.E2_PREFIXO,
        E2_NUM: body.E2_NUM,
        E2_PARCELA: body.E2_PARCELA,
        E2_TIPO: body.E2_TIPO,
        E2_NATUREZ: body.E2_NATUREZ,
        E2_FORNECE: body.E2_FORNECE,
        E2_EMISSAO: body.E2_EMISSAO,
        E2_VENCTO: body.E2_VENCTO,
        E2_VALOR: body.E2_VALOR,
      }, "enviando título a pagar ao ERP");
      const response = await fetchErpJson({
        baseUrl: linked.integration.baseUrl,
        path,
        method: "POST",
        authType: linked.integration.authType,
        authHeader: linked.integration.authHeader,
        username: linked.integration.username,
        credential,
        timeoutSeconds: Math.max(linked.integration.timeoutSeconds || 30, 60),
        body,
        ...ctx,
      });
      const ok = erpAccepted(response.statusCode, response.data);
      let message = messageFromErp(response.statusCode, response.data, {
        empresa,
        filial,
        username: linked.integration.username,
      });
      if (!ok && response.statusCode >= 500) {
        message = `${message} (SE2010 E2_FILIAL=${body.E2_FILIAL} E2_FILORIG=${body.E2_FILORIG})`;
      }
      if (!ok) {
        logger.warn({
          titleId: title.id,
          statusCode: response.statusCode,
          message,
          body: previewErpBody(response.data),
        }, "ERP recusou título a pagar");
      }
      if (ok) {
        integrated += 1;
        await pool.query(
          `UPDATE payable_titles
           SET integrado_erp = true, integrado_erp_em = now(),
               filial = $3, filial_origem = $4, erp_mensagem = $2, updated_date = now()
           WHERE id = $1`,
          [title.id, message, codes.filial, codes.filialOrigem]
        );
        results.push({ id: title.id, ok: true, message });
      } else {
        failed += 1;
        await pool.query(
          `UPDATE payable_titles SET erp_mensagem = $2, updated_date = now() WHERE id = $1`,
          [title.id, message]
        );
        results.push({ id: title.id, ok: false, message });
      }
    } catch (error) {
      failed += 1;
      const message = error.message || "Falha ao chamar o ERP";
      await pool.query(
        `UPDATE payable_titles SET erp_mensagem = $2, updated_date = now() WHERE id = $1`,
        [title.id, message]
      );
      results.push({ id: title.id, ok: false, message });
    }
  }

  return {
    integrated,
    failed,
    skipped,
    total: titlesResult.rows.length,
    connection: linked.integration.nome,
    endpoint: linked.endpoint.path,
    results,
  };
}
