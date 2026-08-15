/**
 * 🔐 SAAS GUARD — MIDDLEWARE DE PROTEÇÃO
 * 
 * Validação unificada antes de operações críticas
 * 
 * VALIDAÇÕES:
 * 1. Tenant access (usuário pertence ao tenant)
 * 2. Billing status (não suspenso)
 * 3. Plan limits (não excede limites)
 * 4. Role permissions (tem permissão)
 * 
 * USO:
 * await validateBeforeContractCreation(userEmail, groupId, role)
 */

import { base44 } from "@/api/base44Client";
import { validateTenantAccess, getTenant, checkBillingStatus } from "./TenantService";
import { canCreateContract, canAddUser } from "./PlanService";
import { requirePermission } from "./UserRoleService";
import { requireActiveBilling } from "./BillingHooks";

/**
 * Valida tudo antes de criar contrato
 * @param {string} userEmail - Email do usuário
 * @param {string} groupId - ID do grupo
 * @param {string} role - Role do usuário
 * @returns {Promise<Object>} Validação completa
 */
export async function validateBeforeContractCreation(userEmail, groupId, role) {
  // 1️⃣ Validar acesso ao tenant
  await validateTenantAccess(userEmail, groupId);
  
  // 2️⃣ Obter tenant
  const tenant = await getTenant(groupId);
  
  // 3️⃣ Validar billing ativo
  await requireActiveBilling(tenant.id);
  
  // 4️⃣ Validar limites do plano
  const limitCheck = canCreateContract(tenant);
  if (!limitCheck.allowed) {
    throw new Error(`[SAAS] ${limitCheck.reason}`);
  }
  
  // 5️⃣ Validar permissões de role
  requirePermission(role, "contracts", "create");
  
  return {
    allowed: true,
    tenant: tenant,
    limit_check: limitCheck,
    message: "Validação completa: pode criar contrato"
  };
}

/**
 * Valida antes de ler dados (mais leve)
 * @param {string} userEmail - Email do usuário
 * @param {string} groupId - ID do grupo
 * @returns {Promise<Object>} Validação
 */
export async function validateBeforeRead(userEmail, groupId) {
  // 1️⃣ Validar acesso ao tenant
  const tenantUser = await validateTenantAccess(userEmail, groupId);
  
  // 2️⃣ Obter tenant
  const tenant = await getTenant(groupId);
  
  // 3️⃣ Validar billing (sem bloquear leitura se trial expirado, apenas se suspended)
  checkBillingStatus(tenant);
  
  return {
    allowed: true,
    tenant: tenant,
    tenant_user: tenantUser
  };
}

/**
 * Valida antes de aprovar contrato
 * @param {string} userEmail - Email do usuário
 * @param {string} groupId - ID do grupo
 * @param {string} role - Role do usuário
 * @returns {Promise<boolean>} True se permitido
 */
export async function validateBeforeApproval(userEmail, groupId, role) {
  await validateTenantAccess(userEmail, groupId);
  const tenant = await getTenant(groupId);
  await requireActiveBilling(tenant.id);
  requirePermission(role, "contracts", "approve");
  
  return true;
}

/**
 * Valida antes de adicionar usuário
 * @param {string} userEmail - Email do executor
 * @param {string} groupId - ID do grupo
 * @param {string} role - Role do executor
 * @returns {Promise<Object>} Validação
 */
export async function validateBeforeUserInvite(userEmail, groupId, role) {
  await validateTenantAccess(userEmail, groupId);
  const tenant = await getTenant(groupId);
  await requireActiveBilling(tenant.id);
  requirePermission(role, "users", "invite");
  
  // Validar limite de usuários
  const currentUsers = await base44.entities.TenantUser.filter({ group_id: groupId }, "-created_date", 1000);
  const limitCheck = canAddUser(tenant, currentUsers.length);
  
  if (!limitCheck.allowed) {
    throw new Error(`[SAAS] ${limitCheck.reason}`);
  }
  
  return {
    allowed: true,
    tenant: tenant,
    limit_check: limitCheck
  };
}

export default {
  validateBeforeContractCreation,
  validateBeforeRead,
  validateBeforeApproval,
  validateBeforeUserInvite
};