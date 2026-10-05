import {
  assertCanWrite,
  assertModule,
  assertOwner,
  isViewer,
} from "../modules/tenants/policy.js";

export function requireModule(key) {
  return (req, res, next) => {
    try {
      assertModule(key);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireCanWrite(req, res, next) {
  assertCanWrite().then(() => next()).catch(next);
}

export function requireOwner(message) {
  return (req, res, next) => {
    assertOwner(message).then(() => next()).catch(next);
  };
}

export function requireNotViewer(req, res, next) {
  if (isViewer()) {
    res.status(403).json({ error: "Seu perfil é apenas de visualização.", code: "READ_ONLY" });
    return;
  }
  next();
}
