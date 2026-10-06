import React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const CONFIRM_TONES = {
  danger: "bg-rose-600 hover:bg-rose-700",
  neutral: undefined,
};

/**
 * Confirmação de ação da Gestão Tributária. `tone="danger"` (padrão) para o que apaga ou tira algo de uso;
 * `tone="neutral"` para o que troca sem perder nada.
 */
export default function TaxConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy,
  busyLabel = "Excluindo…",
  confirmDisabled = false,
  tone = "danger",
  onConfirm,
  onCancel,
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className={CONFIRM_TONES[tone]}
            disabled={busy || confirmDisabled}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {busy ? busyLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
