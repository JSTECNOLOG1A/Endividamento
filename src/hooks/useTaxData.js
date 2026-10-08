import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { taxGuidesApi } from "@/api/taxGuides";
import { taxPlanningApi } from "@/api/taxPlanning";
import { taxTitlesApi } from "@/api/taxTitles";
import { DEFAULT_QUERY_RETRIES } from "@/lib/query-client";
import { todayInBrazil } from "@/lib/taxDates";
import { computeTaxSignal, groupInstallmentsByAgreement, nextOpenInstallment } from "@/lib/taxSignal";
import { indexGuidesByInstallment } from "@/lib/taxGuides";

export const TAX_QUERY_KEYS = {
  agreements: ["tax-agreements"],
  installments: ["tax-installments"],
  openInstallments: ["tax-installments", "pendentes"],
  agreementInstallments: (agreementId) => ["tax-installments", "acordo", agreementId],
  entities: ["tax-entities"],
  guides: ["tax-guides"],
  currentGuides: ["tax-guides", "atuais"],
  installmentGuide: (installmentId) => ["tax-guides", "parcela", installmentId],
  guideSends: (installmentId) => ["tax-guides", "envios", installmentId],
  titles: ["tax-titles"],
  payableTitles: ["tax-titles", "contas-a-pagar"],
  agreementTitles: (agreementId) => ["tax-titles", "acordo", agreementId],
  planning: ["tax-planning"],
  planningFor: (params) => ["tax-planning", params],
};

// O CRUD genérico devolve no máximo 20.000 linhas por chamada e não pagina. Resposta que bate no teto é tratada
// como consulta incompleta: a tela mostra erro em vez de um semáforo calculado sobre parte dos dados.
export const READ_LIMIT = 20000;

/** Situações de parcela que o semáforo e a próxima parcela usam; pagas reconhecidas e canceladas não entram. */
const PENDING_INSTALLMENT_STATUSES = ["em_aberto", "paga_aguardando_reconhecimento"];

export class IncompleteReadError extends Error {
  constructor() {
    super(
      `Há mais de ${READ_LIMIT.toLocaleString("pt-BR")} registros para carregar de uma vez, então a situação dos parcelamentos ` +
        "não pode ser calculada com segurança. Fale com o suporte."
    );
    this.name = "IncompleteReadError";
  }
}

/** Repetir uma leitura que bateu no teto não muda o resultado; os demais erros seguem o padrão (uma nova tentativa). */
function retryUnlessIncomplete(failureCount, error) {
  return !(error instanceof IncompleteReadError) && failureCount < DEFAULT_QUERY_RETRIES;
}

async function readAll(promise) {
  const rows = await promise;
  if (Array.isArray(rows) && rows.length >= READ_LIMIT) throw new IncompleteReadError();
  return rows || [];
}

// Parcelamentos e empresas: a mesma leitura (e o mesmo cache) na carteira e nos filtros do Planejamento.
const agreementsQueryOptions = {
  queryKey: TAX_QUERY_KEYS.agreements,
  retry: retryUnlessIncomplete,
  queryFn: () => readAll(base44.entities.TaxAgreement.list("-created_date", READ_LIMIT)),
};

const entitiesQueryOptions = {
  queryKey: TAX_QUERY_KEYS.entities,
  retry: retryUnlessIncomplete,
  queryFn: () => readAll(base44.entities.CompanyEntity.list("", READ_LIMIT)),
};

/**
 * Parcelamentos de tributos com as parcelas pendentes, empresa, semáforo e guias já resolvidos.
 * `row.installments` traz só as parcelas em aberto ou aguardando reconhecimento — a lista completa de um acordo
 * vem de useAgreementInstallments. As guias atuais de todas as parcelas vêm numa chamada só
 * (`guidesByInstallment`); sem elas o valor para pagamento não é conhecido, então a falha é erro da tela inteira.
 */
export function useTaxPortfolio() {
  const agreementsQuery = useQuery(agreementsQueryOptions);
  const installmentsQuery = useQuery({
    queryKey: TAX_QUERY_KEYS.openInstallments,
    retry: retryUnlessIncomplete,
    queryFn: () =>
      readAll(
        base44.entities.TaxInstallment.filter({ situacao: { $in: PENDING_INSTALLMENT_STATUSES } }, "vencimento", READ_LIMIT)
      ),
  });
  const entitiesQuery = useQuery(entitiesQueryOptions);
  const guidesQuery = useQuery({
    queryKey: TAX_QUERY_KEYS.currentGuides,
    queryFn: async () => (await taxGuidesApi.listCurrent()) || [],
  });

  const today = todayInBrazil();

  const guidesByInstallment = useMemo(() => indexGuidesByInstallment(guidesQuery.data), [guidesQuery.data]);

  const rows = useMemo(() => {
    const byAgreement = groupInstallmentsByAgreement(installmentsQuery.data);
    const entityNames = new Map((entitiesQuery.data || []).map((item) => [item.id, item.entity_name]));
    return (agreementsQuery.data || []).map((agreement) => {
      const installments = byAgreement.get(agreement.id) || [];
      const { signal, recordsSignal } = computeTaxSignal(agreement, installments, today);
      const nextInstallment = nextOpenInstallment(installments);
      return {
        agreement,
        installments,
        entityName: entityNames.get(agreement.entity_id) || "Empresa não encontrada",
        signal,
        recordsSignal,
        statusKey: signal || agreement.situacao,
        nextInstallment,
        nextInstallmentGuide: nextInstallment ? guidesByInstallment.get(nextInstallment.id) || null : null,
      };
    });
  }, [agreementsQuery.data, installmentsQuery.data, entitiesQuery.data, guidesByInstallment, today]);

  return {
    rows,
    guidesByInstallment,
    entities: entitiesQuery.data || [],
    today,
    isLoading: agreementsQuery.isLoading || installmentsQuery.isLoading || entitiesQuery.isLoading || guidesQuery.isLoading,
    error: agreementsQuery.error || installmentsQuery.error || entitiesQuery.error || guidesQuery.error || null,
    refetch: () =>
      Promise.all([agreementsQuery.refetch(), installmentsQuery.refetch(), entitiesQuery.refetch(), guidesQuery.refetch()]),
  };
}

/** Todas as parcelas de um parcelamento, em ordem de número. */
export function useAgreementInstallments(agreementId) {
  const query = useQuery({
    queryKey: TAX_QUERY_KEYS.agreementInstallments(agreementId),
    retry: retryUnlessIncomplete,
    queryFn: () => readAll(base44.entities.TaxInstallment.filter({ agreement_id: agreementId }, "numero_parcela", READ_LIMIT)),
    enabled: Boolean(agreementId),
  });
  return {
    installments: query.data || [],
    isLoading: query.isLoading,
    error: query.error || null,
    refetch: query.refetch,
  };
}

export function useInvalidateTax() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: TAX_QUERY_KEYS.agreements }),
      queryClient.invalidateQueries({ queryKey: TAX_QUERY_KEYS.installments }),
      // Mudar ou excluir parcela faz o servidor verificar de novo as guias (vencimento, duplicidade).
      queryClient.invalidateQueries({ queryKey: TAX_QUERY_KEYS.guides }),
      // ...e o título de tributo da parcela acompanha (em segundo plano no servidor).
      queryClient.invalidateQueries({ queryKey: TAX_QUERY_KEYS.titles }),
      queryClient.invalidateQueries({ queryKey: TAX_QUERY_KEYS.planning }),
    ]);
}

/** Guia atual, parcela e guias anteriores de uma parcela. */
export function useInstallmentGuide(installmentId) {
  const query = useQuery({
    queryKey: TAX_QUERY_KEYS.installmentGuide(installmentId),
    queryFn: () => taxGuidesApi.get(installmentId),
    enabled: Boolean(installmentId),
  });
  return { data: query.data || null, isLoading: query.isLoading, error: query.error || null, refetch: query.refetch };
}

/** Envios por e-mail das guias de uma parcela (inclusive de guias já substituídas). */
export function useGuideSends(installmentId) {
  const query = useQuery({
    queryKey: TAX_QUERY_KEYS.guideSends(installmentId),
    queryFn: async () => (await taxGuidesApi.sends(installmentId)) || [],
    enabled: Boolean(installmentId),
  });
  return { sends: query.data || [], isLoading: query.isLoading, error: query.error || null, refetch: query.refetch };
}

// Guia e título mudam a parcela no servidor (o título segue a guia; a baixa no Protheus registra o pagamento da
// parcela). Uma invalidação por prefixo cobre todas as leituras de cada grupo — parcelas pendentes (semáforo e Visão
// geral), parcelas de cada parcelamento e o Planejamento — e só as que estão na tela são buscadas de novo; as demais ficam marcadas
// como velhas para a próxima vez que abrirem.
const GUIDE_AND_TITLE_KEYS = [TAX_QUERY_KEYS.guides, TAX_QUERY_KEYS.titles, TAX_QUERY_KEYS.installments, TAX_QUERY_KEYS.planning];

function invalidateGuidesAndTitles(queryClient) {
  return Promise.all(GUIDE_AND_TITLE_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

/**
 * Recarrega tudo o que mostra guia: lista de guias atuais, guia de cada parcela e envios — e os títulos de tributo,
 * que seguem a guia, e as parcelas, que o título pode ter atualizado.
 */
export function useInvalidateTaxGuides() {
  const queryClient = useQueryClient();
  return () => invalidateGuidesAndTitles(queryClient);
}

/**
 * Recarrega tudo o que mostra título de tributo (Contas a Pagar, parcelas e a guia, que traz o título junto) e as
 * parcelas, que a baixa no Protheus pode ter marcado como pagas.
 */
export function useInvalidateTaxTitles() {
  const queryClient = useQueryClient();
  return () => invalidateGuidesAndTitles(queryClient);
}

/** Títulos de tributo de Contas a Pagar. `enabled: false` para quem não tem a Gestão Tributária. */
export function usePayableTaxTitles({ enabled = true } = {}) {
  const query = useQuery({
    queryKey: TAX_QUERY_KEYS.payableTitles,
    queryFn: async () => (await taxTitlesApi.list()) || [],
    enabled,
  });
  return {
    titles: query.data || [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error || null,
    refetch: query.refetch,
  };
}

/** Títulos de tributo das parcelas de um parcelamento, indexados pela parcela. */
export function useAgreementTaxTitles(agreementId) {
  const query = useQuery({
    queryKey: TAX_QUERY_KEYS.agreementTitles(agreementId),
    queryFn: async () => (await taxTitlesApi.list({ agreementId })) || [],
    enabled: Boolean(agreementId),
  });
  const byInstallment = useMemo(() => new Map((query.data || []).map((title) => [title.installment_id, title])), [query.data]);
  return { byInstallment, isLoading: query.isLoading, error: query.error || null, refetch: query.refetch };
}

/** Erro de pedido (4xx) não muda ao repetir; falha de rede ou do servidor ganha uma nova tentativa. */
function retryUnlessClientError(failureCount, error) {
  const status = Number(error?.status);
  return !(status >= 400 && status < 500) && failureCount < DEFAULT_QUERY_RETRIES;
}

/**
 * Planejamento (calendário e fluxo de caixa) para os filtros dados — uma chamada só, com tudo somado no servidor.
 * `params`: o que vai na consulta (lib/taxPlanning.planningQueryParams).
 */
export function useTaxPlanning(params) {
  const query = useQuery({
    queryKey: TAX_QUERY_KEYS.planningFor(params),
    queryFn: () => taxPlanningApi.get(params),
    retry: retryUnlessClientError,
  });
  return { data: query.data || null, isLoading: query.isLoading, error: query.error || null, refetch: query.refetch };
}

/** Parcelamentos e empresas para montar as opções dos filtros do Planejamento (mesmo cache da carteira). */
export function useTaxFilterSources() {
  const agreementsQuery = useQuery(agreementsQueryOptions);
  const entitiesQuery = useQuery(entitiesQueryOptions);
  return {
    agreements: agreementsQuery.data || [],
    entities: entitiesQuery.data || [],
    isLoading: agreementsQuery.isLoading || entitiesQuery.isLoading,
    error: agreementsQuery.error || entitiesQuery.error || null,
    refetch: () => Promise.all([agreementsQuery.refetch(), entitiesQuery.refetch()]),
  };
}
