import { apiRequest } from "./base44Client";

export const firstAccessApi = {
  getOnboarding() {
    return apiRequest("/me/onboarding");
  },
  startTour() {
    return apiRequest("/me/onboarding/start", { method: "POST", body: {} });
  },
  completeTour() {
    return apiRequest("/me/onboarding/complete", { method: "POST", body: {} });
  },
  skipTour() {
    return apiRequest("/me/onboarding/skip", { method: "POST", body: {} });
  },
  getPrivacy() {
    return apiRequest("/me/privacy");
  },
  setMarketingConsent(marketing) {
    return apiRequest("/me/consents", { method: "POST", body: { marketing } });
  },
  revokeMarketingConsent() {
    return apiRequest("/me/consents/revoke", { method: "POST", body: {} });
  },
  createPrivacyRequest(payload) {
    return apiRequest("/me/privacy/requests", { method: "POST", body: payload });
  },
};

export const legalApi = {
  getCurrent() {
    return apiRequest("/legal/current");
  },
  accept(payload) {
    return apiRequest("/legal/acceptances", { method: "POST", body: payload });
  },
};
