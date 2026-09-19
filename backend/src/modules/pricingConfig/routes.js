import { Router } from "express";
import { pool } from "../../db/pool.js";
import { requirePlatformAdmin } from "../../middleware/tenant.js";

export const pricingConfigRouter = Router();

pricingConfigRouter.use(requirePlatformAdmin);

const FIELDS = [
  "standard_implantacao", "standard_mensalidade", "standard_bloco",
  "pro_implantacao", "pro_mensalidade", "pro_bloco",
  "proii_implantacao", "proii_mensalidade", "proii_bloco",
  "cadastramento_valor",
];

pricingConfigRouter.get("/", async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM commercial_pricing_config WHERE id = 1");
    res.json(result.rows[0] || null);
  } catch (error) {
    next(error);
  }
});

pricingConfigRouter.put("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    for (const field of FIELDS) {
      const value = Number(body[field]);
      if (!Number.isFinite(value) || value < 0) {
        res.status(400).json({ error: `Valor inválido para "${field}"`, code: "VALIDATION" });
        return;
      }
    }
    const values = FIELDS.map((field) => Number(body[field]));
    const setClause = FIELDS.map((field, i) => `${field} = $${i + 1}`).join(", ");
    const result = await pool.query(
      `UPDATE commercial_pricing_config
       SET ${setClause}, updated_date = now(), updated_by = $${FIELDS.length + 1}
       WHERE id = 1
       RETURNING *`,
      [...values, req.user?.email || null]
    );
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});
