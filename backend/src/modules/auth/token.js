import jwt from "jsonwebtoken";
import { config } from "../../config.js";

export function issueAuthResponse(user, tenant) {
  const platformAdmin = user.platform_admin === true;
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    full_name: user.full_name,
    tenant_id: tenant?.id || null,
    group_id: tenant?.group_id || null,
    platform_admin: platformAdmin,
  };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      platform_admin: platformAdmin,
      tenant_id: tenant?.id || null,
      group_id: tenant?.group_id || null,
      tenant_name: tenant?.tenant_name || null,
      tenant_domain: tenant?.domain || null,
      tenant_role: platformAdmin ? "PLATFORM" : (tenant?.tenant_role || null),
      billing_status: tenant?.billing_status || null,
      plan: tenant?.plan || null,
      trial_ends_at: tenant?.trial_ends_at || null,
      onboarding_completed_at: tenant?.onboarding_completed_at || null,
    },
  };
}
