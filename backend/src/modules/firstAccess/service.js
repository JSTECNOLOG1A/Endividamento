import { pool } from "../../db/pool.js";
import { writeAudit } from "../../middleware/audit.js";
import {
  CURRENT_ONBOARDING_VERSION,
  LEGAL_ACTIONS,
  LEGAL_TYPES,
} from "./constants.js";

function clientMeta(req) {
  return {
    ip: req?.ip || null,
    userAgent: req?.headers?.["user-agent"] || null,
  };
}

function tenantScope(req) {
  return {
    tenantId: req?.user?.tenant_id || req?.tenant?.id || null,
    groupId: req?.user?.group_id || req?.tenant?.group_id || null,
  };
}

export async function getActiveDocument(documentType) {
  const result = await pool.query(
    `SELECT id, document_type, version, title, content, content_url,
            published_at, effective_at, is_active,
            requires_acknowledgement, requires_acceptance, legal_basis
     FROM legal_documents
     WHERE document_type = $1 AND is_active = true
     ORDER BY effective_at DESC, published_at DESC
     LIMIT 1`,
    [documentType]
  );
  return result.rows[0] || null;
}

export async function getCurrentLegalDocuments() {
  const [privacy, terms, marketing] = await Promise.all([
    getActiveDocument(LEGAL_TYPES.PRIVACY_POLICY),
    getActiveDocument(LEGAL_TYPES.TERMS_OF_USE),
    getActiveDocument(LEGAL_TYPES.MARKETING_CONSENT),
  ]);
  return { privacy, terms, marketing };
}

async function latestAcceptance(userId, groupId, documentType) {
  const result = await pool.query(
    `SELECT id, document_type, document_version, action, accepted_at, legal_basis
     FROM legal_acceptances
     WHERE user_id = $1
       AND document_type = $2
       AND (
         ($3::text IS NULL AND group_id IS NULL)
         OR group_id = $3
       )
     ORDER BY accepted_at DESC
     LIMIT 1`,
    [userId, documentType, groupId]
  );
  return result.rows[0] || null;
}

function isSatisfied(doc, acceptance) {
  if (!doc) return true;
  if (!acceptance) return false;
  if (acceptance.document_version !== doc.version) {
    if (doc.requires_acceptance || doc.requires_acknowledgement) return false;
    return true;
  }
  if (doc.requires_acceptance) {
    return acceptance.action === LEGAL_ACTIONS.ACCEPTED;
  }
  if (doc.requires_acknowledgement) {
    return acceptance.action === LEGAL_ACTIONS.ACKNOWLEDGED
      || acceptance.action === LEGAL_ACTIONS.ACCEPTED;
  }
  return true;
}

export async function getLegalStatusForUser(userId, groupId) {
  const docs = await getCurrentLegalDocuments();
  const [privacyAcc, termsAcc, marketingAcc] = await Promise.all([
    latestAcceptance(userId, groupId, LEGAL_TYPES.PRIVACY_POLICY),
    latestAcceptance(userId, groupId, LEGAL_TYPES.TERMS_OF_USE),
    latestAcceptance(userId, groupId, LEGAL_TYPES.MARKETING_CONSENT),
  ]);

  const privacyOk = isSatisfied(docs.privacy, privacyAcc);
  const termsOk = isSatisfied(docs.terms, termsAcc);
  const marketingConsent = Boolean(
    marketingAcc
    && marketingAcc.action === LEGAL_ACTIONS.ACCEPTED
    && (!docs.marketing || marketingAcc.document_version === docs.marketing.version)
  );

  return {
    privacyPolicy: {
      version: docs.privacy?.version || null,
      title: docs.privacy?.title || null,
      acknowledged: privacyOk,
      pending: !privacyOk,
      requiresAcknowledgement: docs.privacy?.requires_acknowledgement === true,
      acceptedVersion: privacyAcc?.document_version || null,
    },
    terms: {
      version: docs.terms?.version || null,
      title: docs.terms?.title || null,
      accepted: termsOk,
      pending: !termsOk,
      requiresAcceptance: docs.terms?.requires_acceptance === true,
      acceptedVersion: termsAcc?.document_version || null,
    },
    marketing: {
      version: docs.marketing?.version || null,
      consent: marketingConsent,
    },
    requiredPending: !privacyOk || !termsOk,
    documents: {
      privacy: docs.privacy,
      terms: docs.terms,
      marketing: docs.marketing,
    },
  };
}

export async function getUserOnboardingRow(userId) {
  const result = await pool.query(
    `SELECT first_login_at, onboarding_shown_at, onboarding_completed_at,
            onboarding_skipped_at, onboarding_version
     FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

export function buildOnboardingPayload(row) {
  const shown = Boolean(row?.onboarding_shown_at);
  return {
    firstLoginAt: row?.first_login_at || null,
    tour: {
      shown,
      completed: Boolean(row?.onboarding_completed_at),
      skipped: Boolean(row?.onboarding_skipped_at),
      version: row?.onboarding_version || null,
      currentVersion: CURRENT_ONBOARDING_VERSION,
      shouldAutoStart: !shown,
    },
  };
}

export async function getFirstAccessState(req) {
  const userId = req.user.sub;
  const { groupId } = tenantScope(req);
  const [row, legal] = await Promise.all([
    getUserOnboardingRow(userId),
    getLegalStatusForUser(userId, groupId),
  ]);
  const onboarding = buildOnboardingPayload(row);
  return {
    ...onboarding,
    legal: {
      privacyPolicy: {
        version: legal.privacyPolicy.version,
        acknowledged: legal.privacyPolicy.acknowledged,
        pending: legal.privacyPolicy.pending,
        acceptedVersion: legal.privacyPolicy.acceptedVersion,
      },
      terms: {
        version: legal.terms.version,
        accepted: legal.terms.accepted,
        pending: legal.terms.pending,
        acceptedVersion: legal.terms.acceptedVersion,
      },
      marketing: {
        consent: legal.marketing.consent,
        version: legal.marketing.version,
      },
      requiredPending: legal.requiredPending,
    },
    gate: {
      needsLegal: legal.requiredPending,
      needsTour: !legal.requiredPending && onboarding.tour.shouldAutoStart,
      ready: !legal.requiredPending && !onboarding.tour.shouldAutoStart,
    },
  };
}

/** Idempotente: só grava first_login_at se ainda for null. */
export async function markFirstLoginIfNeeded(req, userId) {
  const result = await pool.query(
    `UPDATE users
     SET first_login_at = now(), updated_date = now()
     WHERE id = $1 AND first_login_at IS NULL
     RETURNING first_login_at`,
    [userId]
  );
  if (result.rowCount > 0) {
    await writeAudit({
      req,
      action: "USER_FIRST_LOGIN",
      resourceType: "User",
      resourceId: userId,
      rotina: "Primeiro acesso",
      registro: req.user?.email || userId,
      after: { first_login_at: result.rows[0].first_login_at },
    });
    return true;
  }
  return false;
}

/** Idempotente: registra onboarding_shown_at somente na primeira apresentação. */
export async function startOnboardingTour(req) {
  const userId = req.user.sub;
  const firstShow = await pool.query(
    `UPDATE users
     SET onboarding_shown_at = now(),
         onboarding_version = COALESCE(onboarding_version, $2),
         first_login_at = COALESCE(first_login_at, now()),
         updated_date = now()
     WHERE id = $1 AND onboarding_shown_at IS NULL
     RETURNING first_login_at, onboarding_shown_at, onboarding_completed_at,
               onboarding_skipped_at, onboarding_version`,
    [userId, CURRENT_ONBOARDING_VERSION]
  );

  if (firstShow.rowCount > 0) {
    const row = firstShow.rows[0];
    await writeAudit({
      req,
      action: "USER_ONBOARDING_STARTED",
      resourceType: "User",
      resourceId: userId,
      rotina: "Primeiro acesso",
      registro: req.user?.email || userId,
      after: {
        onboarding_shown_at: row.onboarding_shown_at,
        onboarding_version: row.onboarding_version,
      },
    });
    return buildOnboardingPayload(row);
  }

  const current = await getUserOnboardingRow(userId);
  return buildOnboardingPayload(current);
}

export async function completeOnboardingTour(req) {
  const userId = req.user.sub;
  const result = await pool.query(
    `UPDATE users
     SET onboarding_shown_at = COALESCE(onboarding_shown_at, now()),
         onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
         onboarding_version = $2,
         updated_date = now()
     WHERE id = $1
     RETURNING first_login_at, onboarding_shown_at, onboarding_completed_at,
               onboarding_skipped_at, onboarding_version`,
    [userId, CURRENT_ONBOARDING_VERSION]
  );
  const row = result.rows[0];
  await writeAudit({
    req,
    action: "USER_ONBOARDING_COMPLETED",
    resourceType: "User",
    resourceId: userId,
    rotina: "Primeiro acesso",
    registro: req.user?.email || userId,
    after: {
      onboarding_completed_at: row.onboarding_completed_at,
      onboarding_version: row.onboarding_version,
    },
  });
  return buildOnboardingPayload(row);
}

export async function skipOnboardingTour(req) {
  const userId = req.user.sub;
  const result = await pool.query(
    `UPDATE users
     SET onboarding_shown_at = COALESCE(onboarding_shown_at, now()),
         onboarding_skipped_at = COALESCE(onboarding_skipped_at, now()),
         onboarding_version = COALESCE(onboarding_version, $2),
         updated_date = now()
     WHERE id = $1
     RETURNING first_login_at, onboarding_shown_at, onboarding_completed_at,
               onboarding_skipped_at, onboarding_version`,
    [userId, CURRENT_ONBOARDING_VERSION]
  );
  const row = result.rows[0];
  await writeAudit({
    req,
    action: "USER_ONBOARDING_SKIPPED",
    resourceType: "User",
    resourceId: userId,
    rotina: "Primeiro acesso",
    registro: req.user?.email || userId,
    after: {
      onboarding_skipped_at: row.onboarding_skipped_at,
      onboarding_version: row.onboarding_version,
    },
  });
  return buildOnboardingPayload(row);
}

export async function recordLegalAcceptance(req, {
  documentType,
  documentVersion,
  action,
  source = "first_access",
}) {
  const userId = req.user.sub;
  const { tenantId, groupId } = tenantScope(req);
  const { ip, userAgent } = clientMeta(req);

  const docResult = await pool.query(
    `SELECT id, version, legal_basis, requires_acceptance, requires_acknowledgement
     FROM legal_documents
     WHERE document_type = $1 AND version = $2
     LIMIT 1`,
    [documentType, documentVersion]
  );
  const doc = docResult.rows[0];
  if (!doc) {
    const err = new Error("Documento legal não encontrado");
    err.status = 404;
    err.code = "LEGAL_DOC_NOT_FOUND";
    throw err;
  }

  const insert = await pool.query(
    `INSERT INTO legal_acceptances (
       tenant_id, group_id, user_id, document_type, document_version,
       document_id, action, legal_basis, ip_address, user_agent, source
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, document_type, document_version, action, accepted_at`,
    [
      tenantId,
      groupId,
      userId,
      documentType,
      documentVersion,
      doc.id,
      action,
      doc.legal_basis,
      ip,
      userAgent,
      source,
    ]
  );

  const auditAction = (() => {
    if (documentType === LEGAL_TYPES.PRIVACY_POLICY) return "PRIVACY_POLICY_ACKNOWLEDGED";
    if (documentType === LEGAL_TYPES.TERMS_OF_USE) return "TERMS_ACCEPTED";
    if (documentType === LEGAL_TYPES.MARKETING_CONSENT) {
      return action === LEGAL_ACTIONS.REVOKED
        ? "MARKETING_CONSENT_REVOKED"
        : "MARKETING_CONSENT_GRANTED";
    }
    return "LEGAL_ACCEPTANCE";
  })();

  await writeAudit({
    req,
    action: auditAction,
    resourceType: "LegalAcceptance",
    resourceId: insert.rows[0].id,
    rotina: "Privacidade",
    registro: `${documentType}:${documentVersion}`,
    after: {
      document_type: documentType,
      document_version: documentVersion,
      action,
      source,
    },
  });

  return insert.rows[0];
}

export async function acceptFirstAccessLegal(req, {
  privacyAcknowledged,
  termsAccepted,
  marketingConsent,
}) {
  if (!privacyAcknowledged || !termsAccepted) {
    const err = new Error("Política de Privacidade e Termos de Uso são obrigatórios");
    err.status = 400;
    err.code = "LEGAL_REQUIRED";
    throw err;
  }

  const docs = await getCurrentLegalDocuments();
  if (!docs.privacy || !docs.terms) {
    const err = new Error("Documentos legais ativos indisponíveis");
    err.status = 503;
    err.code = "LEGAL_UNAVAILABLE";
    throw err;
  }

  const results = [];
  results.push(await recordLegalAcceptance(req, {
    documentType: LEGAL_TYPES.PRIVACY_POLICY,
    documentVersion: docs.privacy.version,
    action: LEGAL_ACTIONS.ACKNOWLEDGED,
    source: "first_access",
  }));
  results.push(await recordLegalAcceptance(req, {
    documentType: LEGAL_TYPES.TERMS_OF_USE,
    documentVersion: docs.terms.version,
    action: LEGAL_ACTIONS.ACCEPTED,
    source: "first_access",
  }));

  if (marketingConsent === true && docs.marketing) {
    results.push(await recordLegalAcceptance(req, {
      documentType: LEGAL_TYPES.MARKETING_CONSENT,
      documentVersion: docs.marketing.version,
      action: LEGAL_ACTIONS.ACCEPTED,
      source: "first_access",
    }));
  }

  return getFirstAccessState(req);
}

export async function setMarketingConsent(req, enabled) {
  const docs = await getCurrentLegalDocuments();
  if (!docs.marketing) {
    const err = new Error("Documento de consentimento de marketing indisponível");
    err.status = 503;
    throw err;
  }
  await recordLegalAcceptance(req, {
    documentType: LEGAL_TYPES.MARKETING_CONSENT,
    documentVersion: docs.marketing.version,
    action: enabled ? LEGAL_ACTIONS.ACCEPTED : LEGAL_ACTIONS.REVOKED,
    source: "privacy_settings",
  });
  return getLegalStatusForUser(req.user.sub, tenantScope(req).groupId);
}

export async function getPrivacyDashboard(req) {
  const userId = req.user.sub;
  const { groupId, tenantId } = tenantScope(req);
  const legal = await getLegalStatusForUser(userId, groupId);
  const requests = await pool.query(
    `SELECT id, request_type, details, status, created_at, updated_at, resolution_notes
     FROM privacy_requests
     WHERE user_id = $1
       AND (
         ($2::text IS NULL AND group_id IS NULL)
         OR group_id = $2
       )
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId, groupId]
  );

  return {
    user: {
      id: userId,
      email: req.user.email,
      full_name: req.user.full_name,
    },
    tenant: { id: tenantId, group_id: groupId },
    legal: {
      privacyPolicy: legal.privacyPolicy,
      terms: legal.terms,
      marketing: legal.marketing,
    },
    rights: [
      { code: "ACCESS", label: "Solicitar acesso aos dados" },
      { code: "CORRECTION", label: "Solicitar correção" },
      { code: "PORTABILITY", label: "Solicitar portabilidade" },
      { code: "ERASURE", label: "Solicitar exclusão (quando juridicamente possível)" },
      { code: "INFORMATION", label: "Consultar informações sobre tratamento" },
    ],
    notices: [
      "Registros financeiros, contratos e auditoria podem ser retidos por obrigação legal ou regulatória.",
      "Solicitações de exclusão passam por análise e podem ser classificadas como não aplicáveis.",
    ],
    requests: requests.rows,
    documents: {
      privacy: legal.documents.privacy
        ? {
          version: legal.documents.privacy.version,
          title: legal.documents.privacy.title,
          content: legal.documents.privacy.content,
        }
        : null,
      terms: legal.documents.terms
        ? {
          version: legal.documents.terms.version,
          title: legal.documents.terms.title,
          content: legal.documents.terms.content,
        }
        : null,
    },
  };
}

export async function createPrivacyRequest(req, { requestType, details }) {
  const userId = req.user.sub;
  const { tenantId, groupId } = tenantScope(req);
  const result = await pool.query(
    `INSERT INTO privacy_requests (
       tenant_id, group_id, user_id, request_type, details, status
     ) VALUES ($1,$2,$3,$4,$5,'pending')
     RETURNING id, request_type, details, status, created_at`,
    [tenantId, groupId, userId, requestType, details || null]
  );
  await writeAudit({
    req,
    action: "PRIVACY_REQUEST_CREATED",
    resourceType: "PrivacyRequest",
    resourceId: result.rows[0].id,
    rotina: "Privacidade",
    registro: requestType,
    after: result.rows[0],
  });
  return result.rows[0];
}

/**
 * Garante que o usuário autenticado só leia aceites do próprio tenant/group.
 * Usado em testes de isolamento.
 */
export async function listAcceptancesForCurrentTenant(req) {
  const { groupId } = tenantScope(req);
  if (!groupId && !req.user?.platform_admin) {
    return [];
  }
  const result = await pool.query(
    `SELECT id, user_id, document_type, document_version, action, accepted_at, group_id, tenant_id
     FROM legal_acceptances
     WHERE group_id = $1
     ORDER BY accepted_at DESC
     LIMIT 200`,
    [groupId]
  );
  return result.rows;
}
