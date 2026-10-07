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

export function isValidCnpj(value) {
  const digits = digitsOnly(value);
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false;
  const calc = (base, weights) => {
    const rest = base.reduce((sum, d, i) => sum + Number(d) * weights[i], 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const base = digits.slice(0, 12).split("");
  const d1 = calc(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits.slice(12) === `${d1}${d2}`;
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
