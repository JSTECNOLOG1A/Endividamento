import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { DEFAULT_QUERY_RETRIES } from "@/lib/query-client";
import { todayInBrazil } from "@/lib/taxDates";
import { computeTaxSignal, groupInstallmentsByAgreement, nextOpenInstallment } from "@/lib/taxSignal";

export const TAX_QUERY_KEYS = {
  agreements: ["tax-agreements"],
  installments: ["tax-installments"],
  openInstallments: ["tax-installments", "pendentes"],
  agreementInstallments: (agreementId) => ["tax-installments", "acordo", agreementId],
  entities: ["tax-entities"],
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

/**
 * Parcelamentos de tributos com as parcelas pendentes, empresa e semáforo já resolvidos.
 * `row.installments` traz só as parcelas em aberto ou aguardando reconhecimento — a lista completa de um acordo
 * vem de useAgreementInstallments.
 */
export function useTaxPortfolio() {
  const agreementsQuery = useQuery({
    queryKey: TAX_QUERY_KEYS.agreements,
    retry: retryUnlessIncomplete,
    queryFn: () => readAll(base44.entities.TaxAgreement.list("-created_date", READ_LIMIT)),
  });
  const installmentsQuery = useQuery({
    queryKey: TAX_QUERY_KEYS.openInstallments,
    retry: retryUnlessIncomplete,
    queryFn: () =>
      readAll(
        base44.entities.TaxInstallment.filter({ situacao: { $in: PENDING_INSTALLMENT_STATUSES } }, "vencimento", READ_LIMIT)
      ),
  });
  const entitiesQuery = useQuery({
    queryKey: TAX_QUERY_KEYS.entities,
    retry: retryUnlessIncomplete,
    queryFn: () => readAll(base44.entities.CompanyEntity.list("", READ_LIMIT)),
  });

  const today = todayInBrazil();

  const rows = useMemo(() => {
    const byAgreement = groupInstallmentsByAgreement(installmentsQuery.data);
    const entityNames = new Map((entitiesQuery.data || []).map((item) => [item.id, item.entity_name]));
    return (agreementsQuery.data || []).map((agreement) => {
      const installments = byAgreement.get(agreement.id) || [];
      const { signal, recordsSignal } = computeTaxSignal(agreement, installments, today);
      return {
        agreement,
        installments,
        entityName: entityNames.get(agreement.entity_id) || "Empresa não encontrada",
        signal,
        recordsSignal,
        statusKey: signal || agreement.situacao,
        nextInstallment: nextOpenInstallment(installments),
      };
    });
  }, [agreementsQuery.data, installmentsQuery.data, entitiesQuery.data, today]);

  return {
    rows,
    entities: entitiesQuery.data || [],
    today,
    isLoading: agreementsQuery.isLoading || installmentsQuery.isLoading || entitiesQuery.isLoading,
    error: agreementsQuery.error || installmentsQuery.error || entitiesQuery.error || null,
    refetch: () => Promise.all([agreementsQuery.refetch(), installmentsQuery.refetch(), entitiesQuery.refetch()]),
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
    ]);
}
