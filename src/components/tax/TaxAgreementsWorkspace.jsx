import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { toast } from "@/lib/notify";
import { todayInBrazil } from "@/lib/taxDates";
import { canWriteTax } from "@/lib/taxLabels";
import { GUIDE_URL_PARAM } from "@/lib/taxGuides";
import { useAgreementInstallments, useInvalidateTax, useTaxPortfolio } from "@/hooks/useTaxData";
import { TaxEmptyState, TaxErrorState, TaxLoadingState } from "./TaxPageShell";
import TaxAgreementList from "./TaxAgreementList";
import TaxAgreementDetail from "./TaxAgreementDetail";
import TaxAgreementFormDialog from "./TaxAgreementFormDialog";
import TaxConfirmDialog from "./TaxConfirmDialog";

const DETAIL_PARAM = "acordo";

function deleteDescription({ installments, isLoading, error }) {
  const irreversible = "Essa ação não pode ser desfeita.";
  if (isLoading) return "Contando as parcelas cadastradas nele…";
  if (error) return `Todas as parcelas cadastradas nele também serão apagadas. ${irreversible}`;
  const count = installments.length;
  if (count === 0) return `Não há parcelas cadastradas nele. ${irreversible}`;
  return `${count === 1 ? "A parcela cadastrada nele também será apagada" : `As ${count} parcelas cadastradas nele também serão apagadas`}. ${irreversible}`;
}

/** Parcelamentos de uma esfera: lista, detalhe e as ações sobre o acordo (cadastrar, editar, conferir, excluir). */
export default function TaxAgreementsWorkspace({ esfera }) {
  const { user } = useAuth();
  const canWrite = canWriteTax(user);
  const [searchParams, setSearchParams] = useSearchParams();
  const { rows, guidesByInstallment, entities, today, isLoading, error, refetch } = useTaxPortfolio();
  const invalidateTax = useInvalidateTax();

  const [formOpen, setFormOpen] = useState(false);
  const [editingAgreement, setEditingAgreement] = useState(null);
  const [deletingRow, setDeletingRow] = useState(null);

  const deletingInstallments = useAgreementInstallments(deletingRow?.agreement.id);
  const sphereRows = rows.filter((row) => row.agreement.esfera === esfera);
  const detailId = searchParams.get(DETAIL_PARAM);
  const detailRow = detailId ? sphereRows.find((row) => row.agreement.id === detailId) : null;
  const portalName = esfera === "estadual" ? "portal" : "e-CAC";

  const paramsWith = (changes) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    return next;
  };
  const updateParams = (changes) => setSearchParams(paramsWith(changes));

  const confirmTodayMutation = useMutation({
    mutationFn: (agreement) => base44.entities.TaxAgreement.update(agreement.id, { ultima_conferencia: todayInBrazil() }),
    onSuccess: async () => {
      toast.success(`Conferência no ${portalName} registrada com a data de hoje`);
      await invalidateTax();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (agreement) => base44.entities.TaxAgreement.delete(agreement.id),
    onSuccess: async (result) => {
      const removed = Number(result?.parcelas_excluidas || 0);
      toast.success(
        removed
          ? `Parcelamento excluído junto com ${removed} ${removed === 1 ? "parcela" : "parcelas"}`
          : "Parcelamento excluído"
      );
      if (deletingRow && deletingRow.agreement.id === detailId) updateParams({ [DETAIL_PARAM]: null, [GUIDE_URL_PARAM]: null });
      setDeletingRow(null);
      await invalidateTax();
    },
    onError: (err) => toast.error(err.message),
  });

  const actions = {
    canWrite,
    portalName,
    today,
    confirmingId: confirmTodayMutation.isPending ? confirmTodayMutation.variables?.id : null,
    onOpen: (row) => updateParams({ [DETAIL_PARAM]: row.agreement.id }),
    detailLink: (row) => ({ search: `?${paramsWith({ [DETAIL_PARAM]: row.agreement.id }).toString()}` }),
    onCreate: () => {
      setEditingAgreement(null);
      setFormOpen(true);
    },
    onEdit: (row) => {
      setEditingAgreement(row.agreement);
      setFormOpen(true);
    },
    onDelete: (row) => setDeletingRow(row),
    onConfirmToday: (row) => confirmTodayMutation.mutate(row.agreement),
  };

  let content;
  if (isLoading) {
    content = <TaxLoadingState />;
  } else if (error) {
    content = <TaxErrorState message={error.message} onRetry={refetch} />;
  } else if (detailId && !detailRow) {
    content = (
      <TaxEmptyState title="Parcelamento não encontrado">
        Ele pode ter sido excluído.{" "}
        <button
          type="button"
          className="font-medium text-slate-700 underline"
          onClick={() => updateParams({ [DETAIL_PARAM]: null, [GUIDE_URL_PARAM]: null })}
        >
          Voltar para a lista
        </button>
      </TaxEmptyState>
    );
  } else if (detailRow) {
    content = (
      <TaxAgreementDetail
        row={detailRow}
        guidesByInstallment={guidesByInstallment}
        actions={actions}
        onBack={() => updateParams({ [DETAIL_PARAM]: null, [GUIDE_URL_PARAM]: null })}
      />
    );
  } else {
    content = (
      <TaxAgreementList
        esfera={esfera}
        rows={sphereRows}
        entities={entities}
        actions={actions}
        statusFilter={searchParams.get("situacao") || "todas"}
        onStatusFilterChange={(value) => updateParams({ situacao: value === "todas" ? null : value })}
      />
    );
  }


  return (
    <>
      {content}
      <TaxAgreementFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        esfera={esfera}
        agreement={editingAgreement}
        entities={entities}
      />
      <TaxConfirmDialog
        open={Boolean(deletingRow)}
        title={`Excluir o parcelamento nº ${deletingRow?.agreement.codigo_parcelamento ?? ""}?`}
        description={deleteDescription(deletingInstallments)}
        confirmLabel="Excluir parcelamento"
        busy={deleteMutation.isPending}
        confirmDisabled={deletingInstallments.isLoading}
        onConfirm={() => deleteMutation.mutate(deletingRow.agreement)}
        onCancel={() => setDeletingRow(null)}
      />
    </>
  );
}
