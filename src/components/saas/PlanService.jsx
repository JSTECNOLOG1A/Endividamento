/**
 * 🔐 PLAN SERVICE — LIMITS & UPGRADES
 * 
 * Gerencia planos e limites de uso
 * Bloqueia criação de contratos acima do plano
 * 
 * PLANOS:
 * - STARTER: 10 contratos, 3 usuários
 * - PRO: 50 contratos, 10 usuários
 * - ENTERPRISE: ilimitado
 */

import { base44 } from "@/api/base44Client";
import { PLAN_LIMITS } from "./TenantService";

/**
 * Valida se tenant pode criar novo contrato
 * @param {Object} tenant - Tenant
 * @returns {Object} Validação { allowed, reason }
 */
export function canCreateContract(tenant) {
  const limit = PLAN_LIMITS[tenant.plan]?.contracts || 0;
  const used = tenant.contracts_used || 0;
  
  if (used >= limit) {
    return {
      allowed: false,
      reason: `Limite de ${limit} contratos atingido no plano ${tenant.plan}. Faça upgrade para criar mais contratos.`,
      limit: limit,
      used: used,
      plan: tenant.plan
    };
  }
  
  return {
    allowed: true,
    limit: limit,
    used: used,
    remaining: limit - used,
    plan: tenant.plan
  };
}

/**
 * Valida se tenant pode adicionar novo usuário
 * @param {Object} tenant - Tenant
 * @param {number} currentUsers - Usuários atuais
 * @returns {Object} Validação
 */
export function canAddUser(tenant, currentUsers) {
  const limit = PLAN_LIMITS[tenant.plan]?.users || 0;
  
  if (currentUsers >= limit) {
    return {
      allowed: false,
      reason: `Limite de ${limit} usuários atingido no plano ${tenant.plan}. Faça upgrade para adicionar mais usuários.`,
      limit: limit,
      current: currentUsers,
      plan: tenant.plan
    };
  }
  
  return {
    allowed: true,
    limit: limit,
    current: currentUsers,
    remaining: limit - currentUsers,
    plan: tenant.plan
  };
}

/**
 * Incrementa contador de contratos
 * @param {string} tenantId - ID do tenant
 */
export async function incrementContractUsage(tenantId) {
  const tenant = await base44.entities.Tenant.read(tenantId);
  const newUsed = (tenant.contracts_used || 0) + 1;
  
  await base44.entities.Tenant.update(tenantId, {
    contracts_used: newUsed
  });
  
  return newUsed;
}

/**
 * Decrementa contador de contratos (ao deletar)
 * @param {string} tenantId - ID do tenant
 */
export async function decrementContractUsage(tenantId) {
  const tenant = await base44.entities.Tenant.read(tenantId);
  const newUsed = Math.max(0, (tenant.contracts_used || 0) - 1);
  
  await base44.entities.Tenant.update(tenantId, {
    contracts_used: newUsed
  });
  
  return newUsed;
}

/**
 * Retorna detalhes do plano
 * @param {string} planName - Nome do plano
 * @returns {Object} Detalhes
 */
export function getPlanDetails(planName) {
  const limits = PLAN_LIMITS[planName];
  
  if (!limits) {
    throw new Error(`[PLAN] Plano inválido: ${planName}`);
  }
  
  const pricing = {
    STARTER: { monthly: 0, yearly: 0, description: "Grátis para começar" },
    PRO: { monthly: 299, yearly: 2990, description: "Para empresas em crescimento" },
    ENTERPRISE: { monthly: 999, yearly: 9990, description: "Sem limites" }
  };
  
  return {
    name: planName,
    limits: limits,
    pricing: pricing[planName],
    features: {
      contracts: limits.contracts === Infinity ? "Ilimitado" : `Até ${limits.contracts}`,
      users: limits.users === Infinity ? "Ilimitado" : `Até ${limits.users}`,
      support: planName === "ENTERPRISE" ? "Prioritário" : planName === "PRO" ? "Email" : "Documentação"
    }
  };
}

export default {
  canCreateContract,
  canAddUser,
  incrementContractUsage,
  decrementContractUsage,
  getPlanDetails
};