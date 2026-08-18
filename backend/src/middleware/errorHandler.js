import { logger } from "../logger.js";

export function errorHandler(error, req, res, _next) {
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
