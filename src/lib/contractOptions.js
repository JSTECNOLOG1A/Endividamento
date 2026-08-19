// Listas de opções compartilhadas entre o formulário de contrato
// (ContractForm.jsx) e a visão somente-leitura usada na revisão/aprovação
// (ContractSummary.jsx). Mantidas em um único lugar para os dois nunca
// ficarem dessincronizados quanto a rótulos.

export const OPERATION_CATEGORIES = [
  { value: "emprestimos", label: "Empréstimos (Capital de Giro)" },
  { value: "financiamentos", label: "Financiamentos (Investimento/CAPEX)" },
  { value: "mutuos_partes_relacionadas", label: "Mútuos com Partes Relacionadas" },
  { value: "mutuos_terceiros", label: "Mútuos com Terceiros" },
];

export const OPERATION_TYPES = {
  emprestimos: [
    { value: "giro_prefixado", label: "Giro Prefixado" },
    { value: "giro_cdi", label: "Giro CDI" },
    { value: "conta_garantida", label: "Conta Garantida" },
    { value: "emprestimo_moeda_estrangeira_4131", label: "Empréstimo em Moeda Estrangeira (4131)" },
  ],
  financiamentos: [
    { value: "bndes_finame", label: "BNDES/FINAME" },
    { value: "credito_rural_custeio", label: "Crédito Rural (Custeio)" },
    { value: "credito_rural_investimento_solos", label: "Crédito rural (Investimento em solos)" },
    { value: "leasing", label: "Leasing Imobiliário/Equipamentos" },
    { value: "cri_cra", label: "CRI/CRA" },
  ],
  // Mútuos com partes relacionadas (sócios, controladora, coligadas) e
  // mútuos com terceiros (fora do grupo econômico, sem ser banco) são duas
  // categorias de primeiro nível — contabilmente precisam de contas
  // próprias, separadas entre si e do restante, por isso cada uma tem sua
  // própria aba na matriz contábil do Fechamento (ver AccountingMatrixConfig.jsx).
  mutuos_partes_relacionadas: [
    { value: "mutuo_partes_relacionadas", label: "Mútuo com Partes Relacionadas" },
  ],
  mutuos_terceiros: [
    { value: "mutuo_terceiros", label: "Mútuo com Terceiros" },
  ],
};

export const PERIODICITIES = [
  { value: "1", label: "Mensal" },
  { value: "2", label: "Bimestral" },
  { value: "3", label: "Trimestral" },
  { value: "6", label: "Semestral" },
  { value: "12", label: "Anual" },
  { value: "bullet", label: "No Vencimento" },
];

export const SYSTEMS = [
  {
    value: "SAC",
    label: "SAC — Amortização Constante",
    description: "Sistema de Amortização Constante: Parcelas decrescentes ao longo do tempo. A amortização do principal é fixa, enquanto os juros diminuem a cada período, resultando em prestações menores progressivamente. Ideal para planejamento com redução de compromisso financeiro."
  },
  {
    value: "PRICE",
    label: "PRICE — Prestação Constante",
    description: "Sistema Francês de Amortização: Prestações fixas durante todo o contrato. Nos primeiros períodos, a maior parte da prestação é composta por juros; gradualmente, a amortização do principal aumenta. Facilita o orçamento mensal por ter parcelas constantes."
  },
  {
    value: "AMERICANO",
    label: "Americano — Juros Periódicos",
    description: "Sistema Americano: Pagamento de juros em cada período, com amortização total do principal apenas no vencimento final. Mantém prestações baixas durante o período, mas requer planejamento para pagamento do valor principal no final. Comum em operações estruturadas."
  },
  {
    value: "BULLET",
    label: "Bullet — Pagamento Único",
    description: "Pagamento Bullet: Todo o valor (principal + juros acumulados) é pago em uma única parcela no vencimento. Não há pagamentos intermediários. Utilizado em operações de curto prazo ou quando há previsão de entrada de recursos específica na data de vencimento."
  },
  {
    value: "PERCENTAGE_RESIDUAL",
    label: "% Residual — Percentual sobre SD",
    description: "Amortização por Percentual sobre Saldo Devedor: Cada parcela amortiza um percentual configurável do saldo devedor inicial do período (antes de capitalizar juros). Usado por Banco da Amazônia e outras instituições em operações estruturadas."
  },
];

export const INDEXERS = [
  { value: "NA", label: "N/A (Prefixado)" },
  { value: "CDI", label: "CDI" },
  { value: "SELIC", label: "SELIC" },
];

export const EXCHANGE_LAGS = [
  { value: "0", label: "D (Mesma data)" },
  { value: "1", label: "D-1 (Dia anterior)" },
  { value: "2", label: "D-2 (Dois dias antes)" },
];

export const GRACE_INTEREST_BEHAVIORS = [
  { value: "CAPITALIZAR", label: "Capitalizar (Anatocismo)" },
  { value: "INTEREST_ONLY", label: "Pagar Juros (Interest Only)" },
  { value: "BALLOON", label: "Balloon (Juros Simples)" },
];

export const AMORTIZATION_TRIGGERS = [
  { value: "END_OF_GRACE", label: "Fim da Carência" },
  { value: "GRACE_PLUS_FREQ", label: "Carência + Periodicidade" },
  { value: "NEXT_MONTH", label: "Mês Subsequente" },
];

export const PERCENTAGE_BASES = [
  { value: "saldo_devedor", label: "% sobre Saldo Devedor (início do período)" },
  { value: "principal", label: "% sobre Principal Original" },
];

// Garantia: dois eixos independentes e opcionais, que alimentam a mesma
// coluna/rótulo combinado na exibição (ver combineGuaranteeLabel abaixo).
export const GUARANTEE_REAL_TYPES = [
  { value: "alienacao_fiduciaria", label: "Alienação Fiduciária" },
  { value: "hipoteca", label: "Hipoteca" },
  { value: "penhor", label: "Penhor" },
  { value: "cessao_recebiveis", label: "Cessão de Recebíveis" },
];

export const GUARANTEE_PERSONAL_TYPES = [
  { value: "aval", label: "Aval" },
  { value: "fianca", label: "Fiança" },
];

function guaranteeLabel(list, value) {
  return list.find((opt) => opt.value === value)?.label || "";
}

/**
 * Combina os dois eixos de garantia (Real + Pessoal) em um único rótulo de
 * exibição. Regras:
 * - Ambos preenchidos: "{Real} + {Pessoal}"
 * - Apenas um preenchido: só esse
 * - Nenhum dos dois foi explicitamente definido (contrato legado, nunca
 *   editado após esta feature): "Não informado"
 * - Ambos explicitamente "nenhum" (usuário confirmou que não há garantia):
 *   trate via o valor especial "" vindo de um contrato editado — como não há
 *   um terceiro estado persistido, contratos editados sem nenhuma garantia
 *   selecionada também caem em "Não informado" hoje.
 */
export function combineGuaranteeLabel(realType, personalType) {
  const realLabel = realType ? guaranteeLabel(GUARANTEE_REAL_TYPES, realType) : "";
  const personalLabel = personalType ? guaranteeLabel(GUARANTEE_PERSONAL_TYPES, personalType) : "";

  if (realLabel && personalLabel) return `${realLabel} + ${personalLabel}`;
  if (realLabel) return realLabel;
  if (personalLabel) return personalLabel;
  return "Não informado";
}
