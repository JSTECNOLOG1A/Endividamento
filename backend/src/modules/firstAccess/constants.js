/** Versão atual do product tour / onboarding de usuário. */
export const CURRENT_ONBOARDING_VERSION = "1.0";

/**
 * Reservado para reexibição automática de novas versões.
 * NÃO ativar sem decisão de produto — por padrão novas versões não forçam tour.
 */
export const FORCE_ONBOARDING_FOR_EXISTING_USERS = false;

export const LEGAL_TYPES = {
  PRIVACY_POLICY: "PRIVACY_POLICY",
  TERMS_OF_USE: "TERMS_OF_USE",
  MARKETING_CONSENT: "MARKETING_CONSENT",
};

export const LEGAL_ACTIONS = {
  ACCEPTED: "ACCEPTED",
  REVOKED: "REVOKED",
  ACKNOWLEDGED: "ACKNOWLEDGED",
};
