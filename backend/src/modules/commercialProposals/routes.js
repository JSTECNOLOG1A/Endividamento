import { Router } from "express";
import multer from "multer";
import { writeAudit } from "../../middleware/audit.js";
import { requirePlatformAdmin } from "../../middleware/tenant.js";
import * as service from "./service.js";

export const commercialProposalsRouter = Router();

// Arquivo assinado fica em memória só até a validação (assinatura %PDF-) e a
// gravação na pasta das propostas — nunca passa pelo /api/uploads genérico.
const signedFileUpload = multer({
  storage: multer.memoryStorage(),
  // Navegadores mandam o nome do arquivo em UTF-8; o padrão (latin1) estraga
  // acentos e travessões (o travessão de "Proposta — Empresa" chegaria corrompido).
  defParamCharset: "utf8",
  limits: { fileSize: service.MAX_SIGNED_FILE_BYTES, files: 1, fields: 20, fieldSize: 64 * 1024 },
}).single("file");

function readSignedFile(req, res, next) {
  signedFileUpload(req, res, (error) => {
    if (!error) return next();
    if (error.name !== "MulterError") return next(error);
    const limitMb = Math.round(service.MAX_SIGNED_FILE_BYTES / (1024 * 1024));
    const known = {
      LIMIT_FILE_SIZE: [413, "FILE_TOO_LARGE", `O arquivo assinado passa do tamanho máximo de ${limitMb} MB.`],
      LIMIT_FILE_COUNT: [400, "VALIDATION", "Envie um único arquivo assinado."],
      LIMIT_UNEXPECTED_FILE: [400, "VALIDATION", "Envie o arquivo assinado no campo \"file\", um só."],
    };
    const [status, code, message] = known[error.code] || [400, "VALIDATION", "Não foi possível ler os dados enviados. Tente novamente."];
    const err = new Error(message);
    err.status = status;
    err.code = code;
    // O limite vai junto na resposta: a tela não precisa manter uma cópia
    // do número para explicar o erro.
    if (error.code === "LIMIT_FILE_SIZE") err.details = { max_bytes: service.MAX_SIGNED_FILE_BYTES };
    next(err);
  });
}

// Download: "inline" abre no visualizador do navegador; ?download=1 baixa.
function sendPdf(req, res, file) {
  const asciiName = file.fileName.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || "proposta.pdf";
  const disposition = req.query.download === "1" ? "attachment" : "inline";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(file.path);
}

function auditOutcome(req, action, { before, proposal }) {
  const outcome = {
    status: proposal.status,
    accepted_at: proposal.accepted_at,
    data_assinatura: proposal.data_assinatura,
    nome_assinante: proposal.nome_assinante,
    cargo_assinante: proposal.cargo_assinante,
    canal_aceite: proposal.canal_aceite,
    observacao_aceite: proposal.observacao_aceite,
    tem_arquivo_assinado: proposal.tem_arquivo_assinado,
    rejected_at: proposal.rejected_at,
    motivo_recusa: proposal.motivo_recusa,
  };
  return writeAudit({
    req,
    action,
    resourceType: "CommercialProposal",
    resourceId: proposal.id,
    rotina: "Proposta Comercial",
    registro: [proposal.numero, proposal.client_name].filter(Boolean).join(" — "),
    before: { status: before.status },
    after: Object.fromEntries(Object.entries(outcome).filter(([, value]) => value != null)),
    // Proposta comercial é dado da plataforma, não de cliente: mesmo em
    // sessão de suporte, o registro não entra na auditoria do cliente aberto.
    groupId: null,
  });
}

commercialProposalsRouter.use(requirePlatformAdmin);

commercialProposalsRouter.get("/", async (req, res, next) => {
  try {
    res.json(await service.list({
      q: req.query.q,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
    }));
  } catch (error) {
    next(error);
  }
});

// Antes de "/:id": senão "summary" seria lido como id de proposta.
commercialProposalsRouter.get("/summary", async (req, res, next) => {
  try {
    res.json(await service.summary({ de: req.query.de, ate: req.query.ate }));
  } catch (error) {
    next(error);
  }
});

commercialProposalsRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await service.getById(req.params.id));
  } catch (error) {
    next(error);
  }
});

commercialProposalsRouter.post("/", async (req, res, next) => {
  try {
    res.status(201).json(await service.create(req.body || {}, req.user));
  } catch (error) {
    next(error);
  }
});

commercialProposalsRouter.put("/:id", async (req, res, next) => {
  try {
    res.json(await service.update(req.params.id, req.body || {}, req.user));
  } catch (error) {
    next(error);
  }
});

commercialProposalsRouter.get("/:id/history", async (req, res, next) => {
  try {
    res.json(await service.listHistory(req.params.id));
  } catch (error) {
    next(error);
  }
});

commercialProposalsRouter.post("/:id/send-email", async (req, res, next) => {
  try {
    res.json(await service.sendByEmail(req.params.id, req.body || {}, req.user));
  } catch (error) {
    next(error);
  }
});

commercialProposalsRouter.post("/:id/accept", readSignedFile, async (req, res, next) => {
  try {
    const result = await service.accept(req.params.id, req.body || {}, req.file, req.user);
    await auditOutcome(req, "COMMERCIAL_PROPOSAL_ACCEPTED", result);
    res.json(result.proposal);
  } catch (error) {
    next(error);
  }
});

commercialProposalsRouter.post("/:id/reject", async (req, res, next) => {
  try {
    const result = await service.reject(req.params.id, req.body || {}, req.user);
    await auditOutcome(req, "COMMERCIAL_PROPOSAL_REJECTED", result);
    res.json(result.proposal);
  } catch (error) {
    next(error);
  }
});

commercialProposalsRouter.get("/:id/signed-file", async (req, res, next) => {
  try {
    sendPdf(req, res, await service.getSignedFile(req.params.id));
  } catch (error) {
    next(error);
  }
});

commercialProposalsRouter.get("/:id/sends/:sendId/file", async (req, res, next) => {
  try {
    sendPdf(req, res, await service.getSentFile(req.params.id, req.params.sendId));
  } catch (error) {
    next(error);
  }
});
