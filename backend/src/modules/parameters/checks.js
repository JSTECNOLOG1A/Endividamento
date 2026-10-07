import { checkTaxSuppliersInErp } from "../tax/taxSupplier.js";
import { TAX_SUPPLIERS_PARAMETER } from "../tax/taxSupplierConfig.js";
import { resolveParameter } from "./service.js";

// Conferências feitas depois de gravar um parâmetro, que não bloqueiam a gravação: o resultado volta para a tela
// como aviso. Parâmetro sem conferência devolve null.

const CHECKS = {
  [TAX_SUPPLIERS_PARAMETER]: async (value) => {
    const erpEnabled = await resolveParameter("integrations.external_erp_enabled");
    return checkTaxSuppliersInErp(value, { erpEnabled: erpEnabled !== false });
  },
};

export async function runParameterChecks(key, value) {
  const check = CHECKS[key];
  return check ? check(value) : null;
}
