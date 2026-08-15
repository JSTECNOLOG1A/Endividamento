// Converte um número (formato JS, separador decimal ".") para o formato BR
// esperado pelos campos numéricos do <ContractForm> (separador decimal ","),
// sem separador de milhar — suficiente para o parser do formulário
// (".replace(/\./g, '').replace(',', '.')") reconstituir o valor correto.
//
// Por quê isso existe: o ContractForm guarda campos como fixed_rate,
// signal_value, iof_value, other_fees e indexer_spread como STRING no
// formato BR, e ao calcular faz:
//   form.fixed_rate.replace(/\./g, '').replace(',', '.')
// (remove "." assumindo que é separador de milhar, depois troca "," por ".").
// Se alimentarmos esses campos com Number.toString() (que usa PONTO como
// separador decimal, ex. "18.15"), o parser remove o ponto como se fosse
// separador de milhar e infla o valor em 10x-1000x (18.15 → "1815" → 1815%).
// Isso só se manifesta ao reabrir/duplicar um contrato já salvo (na criação,
// o usuário sempre digita direto no formato BR) — por isso o
// FINANCIAL_INTEGRITY_ERROR só aparecia depois de salvar e reabrir.
export function toBRDecimalString(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value).replace(".", ",");
}
