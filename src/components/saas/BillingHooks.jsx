/**
 * 🔐 BILLING HOOKS — PLACEHOLDER
 * 
 * Hooks para integração futura com sistema de billing
 * Por ora: valida status e bloqueia acesso se suspended
 * 
 * FUTURO:
 * - Integração Stripe/Paddle
 * - Webhooks de pagamento
 * - Trial automático
 * - Upgrade/downgrade
 */

import { base44 } from "@/api/base44Client";

/**
 * Valida se tenant está ativo
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<Object>} Status de billing
 */
export async function checkBillingStatus(tenantId) {
  const tenant = await base44.entities.Tenant.read(tenantId);
  
  const status = {
    tenant_id: tenantId,
    billing_status: tenant.billing_status,
    is_active: tenant.billing_status === "active" || tenant.billing_status === "trial",
    is_trial: tenant.billing_status === "trial",
    is_suspended: tenant.billing_status === "suspended"
  };
  
  if (tenant.billing_status === "trial" && tenant.trial_ends_at) {
    const trialEnd = new Date(tenant.trial_ends_at);
    const now = new Date();
    
    status.trial_ends_at = tenant.trial_ends_at;
    status.trial_days_remaining = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
    status.trial_expired = now > trialEnd;
    
    if (status.trial_expired) {
      status.is_active = false;
    }
  }
  
  return status;
}

/**
 * Bloqueia operação se billing suspended ou trial expirado
 * @param {string} tenantId - ID do tenant
 */
export async function requireActiveBilling(tenantId) {
  const status = await checkBillingStatus(tenantId);
  
  if (!status.is_active) {
    if (status.is_suspended) {
      throw new Error(
        `[BILLING] Acesso suspenso. Entre em contato com o suporte para regularizar o pagamento.`
      );
    }
    
    if (status.trial_expired) {
      throw new Error(
        `[BILLING] Trial expirado. Faça upgrade para continuar usando o sistema.`
      );
    }
    
    throw new Error(`[BILLING] Billing inativo. Status: ${status.billing_status}`);
  }
  
  return status;
}

/**
 * 🔐 PLACEHOLDER: Webhook de pagamento confirmado
 * @param {Object} payload - Dados do webhook
 */
export async function handlePaymentSuccess(payload) {
  // FUTURO: Integração real com Stripe/Paddle
  console.log("[BILLING] Payment success webhook:", payload);
  
  const { tenant_id, plan, subscription_id } = payload;
  
  await base44.entities.Tenant.update(tenant_id, {
    billing_status: "active",
    plan: plan,
    metadata: JSON.stringify({ subscription_id })
  });
  
  return { status: "processed" };
}

/**
 * 🔐 PLACEHOLDER: Webhook de pagamento falhou
 * @param {Object} payload - Dados do webhook
 */
export async function handlePaymentFailed(payload) {
  // FUTURO: Integração real
  console.log("[BILLING] Payment failed webhook:", payload);
  
  const { tenant_id } = payload;
  
  await base44.entities.Tenant.update(tenant_id, {
    billing_status: "suspended"
  });
  
  return { status: "processed" };
}

/**
 * Inicia trial de 14 dias
 * @param {string} tenantId - ID do tenant
 */
export async function startTrial(tenantId) {
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 14);
  
  await base44.entities.Tenant.update(tenantId, {
    billing_status: "trial",
    trial_ends_at: trialEnd.toISOString().split('T')[0]
  });
  
  return {
    trial_started: true,
    trial_ends_at: trialEnd.toISOString().split('T')[0],
    days: 14
  };
}

export default {
  checkBillingStatus,
  requireActiveBilling,
  handlePaymentSuccess,
  handlePaymentFailed,
  startTrial
};