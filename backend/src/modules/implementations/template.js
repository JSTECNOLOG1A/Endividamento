// Modelo padrão do cronograma de implantação — fiel à planilha de
// referência "Controle de implantação — AllDebit" (6 etapas, 24
// atividades). Só o rótulo do código "2.x" foi corrigido (a planilha
// original repetia "2.2" por erro de digitação em duas atividades
// distintas); nenhuma atividade foi removida, fundida ou reescrita.
//
// auto_check_key aponta para uma função em autoChecks.js — null significa
// que a atividade só pode ser concluída manualmente (sem evidência
// automática disponível hoje no sistema).
export const IMPLEMENTATION_TEMPLATE = [
  {
    stageCode: "1",
    stageName: "1. Parametrização do sistema",
    activities: [
      { code: "1.1", name: "Criar tenant", autoCheckKey: "tenant_created" },
      { code: "1.2", name: "Convidar usuários", autoCheckKey: "users_invited" },
      { code: "1.3", name: "Definir modo de uso (integrado ou não integrado)", autoCheckKey: "usage_mode_set" },
      { code: "1.4", name: "Informar endereço REST", autoCheckKey: "rest_address_set" },
      { code: "1.5", name: "Criar os endpoints", autoCheckKey: "endpoints_created" },
      { code: "1.6", name: "Informar ERP de integração", autoCheckKey: "erp_informed" },
      { code: "1.7", name: "Definir parâmetros de elemento visual", autoCheckKey: "visual_params_set" },
    ],
  },
  {
    stageCode: "2",
    stageName: "2. Parâmetros de configuração",
    activities: [
      { code: "2.1", name: "Definir tipo do título principal", autoCheckKey: "main_title_type_set" },
      { code: "2.2", name: "Definir tipo do título de juros", autoCheckKey: "interest_title_type_set" },
      { code: "2.3", name: "Definir tipo do título provisório", autoCheckKey: "provisional_title_type_set" },
      { code: "2.4", name: "Definir natureza do título principal", autoCheckKey: "main_title_nature_set" },
      { code: "2.5", name: "Definir natureza do título de juros", autoCheckKey: "interest_title_nature_set" },
      { code: "2.6", name: "Definir natureza do título provisório", autoCheckKey: null },
    ],
  },
  {
    stageCode: "3",
    stageName: "3. Agendamentos",
    activities: [
      { code: "3.1", name: "Criar regras de agendamento", autoCheckKey: "schedules_created" },
    ],
  },
  {
    stageCode: "4",
    stageName: "4. Contabilização",
    activities: [
      { code: "4.1", name: "Definir regras de contabilização", autoCheckKey: "accounting_mappings_set" },
      { code: "4.2", name: "Validar títulos não liquidados no financeiro", autoCheckKey: null },
    ],
  },
  {
    stageCode: "5",
    stageName: "5. Alçadas de aprovação",
    activities: [
      { code: "5.1", name: "Definir alçadas de aprovação", autoCheckKey: "approval_levels_set" },
      { code: "5.2", name: "Definir aprovadores", autoCheckKey: "approvers_set" },
    ],
  },
  {
    stageCode: "6",
    stageName: "6. Operação",
    activities: [
      { code: "6.1", name: "Cadastrar contratos", autoCheckKey: "contracts_created" },
      { code: "6.2", name: "Validar todas as etapas", autoCheckKey: null },
      { code: "6.3", name: "Aprovar", autoCheckKey: "contract_approved" },
      { code: "6.4", name: "Confirmar a criação do contas a pagar", autoCheckKey: "payables_created" },
      { code: "6.5", name: "Confirmar a criação do contas a receber", autoCheckKey: "receivables_created" },
      { code: "6.6", name: "Confirmar integração com ERP", autoCheckKey: "erp_integration_confirmed" },
    ],
  },
];

export function flattenTemplate() {
  const rows = [];
  let sortOrder = 0;
  for (const stage of IMPLEMENTATION_TEMPLATE) {
    for (const activity of stage.activities) {
      sortOrder += 1;
      rows.push({
        stageCode: stage.stageCode,
        stageName: stage.stageName,
        activityCode: activity.code,
        activityName: activity.name,
        autoCheckKey: activity.autoCheckKey,
        sortOrder,
      });
    }
  }
  return rows;
}

export const TOTAL_ACTIVITIES = flattenTemplate().length;
