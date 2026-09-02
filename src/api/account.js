import { apiRequest } from "./base44Client";

export const accountApi = {
  forgotPassword(email) {
    return apiRequest("/public/forgot-password", { method: "POST", body: { email } });
  },
  getToken(token) {
    return apiRequest(`/public/account-token/${encodeURIComponent(token)}`);
  },
  setPassword(token, data) {
    return apiRequest(`/public/account-token/${encodeURIComponent(token)}/password`, {
      method: "POST",
      body: data,
    });
  },
};
