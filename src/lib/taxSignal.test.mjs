/**
 * Testes do semáforo dos parcelamentos de tributos (node src/lib/taxSignal.test.mjs).
 */
import assert from "node:assert/strict";
import { INSTALLMENT_STATUS_OPTIONS, installmentStatusLabel } from "./taxLabels.js";
import { addMonthsKeepingDay, daysBetween, formatCivilDate, todayInBrazil } from "./taxDates.js";
import {
  DUE_SOON_DAYS,
  STALE_AFTER_DAYS,
  buildMonthlySchedule,
  computeTaxSignal,
  isBalanceUnverified,
  nextOpenInstallment,
} from "./taxSignal.js";

const TODAY = "2026-10-05";
const fresh = { situacao: "ativo", ultima_conferencia: "2026-10-01" };
const open = (vencimento) => ({ situacao: "em_aberto", vencimento });

// Fora do semáforo: quitado/rescindido/suspenso mostram a própria situação.
for (const situacao of ["quitado", "rescindido", "suspenso"]) {
  assert.deepEqual(computeTaxSignal({ situacao, ultima_conferencia: TODAY }, [open("2026-01-01")], TODAY), {
    signal: null,
    recordsSignal: null,
  });
}

// Desatualizado: nunca conferido, ou há mais de STALE_AFTER_DAYS dias — e tem precedência sobre o resto.
assert.equal(STALE_AFTER_DAYS, 30);
assert.deepEqual(computeTaxSignal({ situacao: "ativo", ultima_conferencia: null }, [], TODAY), {
  signal: "desatualizado",
  recordsSignal: "em_dia",
});
assert.equal(computeTaxSignal({ situacao: "ativo", ultima_conferencia: "2026-09-05" }, [], TODAY).signal, "em_dia");
assert.deepEqual(computeTaxSignal({ situacao: "ativo", ultima_conferencia: "2026-09-04" }, [open("2026-10-01")], TODAY), {
  signal: "desatualizado",
  recordsSignal: "em_atraso",
});

// Em atraso: parcela em aberto vencida antes de hoje (hoje não é atraso).
assert.equal(computeTaxSignal(fresh, [open("2026-10-04")], TODAY).signal, "em_atraso");
assert.equal(computeTaxSignal(fresh, [open(TODAY)], TODAY).signal, "a_vencer");
assert.equal(
  computeTaxSignal(fresh, [{ situacao: "cancelada", vencimento: "2026-01-01" }], TODAY).signal,
  "em_dia",
  "parcela cancelada vencida não é atraso"
);

// Aguardando reconhecimento perde para atraso e ganha de a vencer.
const waiting = { situacao: "paga_aguardando_reconhecimento", vencimento: "2026-09-30", data_pagamento: "2026-09-30" };
assert.equal(computeTaxSignal(fresh, [waiting, open("2026-10-01")], TODAY).signal, "em_atraso");
assert.equal(computeTaxSignal(fresh, [waiting, open("2026-10-06")], TODAY).signal, "aguardando_reconhecimento");

// A vencer: janela de DUE_SOON_DAYS dias a partir de hoje, inclusive.
assert.equal(DUE_SOON_DAYS, 7);
assert.equal(computeTaxSignal(fresh, [open("2026-10-12")], TODAY).signal, "a_vencer");
assert.equal(computeTaxSignal(fresh, [open("2026-10-13")], TODAY).signal, "em_dia");

// Próxima parcela: a em aberto de vencimento mais próximo, mesmo vencida.
assert.equal(nextOpenInstallment([open("2026-12-01"), open("2026-09-01"), waiting])?.vencimento, "2026-09-01");
assert.equal(nextOpenInstallment([waiting]), null);

// Geração mensal: mesmo dia, último dia em mês curto, sem "encolher" o dia depois.
assert.deepEqual(
  buildMonthlySchedule({ firstDueDate: "2026-01-31", count: 4, amount: 100, startNumber: 3 }).map((p) => [p.numero_parcela, p.vencimento]),
  [[3, "2026-01-31"], [4, "2026-02-28"], [5, "2026-03-31"], [6, "2026-04-30"]]
);
assert.equal(addMonthsKeepingDay("2027-12-31", 2, 31), "2028-02-29");
assert.equal(addMonthsKeepingDay("2026-11-15", 3, 15), "2027-02-15");
assert.deepEqual(buildMonthlySchedule({ firstDueDate: "", count: 3, amount: 1 }), []);

// Saldo sem conferência que o cubra.
assert.equal(isBalanceUnverified({ saldo_oficial: null, ultima_conferencia: null }), false, "sem saldo, nada a conferir");
assert.equal(isBalanceUnverified({ saldo_oficial: 10, saldo_data_base: "2026-09-01", ultima_conferencia: null }), true);
assert.equal(isBalanceUnverified({ saldo_oficial: 10, saldo_data_base: "2026-10-02", ultima_conferencia: "2026-10-01" }), true);
assert.equal(isBalanceUnverified({ saldo_oficial: 10, saldo_data_base: "2026-10-01", ultima_conferencia: "2026-10-01" }), false);

// Situação da parcela no vocabulário da equipe; o valor interno não muda.
assert.equal(installmentStatusLabel(open(TODAY), TODAY), "A vencer", "vence hoje ainda é a vencer");
assert.equal(installmentStatusLabel(open("2026-10-04"), TODAY), "Vencida");
assert.equal(installmentStatusLabel(waiting, TODAY), "Paga, aguardando reconhecimento");
assert.equal(installmentStatusLabel({ situacao: "reconhecida", vencimento: "2026-01-01" }, TODAY), "Paga");
assert.equal(installmentStatusLabel({ situacao: "cancelada", vencimento: "2026-01-01" }, TODAY), "Cancelada");
assert.deepEqual(
  INSTALLMENT_STATUS_OPTIONS.map((item) => item.label),
  ["A vencer ou vencida", "Paga, aguardando reconhecimento", "Paga", "Cancelada"]
);

// Datas civis sem fuso.
assert.equal(daysBetween("2026-02-28", "2026-03-01"), 1);
assert.equal(formatCivilDate("2026-10-05"), "05/10/2026");
assert.equal(todayInBrazil(new Date("2026-10-06T02:30:00Z")), "2026-10-05", "23h30 em São Paulo ainda é o dia 5");

console.log("taxSignal ok: precedência, limites, próxima parcela, geração mensal e datas civis");
