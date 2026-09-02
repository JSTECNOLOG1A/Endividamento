import { apiRequest } from "./base44Client";

export const signupApi = {
  lookupCnpj(cnpj) {
    return apiRequest(`/public/cnpj/${encodeURIComponent(cnpj)}`);
  },
  start(data) {
    return apiRequest("/public/signup", { method: "POST", body: data });
  },
  get(token) {
    return apiRequest(`/public/signup/${encodeURIComponent(token)}`);
  },
  complete(token, data) {
    return apiRequest(`/public/signup/${encodeURIComponent(token)}/password`, {
      method: "POST",
      body: data,
    });
  },
};

export function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

export function formatCnpj(value) {
  const digits = digitsOnly(value).slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}
