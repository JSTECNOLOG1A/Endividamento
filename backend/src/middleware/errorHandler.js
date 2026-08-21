import { logger } from "../logger.js";

export function errorHandler(error, req, res, _next) {
  // Erros do multer (upload de PDF) chegam sem `.status` e por padrão
  // caíam no branch genérico 500 "Erro interno" — inclusive o caso comum de
  // arquivo maior que o limite configurado, que merece uma mensagem clara
  // em vez de parecer um bug do servidor.
  if (error.name === "MulterError") {
    if (error.code === "LIMIT_FILE_SIZE") {
      error.status = 413;
      error.code = "FILE_TOO_LARGE";
      error.message = "Arquivo muito grande. Tamanho máximo: 50MB.";
    } else {
      error.status = 400;
    }
  }

  const status = error.status || 500;
  if (status >= 500) {
    logger.error({ err: error, requestId: req.requestId }, "erro interno");
  }
  res.status(status).json({
    error: status >= 500 ? "Erro interno" : error.message,
    code: error.code || (status >= 500 ? "INTERNAL" : "REQUEST"),
    request_id: req.requestId,
    ...(error.details ? { details: error.details } : {}),
  });
}
