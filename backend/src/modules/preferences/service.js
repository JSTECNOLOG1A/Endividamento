import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { writeAudit } from "../../middleware/audit.js";
import { getTenantScope, groupIdOrThrow, isPlatformAdmin } from "../tenants/access.js";
import { hasModule } from "../tenants/policy.js";

// Preferências pessoais do usuário dentro do cliente (tabela user_preferences): liga/desliga que só afeta quem
// escolheu. Sem linha gravada vale o padrão da chave. Chave indisponível para o perfil vale sempre desligada e não
// aparece na tela.
//
// - dashboard_tributos: vencimentos dos tributos junto dos bancários no Dashboard. Disponível para quem tem a
//   Gestão Tributária. Padrão ligado: o módulo já é liberado usuário a usuário, e a série vem identificada, separada
//   da dívida bancária — quem tem o módulo vê a dívida inteira sem precisar descobrir a opção.
// - alertas_tributarios: resumo diário por e-mail (tax/alerts.js). Disponível só para quem tem o módulo liberado no
//   cadastro de usuários do cliente (o master não recebe). Padrão ligado: é um aviso de prazo; desligar é escolha
//   de cada um.

export const PREFERENCE_KEYS = {
  dashboardTax: "dashboard_tributos",
  taxAlerts: "alertas_tributarios",
};

const DEFINITIONS = {
  [PREFERENCE_KEYS.dashboardTax]: {
    label: "Vencimentos dos tributos no Dashboard",
    padrao: true,
    available: () => hasModule("tax"),
  },
  [PREFERENCE_KEYS.taxAlerts]: {
    label: "Alertas de vencimento dos tributos por e-mail",
    padrao: true,
    available: () => !isPlatformAdmin() && getTenantScope()?.permissions?.tax === true,
  },
};

function httpError(status, message, code, details) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (details) err.details = details;
  return err;
}

function actorEmailOrThrow() {
  const email = String(getTenantScope()?.email || "").trim().toLowerCase();
  if (!email || email === "sistema") throw httpError(403, "Preferências são de um usuário. Faça login novamente.", "TENANT_REQUIRED");
  return email;
}

async function storedPreferences(groupId, email, client = pool) {
  const result = await client.query(
    `SELECT chave, ligado FROM user_preferences WHERE group_id = $1 AND user_email = $2`,
    [groupId, email]
  );
  return new Map(result.rows.map((row) => [row.chave, row.ligado]));
}

function present(stored) {
  return Object.fromEntries(Object.entries(DEFINITIONS).map(([key, def]) => {
    const disponivel = def.available();
    return [key, { disponivel, ligado: disponivel && (stored.has(key) ? stored.get(key) : def.padrao), padrao: def.padrao }];
  }));
}

/** Preferências do usuário logado, no cliente atual. */
export async function getMyPreferences() {
  const groupId = groupIdOrThrow();
  const email = actorEmailOrThrow();
  return { preferencias: present(await storedPreferences(groupId, email)) };
}

/**
 * Se a preferência vale ligada para o usuário logado. Chave indisponível para o perfil: desligada, sem ler o banco.
 */
export async function isPreferenceOn(key) {
  const def = DEFINITIONS[key];
  if (!def || !def.available()) return false;
  const stored = await storedPreferences(groupIdOrThrow(), actorEmailOrThrow());
  return stored.has(key) ? stored.get(key) : def.padrao;
}

const updateSchema = z.object(
  Object.fromEntries(Object.keys(DEFINITIONS).map((key) => [
    key,
    z.boolean({ invalid_type_error: "Use verdadeiro ou falso para ligar ou desligar a opção." }).optional(),
  ]))
).strict("Opção desconhecida. Só é possível alterar as preferências da tela.").refine(
  (data) => Object.values(data).some((value) => value !== undefined),
  { message: "Informe ao menos uma preferência para alterar." }
);

const onOff = (value) => (value ? "Ligado" : "Desligado");

function effective(stored, key) {
  return stored.has(key) ? stored.get(key) : DEFINITIONS[key].padrao;
}

/**
 * Liga/desliga preferências do usuário logado. Só as chaves disponíveis para o perfil. Todas as chaves do pedido são
 * gravadas juntas (ou nenhuma); a mudança fica na auditoria com o nome da opção e o antes/depois.
 * @param {object} body
 * @param {{ req?: object }} [options] requisição, para a auditoria saber quem mudou
 */
export async function updateMyPreferences(body, { req = null } = {}) {
  const parsed = updateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw httpError(400, issue?.message || "Dados inválidos.", "VALIDATION", { field: issue?.path?.[0] ?? issue?.keys?.[0] ?? null });
  }
  const groupId = groupIdOrThrow();
  const email = actorEmailOrThrow();
  const changes = Object.entries(parsed.data).filter(([, value]) => value !== undefined);
  const unavailable = changes.find(([key]) => !DEFINITIONS[key].available());
  if (unavailable) {
    throw httpError(403, "Seu perfil não tem acesso à Gestão Tributária, então esta opção não está disponível.", "MODULE_FORBIDDEN", { field: unavailable[0] });
  }

  const client = await pool.connect();
  let before;
  try {
    await client.query("BEGIN");
    // Trava as preferências do usuário neste cliente: dois pedidos ao mesmo tempo não se misturam no antes/depois.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`user-preferences:${groupId}:${email}`]);
    before = await storedPreferences(groupId, email, client);
    for (const [key, value] of changes) {
      await client.query(
        `INSERT INTO user_preferences (id, group_id, user_email, chave, ligado)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (group_id, user_email, chave) DO UPDATE SET ligado = EXCLUDED.ligado, updated_date = now()`,
        [randomUUID(), groupId, email, key, value]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const changed = changes.filter(([key, value]) => effective(before, key) !== value);
  if (changed.length) {
    await writeAudit({
      req,
      action: "UPDATE",
      resourceType: "UserPreference",
      resourceId: email,
      rotina: "Preferências",
      registro: `Preferências de ${email}: ${changed.map(([key, value]) => `${DEFINITIONS[key].label} ${value ? "ligado" : "desligado"}`).join("; ")}`,
      before: Object.fromEntries(changed.map(([key]) => [DEFINITIONS[key].label, onOff(effective(before, key))])),
      after: Object.fromEntries(changed.map(([key, value]) => [DEFINITIONS[key].label, onOff(value)])),
    });
  }
  return getMyPreferences();
}

/**
 * E-mails (minúsculas) do cliente que desligaram a preferência. Para rotinas do sistema, que não têm usuário logado.
 */
export async function emailsWithPreferenceOff(groupId, key) {
  const result = await pool.query(
    `SELECT user_email FROM user_preferences WHERE group_id = $1 AND chave = $2 AND ligado = FALSE`,
    [groupId, key]
  );
  return new Set(result.rows.map((row) => row.user_email));
}
