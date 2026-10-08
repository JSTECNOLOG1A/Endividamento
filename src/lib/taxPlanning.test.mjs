/**
 * Testes dos filtros e séries do Planejamento tributário (node src/lib/taxPlanning.test.mjs).
 */
import assert from "node:assert/strict";
import {
  NO_TRIBUTE_FILTER,
  addMonthsToMonth,
  agencyOptionValue,
  cashFlowSeries,
  firstMonthWithInstallments,
  hasNarrowingFilters,
  isPlanningEmpty,
  monthName,
  parseAgencyOption,
  planningFilterOptions,
  planningQueryParams,
  readPlanningFilters,
  shortMonthLabel,
  startMonthOptions,
} from "./taxPlanning.js";

// Meses: virada de ano para frente e para trás.
assert.equal(addMonthsToMonth("2026-10", 11), "2027-09");
assert.equal(addMonthsToMonth("2026-01", -1), "2025-12");
assert.equal(addMonthsToMonth("2026-12", 1), "2027-01");
assert.equal(addMonthsToMonth("2026-13", 1), null);
assert.equal(monthName("2026-03"), "Março de 2026");
assert.equal(shortMonthLabel("2027-01"), "jan/27");

const options = startMonthOptions("2026-10", { past: 2, future: 1 });
assert.deepEqual(options.map((item) => item.value), ["2026-08", "2026-09", "2026-10", "2026-11"]);
assert.match(options[2].label, /mês atual/);

// Filtros da URL: padrão = mês atual + 12 meses; valor estranho não chega ao servidor.
const defaults = readPlanningFilters(new URLSearchParams(""), "2026-10");
assert.deepEqual(defaults, { inicio: "2026-10", meses: 12, empresa: "", esfera: "", tributo: "", orgao: "" });
assert.equal(hasNarrowingFilters(defaults), false);
const odd = readPlanningFilters(new URLSearchParams("inicio=2026-13&meses=40&esfera=municipal&orgao=semuf"), "2026-10");
assert.equal(odd.inicio, "2026-10");
assert.equal(odd.meses, 12);
assert.equal(odd.esfera, "");
assert.equal(odd.orgao, "");
const chosen = readPlanningFilters(new URLSearchParams("inicio=2026-01&meses=36&esfera=Estadual&tributo=null&orgao=SEFAZ%7CSP"), "2026-10");
assert.equal(chosen.meses, 36);
assert.equal(chosen.esfera, "estadual");
assert.equal(hasNarrowingFilters(chosen), true);

// Consulta: fim = início + meses − 1 (36 meses é o teto do servidor); "null" segue literal; órgão com UF separa os dois.
assert.deepEqual(planningQueryParams(chosen), {
  inicio: "2026-01", fim: "2028-12", esfera: "estadual", tributo: NO_TRIBUTE_FILTER, orgao: "SEFAZ", uf: "SP",
});
assert.deepEqual(planningQueryParams(defaults), { inicio: "2026-10", fim: "2027-09" });
assert.deepEqual(planningQueryParams({ ...defaults, orgao: agencyOptionValue("Receita Federal", "") }), {
  inicio: "2026-10", fim: "2027-09", orgao: "Receita Federal",
});
assert.deepEqual(parseAgencyOption("Secretaria | da Fazenda|RJ"), { orgao: "Secretaria | da Fazenda", uf: "RJ" });
assert.equal(parseAgencyOption("|SP"), null);

// Opções: só parcelamentos ativos; tributo sem diferenciar maiúsculas; "sem tributo" por último; órgão segue a esfera.
const agreements = [
  { situacao: "ativo", entity_id: "e1", esfera: "federal", orgao: "Receita Federal", uf: null, tributo: "IRPJ" },
  { situacao: "ativo", entity_id: "e1", esfera: "federal", orgao: "receita federal", uf: null, tributo: "irpj" },
  { situacao: "ativo", entity_id: "e2", esfera: "estadual", orgao: "SEFAZ", uf: "sp", tributo: null },
  { situacao: "ativo", entity_id: "e2", esfera: "estadual", orgao: "SEFAZ", uf: "RJ", tributo: "ICMS" },
  { situacao: "quitado", entity_id: "e3", esfera: "federal", orgao: "PGFN", uf: null, tributo: "COFINS" },
];
const entities = [{ id: "e2", entity_name: "Beta" }, { id: "e1", entity_name: "Alfa" }, { id: "e3", entity_name: "Gama" }];
const all = planningFilterOptions(agreements, entities);
assert.deepEqual(all.empresas.map((item) => item.label), ["Alfa", "Beta"]);
assert.deepEqual(all.tributos.map((item) => item.value), ["ICMS", "IRPJ", NO_TRIBUTE_FILTER]);
assert.deepEqual(all.orgaos.map((item) => item.label), ["Receita Federal", "SEFAZ — RJ", "SEFAZ — SP"]);
const state = planningFilterOptions(agreements, entities, { esfera: "estadual" });
assert.deepEqual(state.orgaos.map((item) => item.value), ["SEFAZ|RJ", "SEFAZ|SP"]);

// Série do gráfico: com guia e estimado separados; pago à parte; nada recalculado.
const month = (mes, comGuia, estimado, pago, parcelas = []) => ({
  mes,
  a_pagar: { total: comGuia + estimado, com_guia: comGuia, estimado, parcelas: parcelas.length },
  pago: { total: pago, parcelas: 0, parcelas_sem_valor: 0 },
  parcelas,
});
const series = cashFlowSeries([month("2026-10", 150, 80, 0), month("2026-11", 0, 0, 90)]);
assert.deepEqual(series[0], {
  mes: "2026-10", label: "out/26", nome: "Outubro de 2026", com_guia: 150, estimado: 80, a_pagar: 230, pago: 0,
  parcelas_a_pagar: 0, parcelas_pagas_sem_valor: 0,
});
assert.equal(series[1].pago, 90);

// Vazio só quando não há parcela em mês nenhum nem vencida em aberto.
assert.equal(isPlanningEmpty({ meses: [month("2026-10", 0, 0, 0)], vencidas: { parcelas: [] } }), true);
assert.equal(isPlanningEmpty({ meses: [month("2026-10", 0, 0, 0)], vencidas: { parcelas: [{ id: "x" }] } }), false);
assert.equal(isPlanningEmpty(null), true);
assert.equal(firstMonthWithInstallments([month("2026-10", 0, 0, 0), month("2026-11", 1, 0, 0, [{ id: "p" }])]), "2026-11");

console.log("taxPlanning: ok");
