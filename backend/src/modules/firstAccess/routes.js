import { Router } from "express";
import { z } from "zod";
import {
  acceptFirstAccessLegal,
  completeOnboardingTour,
  createPrivacyRequest,
  getCurrentLegalDocuments,
  getFirstAccessState,
  getPrivacyDashboard,
  listAcceptancesForCurrentTenant,
  setMarketingConsent,
  skipOnboardingTour,
  startOnboardingTour,
} from "./service.js";
import { LEGAL_ACTIONS, LEGAL_TYPES } from "./constants.js";

export const meFirstAccessRouter = Router();
export const legalRouter = Router();

function parseOrThrow(schema, data) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const err = new Error(parsed.error.issues[0]?.message || "Payload inválido");
    err.status = 400;
    err.code = "VALIDATION";
    throw err;
  }
  return parsed.data;
}

meFirstAccessRouter.get("/onboarding", async (req, res, next) => {
  try {
    res.json(await getFirstAccessState(req));
  } catch (error) {
    next(error);
  }
});

meFirstAccessRouter.post("/onboarding/start", async (req, res, next) => {
  try {
    res.json(await startOnboardingTour(req));
  } catch (error) {
    next(error);
  }
});

meFirstAccessRouter.post("/onboarding/complete", async (req, res, next) => {
  try {
    res.json(await completeOnboardingTour(req));
  } catch (error) {
    next(error);
  }
});

meFirstAccessRouter.post("/onboarding/skip", async (req, res, next) => {
  try {
    res.json(await skipOnboardingTour(req));
  } catch (error) {
    next(error);
  }
});

meFirstAccessRouter.get("/privacy", async (req, res, next) => {
  try {
    res.json(await getPrivacyDashboard(req));
  } catch (error) {
    next(error);
  }
});

const consentSchema = z.object({
  marketing: z.boolean(),
});

meFirstAccessRouter.post("/consents", async (req, res, next) => {
  try {
    const body = parseOrThrow(consentSchema, req.body);
    const legal = await setMarketingConsent(req, body.marketing);
    res.json({
      marketing: { consent: legal.marketing.consent, version: legal.marketing.version },
    });
  } catch (error) {
    next(error);
  }
});

meFirstAccessRouter.post("/consents/revoke", async (req, res, next) => {
  try {
    const legal = await setMarketingConsent(req, false);
    res.json({
      marketing: { consent: legal.marketing.consent, version: legal.marketing.version },
    });
  } catch (error) {
    next(error);
  }
});

const privacyRequestSchema = z.object({
  requestType: z.enum(["ACCESS", "CORRECTION", "PORTABILITY", "ERASURE", "INFORMATION", "OTHER"]),
  details: z.string().max(4000).optional().nullable(),
});

meFirstAccessRouter.post("/privacy/requests", async (req, res, next) => {
  try {
    const body = parseOrThrow(privacyRequestSchema, req.body);
    res.status(201).json(await createPrivacyRequest(req, body));
  } catch (error) {
    next(error);
  }
});

legalRouter.get("/current", async (req, res, next) => {
  try {
    const docs = await getCurrentLegalDocuments();
    res.json({
      privacyPolicy: docs.privacy
        ? {
          version: docs.privacy.version,
          title: docs.privacy.title,
          content: docs.privacy.content,
          contentUrl: docs.privacy.content_url,
          requiresAcknowledgement: docs.privacy.requires_acknowledgement,
          legalBasis: docs.privacy.legal_basis,
        }
        : null,
      terms: docs.terms
        ? {
          version: docs.terms.version,
          title: docs.terms.title,
          content: docs.terms.content,
          contentUrl: docs.terms.content_url,
          requiresAcceptance: docs.terms.requires_acceptance,
          legalBasis: docs.terms.legal_basis,
        }
        : null,
      marketing: docs.marketing
        ? {
          version: docs.marketing.version,
          title: docs.marketing.title,
          content: docs.marketing.content,
          legalBasis: docs.marketing.legal_basis,
        }
        : null,
    });
  } catch (error) {
    next(error);
  }
});

const acceptanceSchema = z.object({
  privacyAcknowledged: z.boolean(),
  termsAccepted: z.boolean(),
  marketingConsent: z.boolean().optional().default(false),
});

legalRouter.post("/acceptances", async (req, res, next) => {
  try {
    const body = parseOrThrow(acceptanceSchema, req.body);
    const state = await acceptFirstAccessLegal(req, {
      privacyAcknowledged: body.privacyAcknowledged === true,
      termsAccepted: body.termsAccepted === true,
      marketingConsent: body.marketingConsent === true,
    });
    res.json(state);
  } catch (error) {
    next(error);
  }
});

/** Lista aceites do tenant atual (isolamento) — admin/debug/testes. */
legalRouter.get("/acceptances", async (req, res, next) => {
  try {
    res.json(await listAcceptancesForCurrentTenant(req));
  } catch (error) {
    next(error);
  }
});

export { LEGAL_ACTIONS, LEGAL_TYPES };
