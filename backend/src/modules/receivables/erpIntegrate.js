import { pool } from "../../db/pool.js";
import { decryptSecret } from "../integrations/crypto.js";
import { fetchErpJson } from "../integrations/erpConnection.js";
import * as integrationStore from "../integrations/store.js";
import { applyProtheusContext, isProtheusErp } from "../integrations/protheus.js";
import { fetchSm0Records, matchSm0ByEntity, resolveTitleBranch } from "../integrations/protheusScope.js";
import { resolveNatureForEntity } from "../payables/natureCode.js";
import { logger } from "../../logger.js";
import { groupIdOrThrow } from "../tenants/access.js";
import { selectByIds, selectEntitiesByIds } from "../tenants/scope.js";

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
  if (!value) return "";
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const compact = text.replace(/\D/g, "");
  if (compact.length < 8) return "";
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
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
      return `HTTP ${statusCode}: o job HTTP REST do Protheus quebrou. Compile FinRestTitulos, reinicie o job e não envie a empresa da entidade nos headers.`;
    }
    return text.slice(0, 220) || `HTTP ${statusCode}`;
  }
  if (typeof data === "object") {
    for (const key of ["errorMessage", "detailedMessage", "message", "error", "erro", "msg", "detail"]) {
      const value = data[key];
      if (typeof value !== "string") continue;
      const text = value.trim();
      if (!text || /^internal server error$/i.test(text)) continue;
      if (text.startsWith("{") && text.includes("message")) {
        try {
          const nested = JSON.parse(text);
          const inner = nested.detailedMessage || nested.message;
          if (typeof inner === "string" && inner.trim() && !/^internal server error$/i.test(inner)) {
            return inner.trim().slice(0, 220);
          }
        } catch {
          // mantém o texto original
        }
      }
      return text.slice(0, 220);
    }
  }
  if (statusCode >= 500) {
    return `HTTP ${statusCode}: o job HTTP REST do Protheus quebrou. Compile FinRestTitulos e reinicie o job.`;
  }
  return `HTTP ${statusCode}`;
}

async function setTitleErpStatus(id, erpStatus, message, extras = {}) {
  const integrado = erpStatus === "integrado" || erpStatus === "baixado";
  const params = [id, erpStatus, integrado, message ?? null];
  let sql = `UPDATE receivable_titles
     SET erp_status = $2,
         integrado_erp = $3,
         erp_mensagem = $4,
         integrado_erp_em = CASE
           WHEN $2 IN ('integrado', 'baixado') THEN COALESCE(integrado_erp_em, now())
           ELSE null
         END,
         updated_date = now()`;
  if (extras.filial != null) {
    sql += ", filial = $5, filial_origem = $6";
    params.push(extras.filial, extras.filialOrigem || "");
  }
  sql += " WHERE id = $1";
  await pool.query(sql, params);
}

export function buildErpReceivablePayload(title, entity, sm0Match = null, codes = null) {
  const emissao = formatProtheusDate(title.emissao);
  const vencimento = formatProtheusDate(title.vencimento);
  const se2 = codes || resolveTitleBranch(title, entity, sm0Match);
  const e2Filial = String(se2?.e2Filial || se2?.filial || title.filial || entity?.codigo_empresa || "").trim();
  const filialOrigem = String(se2?.filialOrigem || title.filial_origem || "").trim();
  const prefixo = padRight(title.prefixo || "", 3).trim();
  const numero = padLeft(title.titulo_numero || "", 9);
  const parcela = erpParcela(title.parcela);
  const tipo = padRight(title.tipo || "", 3).trim();
  const natureza = String(title.natureza || "").trim();
  const cliente = padLeft(title.cliente || "", 6);
  const loja = String(title.cliente_loja || "01").trim() || "01";
  const valor = Number(title.valor) || 0;
  return {
    filial: e2Filial,
    filOrig: filialOrigem,
    prefixo,
    numero,
    parcela,
    tipo,
    natureza,
    cliente,
    loja,
    emissao,
    vencimento,
    valor,
    historico: String(title.historico || "").slice(0, 40),
    moeda: 1,
  };
}

function actualSe2Filial(data) {
  return String(data?.filial || "").trim();
}

function filialMismatchMessage(expected, actual) {
  return `O Protheus gravou E1_FILIAL=${actual || "?"} (esperado ${expected}). O título existe no SE1 com a filial da sessão HTTP. Estorne na filial ${actual || "?"} ou recompile FinRestTitulos.`;
}

async function consultIncludedTitle({ linked, credential, ctx, body, includePath }) {
  const path = isProtheusErp(ctx.erpNome)
    ? applyProtheusContext(consultPathFromInclude(includePath), ctx)
    : consultPathFromInclude(includePath);
  return fetchErpJson({
    baseUrl: linked.integration.baseUrl,
    path,
    method: "POST",
    authType: linked.integration.authType,
    authHeader: linked.integration.authHeader,
    username: linked.integration.username,
    credential,
    timeoutSeconds: Math.max(linked.integration.timeoutSeconds || 30, 60),
    body: withReceivableAcao(body, "consultar"),
    ...ctx,
  });
}

function restJobContext(linked) {
  return {
    erpNome: linked.integration.erpNome,
    grupoEmpresas: linked.integration.grupoEmpresas || "01",
    empresa: linked.integration.empresa || "",
    filial: linked.integration.filial || "",
  };
}

async function loadLinkedReceivableEndpoint(cadastroKey = "titulos_receber") {
  const labels = {
    titulos_receber: "Títulos a receber",
    titulos_receber_extornar: "Estorno de títulos a receber",
    titulos_receber_consultar: "Consulta de títulos a receber",
  };
  let linked = await integrationStore.findLinkedCadastro(cadastroKey, "POST");
  if (!linked && cadastroKey.startsWith("titulos_receber")) {
    const pagarKey = cadastroKey.replace("receber", "pagar");
    const pagar = await integrationStore.findLinkedCadastro(pagarKey, "POST");
    if (pagar) {
      linked = {
        integration: pagar.integration,
        endpoint: {
          ...pagar.endpoint,
          path: String(pagar.endpoint.path || "").replace(/\/pagar/gi, "/receber"),
        },
      };
    }
  }
  if (linked?.endpoint?.path) {
    linked = {
      ...linked,
      endpoint: {
        ...linked.endpoint,
        path: receberPublishedPath(linked.endpoint.path),
      },
    };
  }
  if (!linked) {
    throw httpError(
      400,
      `Nenhum endpoint POST vinculado ao cadastro ${labels[cadastroKey] || cadastroKey}. Configure em Configurações > Integrações.`
    );
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

async function loadReceivableActionEndpoint(cadastroKey, derivePath) {
  const dedicated = await integrationStore.findLinkedCadastro(cadastroKey, "POST");
  if (dedicated) return loadLinkedReceivableEndpoint(cadastroKey);
  const fallback = await loadLinkedReceivableEndpoint("titulos_receber");
  return {
    ...fallback,
    linked: {
      ...fallback.linked,
      endpoint: {
        ...fallback.linked.endpoint,
        path: derivePath(fallback.linked.endpoint.path),
      },
    },
  };
}

export async function integrateReceivableTitles(payload = {}) {
  const ids = asIdList(payload.ids);
  if (!ids.length) throw httpError(400, "Selecione ao menos um título para integrar");

  const { linked, credential } = await loadLinkedReceivableEndpoint();
  const titlesResult = { rows: await selectByIds("receivable_titles", ids, { order: "ORDER BY vencimento ASC, parcela ASC" }) };
  if (!titlesResult.rows.length) throw httpError(400, "Nenhum título encontrado");

  const entityIds = [...new Set(titlesResult.rows.map((row) => row.entity_id))];
  const entitiesResult = { rows: await selectEntitiesByIds(entityIds) };
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
    if (title.erp_status === "baixado") {
      skipped += 1;
      results.push({ id: title.id, ok: false, skipped: true, message: "Já baixado no ERP" });
      continue;
    }
    if (title.integrado_erp || title.erp_status === "integrado") {
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
      const message = "Classifique a natureza antes de integrar";
      await setTitleErpStatus(title.id, "falha", message);
      results.push({ id: title.id, ok: false, message });
      continue;
    }
    if (!String(title.cliente || "").trim()) {
      failed += 1;
      const message = "Informe o cliente antes de integrar";
      await setTitleErpStatus(title.id, "falha", message);
      results.push({ id: title.id, ok: false, message });
      continue;
    }

    const entity = entityById.get(title.entity_id);
    if (!entity) {
      failed += 1;
      const message = "Entidade do título não encontrada";
      await setTitleErpStatus(title.id, "falha", message);
      results.push({ id: title.id, ok: false, message });
      continue;
    }

    const nature = await resolveNatureForEntity(title.natureza, entity);
    if (!nature) {
      failed += 1;
      const message = "Natureza deve ser o código ED_CODIGO do Protheus, não a descrição";
      await setTitleErpStatus(title.id, "falha", message);
      results.push({ id: title.id, ok: false, message });
      continue;
    }
    if (nature.codigo !== title.natureza) {
      title.natureza = nature.codigo;
      await pool.query(
        `UPDATE receivable_titles SET natureza = $2, updated_date = now() WHERE id = $1`,
        [title.id, nature.codigo]
      );
    }

    const resolved = sm0ByEntity.get(entity.id) || { match: null, reason: "cnpj_nao_encontrado" };
    const codes = resolveTitleBranch(title, entity, resolved.match);
    if (!codes) {
      failed += 1;
      const message = "Informe empresa e filial da entidade em Governança (M0_CODIGO e M0_CODFIL)";
      await setTitleErpStatus(title.id, "falha", message);
      results.push({ id: title.id, ok: false, message });
      continue;
    }

    await pool.query(
      `UPDATE receivable_titles SET filial = $2, filial_origem = $3, updated_date = now() WHERE id = $1`,
      [title.id, codes.e2Filial || codes.filial, codes.filialOrigem]
    );

    const ctx = restJobContext(linked);
    const path = isProtheusErp(ctx.erpNome)
      ? applyProtheusContext(linked.endpoint.path, ctx)
      : linked.endpoint.path;

    try {
      const body = buildErpReceivablePayload({ ...title, filial: codes.e2Filial || codes.filial, filial_origem: codes.filialOrigem }, entity, resolved.match, codes);
      if (!body.emissao || !body.vencimento) {
        failed += 1;
        const message = `Datas inválidas para o Protheus (emissão=${title.emissao || "vazia"}, vencimento=${title.vencimento || "vazio"})`;
        await setTitleErpStatus(title.id, "falha", message);
        results.push({ id: title.id, ok: false, message });
        continue;
      }
      logger.info({
        titleId: title.id,
        tabela: "SE1010",
        grupo: ctx.grupoEmpresas,
        filial: body.filial,
        filOrig: body.filOrig,
        prefixo: body.prefixo,
        numero: body.numero,
        parcela: body.parcela,
        tipo: body.tipo,
        natureza: body.natureza,
        cliente: body.cliente,
        emissao: body.emissao,
        vencimento: body.vencimento,
        valor: body.valor,
      }, "enviando título a receber ao ERP");
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
      const okRaw = erpAccepted(response.statusCode, response.data);
      let message = messageFromErp(response.statusCode, response.data, {
        username: linked.integration.username,
      });
      if (!okRaw && response.statusCode >= 500) {
        message = `${message} (SE1010 filial=${body.filial} filOrig=${body.filOrig})`;
      }
      let ok = okRaw;
      let actualFilial = actualSe2Filial(response.data);
      if (ok && actualFilial && actualFilial !== body.filial) {
        ok = false;
        message = filialMismatchMessage(body.filial, actualFilial);
      }
      if (!ok && ![401, 403, 404].includes(response.statusCode)) {
        try {
          const consulted = await consultIncludedTitle({
            linked,
            credential,
            ctx,
            body,
            includePath: path,
          });
          if (consulted.statusCode >= 200 && consulted.statusCode < 300 && consultEncontrado(consulted.data) === true) {
            actualFilial = actualSe2Filial(consulted.data) || actualFilial;
            if (actualFilial && actualFilial === body.filial) {
              ok = true;
              message = messageFromErp(consulted.statusCode, consulted.data, {
                username: linked.integration.username,
              });
            } else {
              message = filialMismatchMessage(body.filial, actualFilial);
            }
          }
        } catch (consultError) {
          logger.warn({ err: consultError, titleId: title.id }, "não foi possível conferir o SE1 após falha na inclusão");
        }
      }
      if (!ok) {
        logger.warn({
          titleId: title.id,
          statusCode: response.statusCode,
          message,
          body: previewErpBody(response.data),
        }, "ERP recusou título a receber");
      }
      if (ok) {
        integrated += 1;
        await setTitleErpStatus(title.id, "integrado", message, {
          filial: actualFilial || codes.e2Filial || codes.filial,
          filialOrigem: codes.filialOrigem,
        });
        results.push({ id: title.id, ok: true, message });
      } else {
        failed += 1;
        await setTitleErpStatus(title.id, "falha", message);
        results.push({ id: title.id, ok: false, message });
        if (response.statusCode >= 500) {
          logger.error({ path, statusCode: response.statusCode }, "integração abortada: job HTTP REST do Protheus quebrou");
          break;
        }
      }
    } catch (error) {
      failed += 1;
      const message = error.message || "Falha ao chamar o ERP";
      await setTitleErpStatus(title.id, "falha", message);
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

export function receberPublishedPath(path) {
  const raw = String(path || "").trim();
  const [pathname, query] = raw.split("?");
  const clean = String(pathname || "").replace(/\/+$/, "");
  const root = clean.replace(/\/(pagar|receber|estornarReceber|consultarReceber|clientesReceber)(\/.*)?$/i, "") || "/FinRestTitulos";
  const next = `${root}/receber`;
  return query ? `${next}?${query}` : next;
}

function withReceivableAcao(body, acao) {
  return { ...body, acao };
}

export function extornoPathFromInclude(path) {
  return receberPublishedPath(path);
}

export async function reverseReceivableTitles(payload = {}) {
  const ids = asIdList(payload.ids);
  if (!ids.length) throw httpError(400, "Selecione ao menos um título para estornar");

  const { linked, credential } = await loadReceivableActionEndpoint("titulos_receber_extornar", extornoPathFromInclude);
  let consultLinked = null;
  let consultCredential = credential;
  try {
    const consultEp = await loadReceivableActionEndpoint("titulos_receber_consultar", consultPathFromInclude);
    consultLinked = consultEp.linked;
    consultCredential = consultEp.credential;
  } catch (error) {
    logger.warn({ err: error }, "consulta prévia do estorno indisponível; o Protheus ainda valida movimentação");
  }
  const titlesResult = { rows: await selectByIds("receivable_titles", ids, { order: "ORDER BY vencimento ASC, parcela ASC" }) };
  if (!titlesResult.rows.length) throw httpError(400, "Nenhum título encontrado");

  const entityIds = [...new Set(titlesResult.rows.map((row) => row.entity_id))];
  const entitiesResult = { rows: await selectEntitiesByIds(entityIds) };
  const entityById = new Map(entitiesResult.rows.map((row) => [row.id, row]));

  let sm0Records = [];
  try {
    sm0Records = await fetchSm0Records(linked.integration, credential);
  } catch (error) {
    logger.warn({ err: error }, "falha ao ler SM0 no estorno; a filial do título será usada");
  }

  const sm0ByEntity = new Map();
  for (const entity of entitiesResult.rows) {
    sm0ByEntity.set(entity.id, matchSm0ByEntity(entity, sm0Records));
  }

  const path = linked.endpoint.path;
  const results = [];
  let reversed = 0;
  let failed = 0;
  let skipped = 0;

  for (const title of titlesResult.rows) {
    if (title.erp_status === "baixado") {
      skipped += 1;
      results.push({ id: title.id, ok: false, skipped: true, message: "Título baixado no ERP não pode ser estornado" });
      continue;
    }
    if (title.erp_status !== "integrado" && !title.integrado_erp) {
      skipped += 1;
      results.push({ id: title.id, ok: false, skipped: true, message: "Título ainda não foi ao ERP" });
      continue;
    }
    if (title.status !== "aberto") {
      skipped += 1;
      results.push({ id: title.id, ok: false, skipped: true, message: "Somente títulos abertos podem ser estornados" });
      continue;
    }
    if (Number(title.saldo) + 0.009 < Number(title.valor)) {
      skipped += 1;
      results.push({ id: title.id, ok: false, skipped: true, message: "Título possui movimentação e não pode ser estornado" });
      continue;
    }

    const entity = entityById.get(title.entity_id);
    if (!entity) {
      failed += 1;
      results.push({ id: title.id, ok: false, message: "Entidade do título não encontrada" });
      continue;
    }

    const resolved = sm0ByEntity.get(entity.id) || { match: null };
    const codes = resolveTitleBranch(title, entity, resolved.match);
    if (!codes) {
      failed += 1;
      results.push({ id: title.id, ok: false, message: "Informe empresa e filial da entidade em Governança" });
      continue;
    }

    const ctx = restJobContext(linked);
    const requestPath = isProtheusErp(ctx.erpNome) ? applyProtheusContext(path, ctx) : path;

    try {
      const body = withReceivableAcao(
        buildErpReceivablePayload({ ...title, filial: codes.e2Filial || codes.filial, filial_origem: codes.filialOrigem }, entity, resolved.match, codes),
        "estornar"
      );
      const consultBody = withReceivableAcao(body, "consultar");

      if (consultLinked) {
        const consultPath = isProtheusErp(ctx.erpNome)
          ? applyProtheusContext(consultLinked.endpoint.path, restJobContext({ integration: consultLinked.integration }))
          : consultLinked.endpoint.path;
        const consulted = await fetchErpJson({
          baseUrl: consultLinked.integration.baseUrl,
          path: consultPath,
          method: "POST",
          authType: consultLinked.integration.authType,
          authHeader: consultLinked.integration.authHeader,
          username: consultLinked.integration.username,
          credential: consultCredential,
          timeoutSeconds: Math.max(consultLinked.integration.timeoutSeconds || 30, 60),
          body: consultBody,
          ...restJobContext({ integration: consultLinked.integration }),
        });
        if (consulted.statusCode >= 500) {
          failed += 1;
          const message = messageFromErp(consulted.statusCode, consulted.data, {
            username: consultLinked.integration.username,
          });
          results.push({ id: title.id, ok: false, message });
          logger.error({ path: consultPath, statusCode: consulted.statusCode }, "estorno abortado: consulta quebrou o job HTTP REST");
          break;
        }
        if (consulted.statusCode !== 404 && consulted.statusCode >= 200 && consulted.statusCode < 300) {
          const check = titleAlteredInErp(title, consulted.data);
          if (check.alreadyDeleted) {
            reversed += 1;
            await setTitleErpStatus(title.id, "estornado", check.message || "Estornado no ERP");
            results.push({ id: title.id, ok: true, message: check.message || "Estornado no ERP" });
            continue;
          }
          if (!check.ok) {
            failed += 1;
            await pool.query(
              `UPDATE receivable_titles SET erp_mensagem = $2, updated_date = now() WHERE id = $1`,
              [title.id, check.message]
            );
            results.push({ id: title.id, ok: false, message: check.message });
            continue;
          }
        }
      }

      logger.info({
        titleId: title.id,
        filial: body.filial,
        filOrig: body.filOrig,
        prefixo: body.prefixo,
        numero: body.numero,
        parcela: body.parcela,
        path: requestPath,
      }, "estornando título a receber no ERP");
      const response = await fetchErpJson({
        baseUrl: linked.integration.baseUrl,
        path: requestPath,
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
        username: linked.integration.username,
      });
      if (response.statusCode === 404) {
        message = "O job HTTP REST não publicou /FinRestTitulos/receber. Confira o serviço no Protheus.";
      } else if (/ja existe/i.test(message) || /inclu[ií]do com sucesso/i.test(message)) {
        message = "O Protheus ainda está na versão antiga de /receber (só inclui). Compile finresttitulos.controller.prw e finresttitulos.services.prw e reinicie o job HTTP REST.";
      }
      if (ok) {
        reversed += 1;
        await setTitleErpStatus(title.id, "estornado", message || "Estornado no ERP");
        results.push({ id: title.id, ok: true, message: message || "Estornado no ERP" });
      } else {
        failed += 1;
        logger.warn({
          titleId: title.id,
          statusCode: response.statusCode,
          message,
          body: previewErpBody(response.data),
        }, "ERP recusou estorno de título a receber");
        await pool.query(
          `UPDATE receivable_titles SET erp_mensagem = $2, updated_date = now() WHERE id = $1`,
          [title.id, message]
        );
        results.push({ id: title.id, ok: false, message });
        if (response.statusCode >= 500) {
          logger.error({ path: requestPath, statusCode: response.statusCode }, "estorno abortado: job HTTP REST do Protheus quebrou");
          break;
        }
      }
    } catch (error) {
      failed += 1;
      const message = error.message || "Falha ao estornar no ERP";
      await pool.query(
        `UPDATE receivable_titles SET erp_mensagem = $2, updated_date = now() WHERE id = $1`,
        [title.id, message]
      );
      results.push({ id: title.id, ok: false, message });
    }
  }

  return {
    reversed,
    failed,
    skipped,
    total: titlesResult.rows.length,
    connection: linked.integration.nome,
    endpoint: path,
    results,
  };
}

function titleAlteredInErp(title, data) {
  if (!data || typeof data !== "object") {
    return { ok: false, message: "Não foi possível validar o título no Protheus" };
  }
  const encontrado = consultEncontrado(data);
  if (encontrado === false) {
    return { ok: true, alreadyDeleted: true, message: "Título já não existe no Protheus" };
  }
  if (encontrado == null) {
    return { ok: true, alreadyDeleted: false };
  }

  const situacao = String(data.situacao || "").trim().toLowerCase();
  const saldo = Number(data.saldo);
  const valor = Number(data.valor);
  if (situacao === "baixado" || (Number.isFinite(saldo) && saldo <= 0.009)) {
    return { ok: false, message: "Título baixado no Protheus não pode ser estornado" };
  }
  if (situacao === "parcial" || (Number.isFinite(saldo) && Number.isFinite(valor) && Math.abs(saldo - valor) > 0.009)) {
    return { ok: false, message: "Título possui movimentação no Protheus e não pode ser estornado" };
  }
  if (Number.isFinite(valor) && Math.abs(valor - Number(title.valor)) > 0.009) {
    return { ok: false, message: "Valor do título foi alterado no Protheus e não pode ser estornado" };
  }
  const natureza = String(data.natureza || "").trim();
  if (natureza && String(title.natureza || "").trim() && natureza !== String(title.natureza).trim()) {
    return { ok: false, message: "Natureza do título foi alterada no Protheus e não pode ser estornada" };
  }
  const vencimento = formatProtheusDate(data.vencimento);
  const localVenc = formatProtheusDate(title.vencimento);
  if (vencimento && localVenc && vencimento !== localVenc) {
    return { ok: false, message: "Vencimento do título foi alterado no Protheus e não pode ser estornado" };
  }
  return { ok: true, alreadyDeleted: false };
}

export function consultPathFromInclude(path) {
  return receberPublishedPath(path);
}

function isConsultFresh(title, staleMinutes) {
  if (!(staleMinutes > 0) || !title?.erp_consultado_em) return false;
  const ts = new Date(title.erp_consultado_em).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < staleMinutes * 60 * 1000;
}

function consultEncontrado(data) {
  if (!data || typeof data !== "object") return null;
  const raw = data.encontrado;
  if (raw === false || raw === 0 || raw === "0") return false;
  if (raw === true || raw === 1 || raw === "1") return true;
  if (typeof raw === "string") {
    const flag = raw.trim().toUpperCase();
    if (flag === ".F." || flag === "FALSE" || flag === "N") return false;
    if (flag === ".T." || flag === "TRUE" || flag === "S") return true;
  }
  const sit = String(data.situacao || "").trim().toLowerCase();
  if (sit.startsWith("nao_") || sit.startsWith("não_")) return false;
  if (sit === "aberto" || sit === "parcial" || sit === "baixado") return true;
  return null;
}

function patchFromConsult(title, data) {
  const encontrado = consultEncontrado(data);
  if (encontrado === false) {
    // Título não existe mais no Protheus — normalmente porque foi estornado
    // lá diretamente (fora do AllDebt). Mesma correção do lado de contas a
    // pagar (ver backend/src/modules/payables/erpIntegrate.js): antes só
    // deixava uma mensagem e mantinha erp_status="integrado" pra sempre,
    // travando o contrato indefinidamente.
    if (title.erp_status === "integrado" || title.integrado_erp) {
      return {
        erp_status: "estornado",
        integrado_erp: false,
        erp_mensagem: "Estornado no Protheus (não encontrado nesta consulta).",
      };
    }
    return {
      erp_mensagem: "Não localizado no Protheus nesta consulta. O título local foi mantido.",
    };
  }

  const situacao = String(data.situacao || "").trim().toLowerCase();
  const saldo = Number(data.saldo);
  const valor = Number(data.valor);
  const baixado = situacao === "baixado" || (Number.isFinite(saldo) && saldo <= 0.009);
  const vencimento = formatProtheusDate(data.vencimento) || null;
  const natureza = String(data.natureza || "").trim() || null;
  const filial = String(data.filial || "").trim() || null;
  const filialOrigem = String(data.filOrig || data.filial_origem || "").trim() || null;
  const baixa = formatProtheusDate(data.baixa);
  let message = "Aberto no Protheus";
  if (baixado) message = baixa ? `Baixado no Protheus em ${baixa}` : "Baixado no Protheus";
  else if (situacao === "parcial") message = "Parcialmente baixado no Protheus";

  return {
    saldo: Number.isFinite(saldo) ? saldo : null,
    valor: Number.isFinite(valor) ? valor : null,
    status: baixado ? "baixado" : "aberto",
    erp_status: baixado ? "baixado" : "integrado",
    integrado_erp: true,
    erp_mensagem: message,
    vencimento,
    natureza,
    filial,
    filialOrigem,
  };
}

function publicTitlePatch(row) {
  if (!row) return null;
  const day = (value) => {
    if (!value) return value;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  };
  return {
    saldo: row.saldo != null ? Number(row.saldo) : row.saldo,
    valor: row.valor != null ? Number(row.valor) : row.valor,
    status: row.status,
    erp_status: row.erp_status,
    integrado_erp: Boolean(row.integrado_erp),
    erp_mensagem: row.erp_mensagem,
    vencimento: day(row.vencimento),
    natureza: row.natureza,
    filial: row.filial,
    filial_origem: row.filial_origem,
    erp_consultado_em: row.erp_consultado_em,
    integrado_erp_em: row.integrado_erp_em,
  };
}

async function applyConsultPatch(id, patch) {
  const result = await pool.query(
    `UPDATE receivable_titles SET
        saldo = COALESCE($2::numeric, saldo),
        valor = COALESCE($3::numeric, valor),
        status = COALESCE($4, status),
        erp_status = COALESCE($5, erp_status),
        integrado_erp = COALESCE($6::boolean, integrado_erp),
        erp_mensagem = COALESCE($7, erp_mensagem),
        vencimento = COALESCE($8::date, vencimento),
        natureza = COALESCE($9, natureza),
        filial = COALESCE($10, filial),
        filial_origem = COALESCE($11, filial_origem),
        integrado_erp_em = CASE
          WHEN COALESCE($5, erp_status) IN ('integrado', 'baixado') THEN COALESCE(integrado_erp_em, now())
          WHEN COALESCE($5, erp_status) = 'estornado' THEN null
          ELSE integrado_erp_em
        END,
        erp_consultado_em = now(),
        updated_date = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      patch.saldo ?? null,
      patch.valor ?? null,
      patch.status ?? null,
      patch.erp_status ?? null,
      patch.integrado_erp ?? null,
      patch.erp_mensagem ?? null,
      patch.vencimento ?? null,
      patch.natureza ?? null,
      patch.filial ?? null,
      patch.filialOrigem ?? null,
    ]
  );
  return result.rows[0];
}

export async function refreshReceivableTitlesFromErp(payload = {}) {
  const ids = asIdList(payload.ids);
  const force = Boolean(payload.force);
  const staleMinutes = Number.isFinite(Number(payload.staleMinutes))
    ? Math.max(Number(payload.staleMinutes), 0)
    : 2;

  let linked;
  let credential;
  try {
    ({ linked, credential } = await loadReceivableActionEndpoint("titulos_receber_consultar", consultPathFromInclude));
  } catch (error) {
    if (!force && error.status === 400) {
      logger.warn({ err: error }, "consulta ERP ignorada: integração não configurada");
      return { consulted: 0, skipped: 0, unavailable: true, message: error.message, results: [] };
    }
    throw error;
  }

  const params = [groupIdOrThrow()];
  let sql = `SELECT * FROM receivable_titles
     WHERE group_id = $1 AND (integrado_erp IS TRUE OR erp_status IN ('integrado', 'baixado'))`;
  if (ids.length) {
    params.push(ids);
    sql += ` AND id = ANY($2::text[])`;
  }
  sql += ` ORDER BY vencimento ASC, parcela ASC`;

  const titlesResult = await pool.query(sql, params);
  if (!titlesResult.rows.length) {
    return { consulted: 0, skipped: 0, failed: 0, total: 0, results: [] };
  }

  const entityIds = [...new Set(titlesResult.rows.map((row) => row.entity_id))];
  const entitiesResult = { rows: await selectEntitiesByIds(entityIds) };
  const entityById = new Map(entitiesResult.rows.map((row) => [row.id, row]));

  // Mesma lógica do lado de contas a pagar (ver
  // backend/src/modules/payables/erpIntegrate.js): decide o que fazer com
  // um título estornado no ERP a partir do status atual do contrato.
  const contractIds = [...new Set(titlesResult.rows.map((row) => row.contract_id))];
  const contractsResult = await pool.query(
    `SELECT id, status FROM loan_contracts WHERE id = ANY($1::text[])`,
    [contractIds]
  );
  const contractStatusById = new Map(contractsResult.rows.map((row) => [row.id, row.status]));

  let sm0Records = [];
  try {
    sm0Records = await fetchSm0Records(linked.integration, credential);
  } catch (error) {
    logger.warn({ err: error }, "falha ao ler SM0 na consulta ERP; a filial do título será usada");
  }

  const sm0ByEntity = new Map();
  for (const entity of entitiesResult.rows) {
    sm0ByEntity.set(entity.id, matchSm0ByEntity(entity, sm0Records));
  }

  const path = linked.endpoint.path;
  const results = [];
  let consulted = 0;
  let failed = 0;
  let skipped = 0;

  for (const title of titlesResult.rows) {
    if (!force && isConsultFresh(title, staleMinutes)) {
      skipped += 1;
      results.push({ id: title.id, ok: true, skipped: true, message: "Consulta recente" });
      continue;
    }

    const entity = entityById.get(title.entity_id);
    if (!entity) {
      failed += 1;
      results.push({ id: title.id, ok: false, message: "Entidade do título não encontrada" });
      continue;
    }

    const resolved = sm0ByEntity.get(entity.id) || { match: null };
    const codes = resolveTitleBranch(title, entity, resolved.match);
    if (!codes) {
      failed += 1;
      results.push({ id: title.id, ok: false, message: "Informe empresa e filial da entidade em Governança" });
      continue;
    }

    const ctx = restJobContext(linked);
    const requestPath = isProtheusErp(ctx.erpNome) ? applyProtheusContext(path, ctx) : path;

    try {
      const body = withReceivableAcao(
        buildErpReceivablePayload(
          { ...title, filial: codes.e2Filial || codes.filial, filial_origem: codes.filialOrigem },
          entity,
          resolved.match,
          codes
        ),
        "consultar"
      );
      logger.info({
        titleId: title.id,
        filial: body.filial,
        filOrig: body.filOrig,
        prefixo: body.prefixo,
        numero: body.numero,
        parcela: body.parcela,
        path: requestPath,
      }, "consultando título a receber no ERP");
      const response = await fetchErpJson({
        baseUrl: linked.integration.baseUrl,
        path: requestPath,
        method: "POST",
        authType: linked.integration.authType,
        authHeader: linked.integration.authHeader,
        username: linked.integration.username,
        credential,
        timeoutSeconds: Math.max(linked.integration.timeoutSeconds || 30, 60),
        body,
        ...ctx,
      });

      if (response.statusCode === 404) {
        logger.warn({ path: requestPath }, "endpoint de consulta de títulos não publicado no Protheus");
        return {
          consulted,
          failed,
          skipped: skipped + (titlesResult.rows.length - consulted - failed - skipped),
          total: titlesResult.rows.length,
          unavailable: true,
          message: "O job HTTP REST não publicou /FinRestTitulos/receber. Confira o serviço no Protheus.",
          connection: linked.integration.nome,
          endpoint: path,
          results,
        };
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        failed += 1;
        const message = messageFromErp(response.statusCode, response.data, {
          username: linked.integration.username,
        });
        results.push({ id: title.id, ok: false, message });
        if (response.statusCode >= 500) {
          const remaining = titlesResult.rows.length - consulted - failed - skipped;
          skipped += Math.max(remaining, 0);
          logger.error({ path: requestPath, statusCode: response.statusCode }, "consulta ERP abortada: job HTTP REST do Protheus quebrou");
          break;
        }
        continue;
      }

      const encontrado = consultEncontrado(response.data);
      if (encontrado == null) {
        failed += 1;
        results.push({ id: title.id, ok: false, message: "Resposta de consulta do ERP sem situação do título" });
        continue;
      }

      const patch = patchFromConsult(title, response.data);

      // Estornado no ERP + contrato ainda aprovado: some daqui — a próxima
      // sincronização recria um título novo automaticamente. Ver comentário
      // completo em backend/src/modules/payables/erpIntegrate.js.
      if (patch.erp_status === "estornado" && contractStatusById.get(title.contract_id) === "aprovado") {
        await pool.query(`DELETE FROM receivable_titles WHERE id = $1`, [title.id]);
        consulted += 1;
        results.push({
          id: title.id,
          ok: true,
          encontrado,
          erp_status: "estornado",
          message: "Estornado no ERP — título removido, será regerado na próxima sincronização",
          removed: true,
        });
        continue;
      }

      const row = await applyConsultPatch(title.id, patch);
      consulted += 1;
      results.push({
        id: title.id,
        ok: true,
        encontrado,
        erp_status: row?.erp_status || patch.erp_status,
        message: patch.erp_mensagem,
        patch: publicTitlePatch(row),
      });
    } catch (error) {
      failed += 1;
      results.push({ id: title.id, ok: false, message: error.message || "Falha ao consultar o ERP" });
    }
  }

  return {
    consulted,
    failed,
    skipped,
    total: titlesResult.rows.length,
    connection: linked.integration.nome,
    endpoint: path,
    results,
  };
}
