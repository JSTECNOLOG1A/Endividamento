export function normalizeBankCode(value) {
  const digits = String(value ?? "").trim().replace(/\D/g, "");
  if (!digits) return String(value ?? "").trim();
  return digits.padStart(3, "0").slice(-3);
}

export function findBankByCode(banks, bankCode) {
  const code = normalizeBankCode(bankCode);
  if (!code) return { bank: null, ambiguous: false };

  const matches = (banks || []).filter((item) => normalizeBankCode(item.bank_code) === code);
  if (matches.length === 0) return { bank: null, ambiguous: false };
  if (matches.length === 1) return { bank: matches[0], ambiguous: false };

  const active = matches.filter((item) => item.status === "ativo");
  if (active.length === 1) return { bank: active[0], ambiguous: false };
  return { bank: null, ambiguous: true };
}
