import { Router } from "express";
import multer from "multer";
import { writeAudit } from "../../middleware/audit.js";
import { requireCanWrite, requireModule, requireOwner } from "../../middleware/rbac.js";
import * as guides from "./guides.js";
import * as taxTitles from "./taxTitles.js";

// Rotas próprias da Gestão Tributária (o cadastro de parcelamentos e parcelas segue no CRUD genérico).
export const taxRouter = Router();

taxRouter.use(requireModule("tax"));

// A guia fica em memória só até a validação (assinatura %PDF-), a leitura do texto e a gravação na pasta das
// guias — nunca passa pelo /api/uploads genérico.
const guideUpload = multer({
  storage: multer.memoryStorage(),
  // Navegadores mandam o nome do arquivo em UTF-8; o padrão (latin1) estraga acentos.
  defParamCharset: "utf8",
  limits: { fileSize: guides.MAX_GUIDE_FILE_BYTES, files: 1, fields: 10, fieldSize: 64 * 1024 },
}).single("file");

function readGuideFile(req, res, next) {
  guideUpload(req, res, (error) => {
    if (!error) return next();
    if (error.name !== "MulterError") return next(error);
    const limitMb = Math.round(guides.MAX_GUIDE_FILE_BYTES / (1024 * 1024));
    const known = {
      LIMIT_FILE_SIZE: [413, "FILE_TOO_LARGE", `A guia passa do tamanho máximo de ${limitMb} MB.`],
      LIMIT_FILE_COUNT: [400, "VALIDATION", "Envie um arquivo só: a guia desta parcela."],
      LIMIT_UNEXPECTED_FILE: [400, "VALIDATION", "Envie a guia no campo \"file\", um arquivo só."],
    };
    const [status, code, message] = known[error.code] || [400, "VALIDATION", "Não foi possível ler os dados enviados. Tente novamente."];
    const err = new Error(message);
    err.status = status;
    err.code = code;
    if (error.code === "LIMIT_FILE_SIZE") err.details = { max_bytes: guides.MAX_GUIDE_FILE_BYTES };
    next(err);
  });
}

// Download: "inline" abre no visualizador do navegador; ?download=1 baixa.
function sendPdf(req, res, file) {
  const asciiName = file.fileName.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || "guia.pdf";
  const disposition = req.query.download === "1" ? "attachment" : "inline";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(file.path);
}

function auditGuide(req, action, { ctx, guideId, before = null, after = null, payload }) {
  return writeAudit({
    req,
    action,
    resourceType: "TaxInstallmentGuide",
    resourceId: guideId,
    registro: guides.guideAuditRecord(ctx),
    before: guides.guideAuditSnapshot(before),
    after: guides.guideAuditSnapshot(after),
    payload: { installment_id: ctx.id, ...(payload || {}) },
  });
}

taxRouter.get("/guides", async (req, res, next) => {
  try {
    res.json(await guides.listCurrentGuides({ agreementId: req.query.agreement_id }));
  } catch (error) {
    next(error);
  }
});

taxRouter.get("/guides/:guideId/file", async (req, res, next) => {
  try {
    sendPdf(req, res, await guides.getGuideFile(req.params.guideId));
  } catch (error) {
    next(error);
  }
});

taxRouter.get("/installments/:installmentId/guide", async (req, res, next) => {
  try {
    const guide = await guides.getInstallmentGuide(req.params.installmentId);
    res.json({ ...guide, titulo_pagar: await taxTitles.getInstallmentTitle(req.params.installmentId) });
  } catch (error) {
    next(error);
  }
});

// Anexa (ou, com substituir=true, substitui) a guia: multipart com o PDF no campo "file", ou JSON/multipart com
// linha_digitavel. pagar_ate opcional nos dois casos.
taxRouter.post("/installments/:installmentId/guide", requireCanWrite, readGuideFile, async (req, res, next) => {
  try {
    const result = await guides.attachGuide(req.params.installmentId, { body: req.body || {}, file: req.file || null, user: req.user });
    await auditGuide(req, result.replaced ? "TAX_GUIDE_REPLACED" : "TAX_GUIDE_ATTACHED", {
      ctx: result.ctx,
      guideId: result.guide.id,
      before: result.replaced,
      after: result.guide,
      payload: result.replaced ? { guia_substituida: result.replaced.id } : undefined,
    });
    taxTitles.queueTaxTitleSync(result.afetadas);
    res.status(201).json({ guia: result.guide, substituida: result.replaced });
  } catch (error) {
    next(error);
  }
});

taxRouter.patch("/installments/:installmentId/guide", requireCanWrite, async (req, res, next) => {
  try {
    const result = await guides.correctGuide(req.params.installmentId, req.body || {}, req.user);
    await auditGuide(req, "TAX_GUIDE_CORRECTED", { ctx: result.ctx, guideId: result.guide.id, before: result.before, after: result.guide });
    taxTitles.queueTaxTitleSync(result.afetadas);
    res.json({ guia: result.guide });
  } catch (error) {
    next(error);
  }
});

taxRouter.delete("/installments/:installmentId/guide", requireCanWrite, async (req, res, next) => {
  try {
    const result = await guides.removeGuide(req.params.installmentId, req.user);
    await auditGuide(req, "TAX_GUIDE_REMOVED", { ctx: result.ctx, guideId: result.before.id, before: result.before });
    taxTitles.queueTaxTitleSync(result.afetadas);
    res.json({ removida: result.before });
  } catch (error) {
    next(error);
  }
});

taxRouter.post("/installments/:installmentId/guide/send-email", requireCanWrite, async (req, res, next) => {
  try {
    const result = await guides.sendGuideEmail(req.params.installmentId, req.body || {}, req.user);
    await auditGuide(req, result.error ? "TAX_GUIDE_EMAIL_FAILED" : "TAX_GUIDE_EMAIL_SENT", {
      ctx: result.ctx,
      guideId: result.guide.id,
      after: result.guide,
      payload: {
        destinatarios: result.send?.destinatarios || null,
        resultado: result.send?.resultado || (result.error ? "falhou" : "enviado"),
        recusados: result.send?.recusados?.length ? result.send.recusados : undefined,
      },
    });
    // O envio confere a guia de novo: se ela mudou de situação, o título acompanha.
    taxTitles.queueTaxTitleSync([result.ctx.id]);
    if (result.error) throw result.error;
    res.json({ envio: result.send });
  } catch (error) {
    if (error?.code === "TAX_GUIDE_SEND_LIMIT") res.setHeader("Retry-After", String(error.details.retry_after_seconds));
    next(error);
  }
});

taxRouter.get("/installments/:installmentId/guide/sends", async (req, res, next) => {
  try {
    res.json(await guides.listGuideSends(req.params.installmentId));
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Títulos a pagar de tributo (Contas a Pagar)
// ---------------------------------------------------------------------------

taxRouter.get("/payable-titles", async (req, res, next) => {
  try {
    res.json(await taxTitles.listTaxPayableTitles({
      situacao: req.query.situacao,
      agreementId: req.query.agreement_id,
      installmentId: req.query.installment_id,
    }));
  } catch (error) {
    next(error);
  }
});

// Mesma permissão dos títulos de empréstimo: integrar/estornar no ERP só o proprietário; consultar, quem escreve.
const OWNER_ERP_MESSAGE = "Apenas o proprietário pode integrar ou estornar no ERP.";

taxRouter.post("/payable-titles/consult", requireCanWrite, async (req, res, next) => {
  try {
    res.json(await taxTitles.consultTaxTitles({ req, onRequest: true }));
  } catch (error) {
    next(error);
  }
});

taxRouter.post("/payable-titles/:id/integrate", requireOwner(OWNER_ERP_MESSAGE), async (req, res, next) => {
  try {
    res.json(await taxTitles.integrateTaxTitle(req.params.id, { req }));
  } catch (error) {
    next(error);
  }
});

taxRouter.post("/payable-titles/:id/consult", requireCanWrite, async (req, res, next) => {
  try {
    res.json(await taxTitles.consultTaxTitle(req.params.id, { req, strict: true }));
  } catch (error) {
    next(error);
  }
});

taxRouter.post("/payable-titles/:id/confirm-absence", requireOwner(OWNER_ERP_MESSAGE), async (req, res, next) => {
  try {
    res.json(await taxTitles.confirmTaxTitleAbsence(req.params.id, { req }));
  } catch (error) {
    next(error);
  }
});
