/**
 * 🔐 TENANT SERVICE — MULTI-TENANT CORE
 * 
 * Isolamento total por group_id
 * Impede acesso cruzado entre tenants
 * 
 * RESPONSABILIDADE:
 * - Validar que usuário pertence ao tenant
 * - Filtrar queries por group_id
 * - Bloquear acesso cruzado
 * 
 * NÃO MEXE: CalculationEngine, lógica financeira
 */

import { base44 } from "@/api/base44Client";

/**
 * 🔐 PLAN LIMITS
 */
export const PLAN_LIMITS = {
  STARTER: { contracts: 10, users: 3 },
  PRO: { contracts: 50, users: 10 },
  ENTERPRISE: { contracts: Infinity, users: Infinity }
};

/**
 * Obtém tenant do usuário atual
 * @param {string} groupId - ID do grupo
 * @returns {Promise<Object>} Tenant
 */
export async function getTenant(groupId) {
  if (!groupId) {
    throw new Error("[TENANT] group_id obrigatório");
  }
  
  const tenants = await base44.entities.Tenant.filter({ group_id: groupId }, "-created_date", 1);
  
  if (tenants.length === 0) {
    throw new Error(`[TENANT] Tenant não encontrado: ${groupId}`);
  }
  
  return tenants[0];
}

/**
 * Valida se usuário tem acesso ao tenant
 * @param {string} userEmail - Email do usuário
 * @param {string} groupId - ID do grupo
 * @returns {Promise<Object>} TenantUser
 */
export async function validateTenantAccess(userEmail, groupId) {
  if (!userEmail || !groupId) {
    throw new Error("[TENANT] user_email e group_id obrigatórios");
  }
  
  const tenantUsers = await base44.entities.TenantUser.filter(
    { group_id: groupId, user_email: userEmail },
    "-created_date",
    1
  );
  
  if (tenantUsers.length === 0) {
    throw new Error(`[TENANT] Usuário ${userEmail} não tem acesso ao tenant ${groupId}`);
  }
  
  return tenantUsers[0];
}

/**
 * Filtra query com isolamento de tenant (adiciona group_id)
 * @param {Object} query - Query base
 * @param {string} groupId - ID do grupo
 * @returns {Object} Query com group_id
 */
export function addTenantFilter(query, groupId) {
  if (!groupId) {
    throw new Error("[TENANT] group_id obrigatório para isolamento");
  }
  
  return { ...query, group_id: groupId };
}

/**
 * Valida múltiplos IDs de contratos pertencem ao tenant
 * @param {Array} contractIds - IDs dos contratos
 * @param {string} groupId - ID do grupo
 * @returns {Promise<boolean>} True se todos pertencem
 */
export async function validateContractsOwnership(contractIds, groupId) {
  if (!contractIds || contractIds.length === 0) return true;
  
  const contracts = await base44.entities.LoanContract.filter(
    { id: { $in: contractIds } },
    "-created_date",
    contractIds.length
  );
  
  const allBelongToTenant = contracts.every(c => c.group_id === groupId);
  
  if (!allBelongToTenant) {
    throw new Error(`[TENANT] Alguns contratos não pertencem ao tenant ${groupId}`);
  }
  
  return true;
}

/**
 * Impede acesso se billing_status = suspended
 * @param {Object} tenant - Tenant
 */
export function checkBillingStatus(tenant) {
  if (tenant.billing_status === "suspended") {
    throw new Error(
      `[TENANT] Acesso suspenso. Entre em contato com o suporte para regularizar o pagamento.`
    );
  }
  
  return true;
}

export default {
  PLAN_LIMITS,
  getTenant,
  validateTenantAccess,
  addTenantFilter,
  validateContractsOwnership,
  checkBillingStatus
};