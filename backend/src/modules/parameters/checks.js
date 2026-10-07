import { checkTaxSuppliersInErp } from "../tax/taxSupplier.js";
import { TAX_SUPPLIERS_PARAMETER } from "../tax/taxSupplierConfig.js";
import {
  TAX_TITLE_NATURE_PARAMETER,
  TAX_TITLE_PREFIX_PARAMETER,
  TAX_TITLE_TYPE_PARAMETER,
  normalizeTaxTitlePrefix,
} from "../tax/taxTitleConfig.js";
import { loanPrefixInUse, queueRejectedTaxTitlesRetry } from "../tax/taxTitles.js";
import { groupIdOrThrow } from "../tenants/access.js";
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

// Parâmetros que mudam o envio do título de tributo: gravados (ou restaurados), os títulos recusados pelo Protheus
// são tentados de novo em segundo plano.
const TAX_TITLE_SEND_PARAMETERS = new Set([
  TAX_SUPPLIERS_PARAMETER, TAX_TITLE_TYPE_PARAMETER, TAX_TITLE_PREFIX_PARAMETER, TAX_TITLE_NATURE_PARAMETER,
]);

export async function afterParameterChanged(key) {
  if (TAX_TITLE_SEND_PARAMETERS.has(key)) await queueRejectedTaxTitlesRetry();
}

// Regras que dependem de dados do cliente, conferidas antes de gravar (o formato fica na definição do parâmetro).
const BEFORE_SAVE = {
  [TAX_TITLE_PREFIX_PARAMETER]: async (value) => {
    const prefix = normalizeTaxTitlePrefix(value);
    if (prefix && (await loanPrefixInUse(groupIdOrThrow(), prefix))) {
      const err = new Error(`O prefixo ${prefix} já é usado pelos títulos de empréstimo. Escolha outro prefixo para os títulos de tributo (ex.: TRB).`);
      err.status = 400;
      err.code = "INVALID_PARAMETER_VALUE";
      err.details = { field: TAX_TITLE_PREFIX_PARAMETER };
      throw err;
    }
  },
};

export async function assertParameterAllowed(key, value) {
  const rule = BEFORE_SAVE[key];
  if (rule) await rule(value);
}
