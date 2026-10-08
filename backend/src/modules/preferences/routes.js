import { Router } from "express";
import { getMyPreferences, updateMyPreferences } from "./service.js";

// Preferências pessoais do usuário logado no cliente atual. Qualquer perfil (inclusive só visualização) muda as
// próprias: não altera dado do cliente.
export const preferencesRouter = Router();

preferencesRouter.get("/", async (req, res, next) => {
  try {
    res.json(await getMyPreferences());
  } catch (error) {
    next(error);
  }
});

preferencesRouter.patch("/", async (req, res, next) => {
  try {
    res.json(await updateMyPreferences(req.body, { req }));
  } catch (error) {
    next(error);
  }
});
