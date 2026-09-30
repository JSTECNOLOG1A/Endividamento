import React, { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "@/lib/notify";
import { commercialProposalsApi } from "@/api/commercialProposals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, Loader2, Paperclip, X } from "lucide-react";
import {
  ACCEPTANCE_CHANNEL_OPTIONS,
  MAX_SIGNED_FILE_BYTES,
  OUTCOME_TEXT_MAX_LENGTH,
  SIGNER_NAME_MAX_LENGTH,
  SIGNER_ROLE_MAX_LENGTH,
  acceptanceChannelLabel,
  asSentence,
  formatDateOnlyBR,
  formatFileSize,
  isProposalClosedError,
  serverMessage,
  todayInSaoPaulo,
} from "./proposalOutcome";

const MAX_FILE_MB = Math.round(MAX_SIGNED_FILE_BYTES / (1024 * 1024));

function isRealDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Mesmas regras do servidor, conferidas antes do envio para a pessoa ver o
// problema ao lado do campo.
function buildAcceptSchema(today) {
  return z.object({
    data_assinatura: z.string().trim()
      .min(1, "Informe a data em que o cliente assinou.")
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de assinatura inválida.")
      .refine(isRealDate, "Data de assinatura inválida.")
      .refine((value) => value <= today, "A data da assinatura não pode ser depois de hoje."),
    nome_assinante: z.string().trim()
      .min(1, "Informe o nome de quem assinou pelo cliente.")
      .max(SIGNER_NAME_MAX_LENGTH, `O nome pode ter no máximo ${SIGNER_NAME_MAX_LENGTH} caracteres.`),
    cargo_assinante: z.string().trim()
      .max(SIGNER_ROLE_MAX_LENGTH, `O cargo pode ter no máximo ${SIGNER_ROLE_MAX_LENGTH} caracteres.`),
    canal_aceite: z.enum(ACCEPTANCE_CHANNEL_OPTIONS.map((option) => option.value), {
      errorMap: () => ({ message: "Informe como o cliente devolveu a proposta assinada." }),
    }),
    observacao_aceite: z.string().trim()
      .max(OUTCOME_TEXT_MAX_LENGTH, `A observação pode ter no máximo ${OUTCOME_TEXT_MAX_LENGTH} caracteres.`),
  });
}

function validateFile(file) {
  if (!file) return "";
  const looksLikePdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!looksLikePdf) return "O arquivo precisa ser um PDF.";
  if (file.size === 0) return "O arquivo escolhido está vazio.";
  if (file.size > MAX_SIGNED_FILE_BYTES) return `O arquivo passa do tamanho máximo de ${MAX_FILE_MB} MB.`;
  return "";
}

function emptyForm() {
  return { data_assinatura: todayInSaoPaulo(), nome_assinante: "", cargo_assinante: "", canal_aceite: "", observacao_aceite: "" };
}

function FieldError({ id, message }) {
  if (!message) return null;
  return <p id={id} className="text-xs text-red-600">{message}</p>;
}

// Registro do aceite: o cliente assinou a proposta. Irreversível — depois de
// gravado, a proposta não pode mais ser alterada nem enviada. Por isso a janela
// tem duas etapas: preencher e confirmar.
// `onDone(proposal | null)` recebe a proposta atualizada, ou null quando a
// tela precisa recarregar (proposta já encerrada ou não encontrada).
export default function ProposalAcceptDialog({ open, onOpenChange, proposal, expired, onDone }) {
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [step, setStep] = useState("form"); // "form" | "confirm"
  const [validated, setValidated] = useState(null);
  const fileInputRef = useRef(null);
  const today = todayInSaoPaulo();

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm());
    setFile(null);
    setErrors({});
    setServerError("");
    setStep("form");
    setValidated(null);
  }, [open]);

  const acceptMutation = useMutation({
    mutationFn: (payload) => commercialProposalsApi.accept(proposal.id, payload),
    onSuccess: (updated) => {
      const numero = updated?.numero || proposal.numero;
      toast.success(numero ? `Aceite da proposta ${numero} registrado.` : "Aceite registrado.");
      onDone?.(updated);
      onOpenChange(false);
    },
    onError: (error) => {
      const text = serverMessage(error, "Não foi possível registrar o aceite. Tente novamente.");
      if (isProposalClosedError(error) || error.status === 404) {
        toast.error(text);
        onDone?.(null);
        onOpenChange(false);
        return;
      }
      setStep("form");
      if (error.status === 413) {
        // Limite informado pelo servidor; a constante local serve só para a
        // conferência antes do envio.
        const maxBytes = Number(error.data?.details?.max_bytes) || MAX_SIGNED_FILE_BYTES;
        setErrors((current) => ({ ...current, file: `O arquivo passa do tamanho máximo de ${formatFileSize(maxBytes)}.` }));
        return;
      }
      setServerError(text);
    },
  });

  const saving = acceptMutation.isPending;

  const setField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: "" }));
  };

  const handleFileChange = (event) => {
    const chosen = event.target.files?.[0] || null;
    // Limpa o seletor para que escolher o mesmo arquivo de novo dispare a troca.
    event.target.value = "";
    if (!chosen) return;
    const problem = validateFile(chosen);
    setErrors((current) => ({ ...current, file: problem }));
    setFile(problem ? null : chosen);
  };

  const handleContinue = () => {
    setServerError("");
    const parsed = buildAcceptSchema(today).safeParse(form);
    const nextErrors = {};
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) => {
        const field = issue.path[0];
        if (field && !nextErrors[field]) nextErrors[field] = issue.message;
      });
    }
    const fileProblem = validateFile(file);
    if (fileProblem) nextErrors.file = fileProblem;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setValidated(parsed.data);
    setStep("confirm");
  };

  const handleConfirm = () => {
    if (saving || !validated) return;
    acceptMutation.mutate({
      data_assinatura: validated.data_assinatura,
      nome_assinante: validated.nome_assinante,
      cargo_assinante: validated.cargo_assinante || undefined,
      canal_aceite: validated.canal_aceite,
      observacao_aceite: validated.observacao_aceite || undefined,
      file: file || undefined,
    });
  };

  const handleOpenChange = (next) => {
    if (saving) return;
    onOpenChange(next);
  };

  const proposalName = [proposal?.numero, proposal?.client_name].filter(Boolean).join(" — ");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Registrar aceite
          </DialogTitle>
          <DialogDescription>
            {proposalName ? `${asSentence(`Proposta ${proposalName}`)} ` : ""}
            Registre aqui que o cliente assinou a proposta.
          </DialogDescription>
        </DialogHeader>

        {step === "form" ? (
          <form
            className="space-y-4 py-1"
            onSubmit={(e) => { e.preventDefault(); handleContinue(); }}
            noValidate
          >
            {expired && (
              <div role="status" className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>O prazo de validade desta proposta já passou. Você ainda pode registrar o aceite se o cliente assinou mesmo assim.</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="proposal-accept-date" className="text-xs text-slate-500">Data da assinatura pelo cliente</Label>
                <Input
                  id="proposal-accept-date"
                  type="date"
                  className="h-9 text-sm"
                  max={today}
                  value={form.data_assinatura}
                  aria-invalid={errors.data_assinatura ? "true" : undefined}
                  aria-describedby={errors.data_assinatura ? "proposal-accept-date-error" : undefined}
                  onChange={(e) => setField("data_assinatura", e.target.value)}
                />
                <FieldError id="proposal-accept-date-error" message={errors.data_assinatura} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="proposal-accept-channel" className="text-xs text-slate-500">Como o cliente devolveu</Label>
                <Select value={form.canal_aceite} onValueChange={(value) => setField("canal_aceite", value)}>
                  <SelectTrigger
                    id="proposal-accept-channel"
                    className="h-9 text-sm"
                    aria-invalid={errors.canal_aceite ? "true" : undefined}
                    aria-describedby={errors.canal_aceite ? "proposal-accept-channel-error" : undefined}
                  >
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCEPTANCE_CHANNEL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError id="proposal-accept-channel-error" message={errors.canal_aceite} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="proposal-accept-signer" className="text-xs text-slate-500">Nome de quem assinou pelo cliente</Label>
                <Input
                  id="proposal-accept-signer"
                  className="h-9 text-sm"
                  maxLength={SIGNER_NAME_MAX_LENGTH}
                  value={form.nome_assinante}
                  aria-invalid={errors.nome_assinante ? "true" : undefined}
                  aria-describedby={errors.nome_assinante ? "proposal-accept-signer-error" : undefined}
                  onChange={(e) => setField("nome_assinante", e.target.value)}
                  placeholder="Ex.: Maria da Silva"
                  autoFocus
                />
                <FieldError id="proposal-accept-signer-error" message={errors.nome_assinante} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="proposal-accept-role" className="text-xs text-slate-500">Cargo de quem assinou (opcional)</Label>
                <Input
                  id="proposal-accept-role"
                  className="h-9 text-sm"
                  maxLength={SIGNER_ROLE_MAX_LENGTH}
                  value={form.cargo_assinante}
                  aria-invalid={errors.cargo_assinante ? "true" : undefined}
                  aria-describedby={errors.cargo_assinante ? "proposal-accept-role-error" : undefined}
                  onChange={(e) => setField("cargo_assinante", e.target.value)}
                  placeholder="Ex.: Diretora financeira"
                />
                <FieldError id="proposal-accept-role-error" message={errors.cargo_assinante} />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="proposal-accept-note" className="text-xs text-slate-500">Observação (opcional)</Label>
                <span className={`text-[11px] ${form.observacao_aceite.length >= OUTCOME_TEXT_MAX_LENGTH ? "text-amber-700" : "text-slate-400"}`}>
                  {form.observacao_aceite.length}/{OUTCOME_TEXT_MAX_LENGTH}
                </span>
              </div>
              <Textarea
                id="proposal-accept-note"
                rows={3}
                className="text-sm resize-none"
                maxLength={OUTCOME_TEXT_MAX_LENGTH}
                value={form.observacao_aceite}
                onChange={(e) => setField("observacao_aceite", e.target.value)}
                placeholder="Ex.: assinada na reunião de fechamento."
              />
              <FieldError message={errors.observacao_aceite} />
            </div>

            <div className="space-y-1">
              <Label htmlFor="proposal-accept-file" className="text-xs text-slate-500">Proposta assinada (opcional)</Label>
              <input
                id="proposal-accept-file"
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={handleFileChange}
              />
              {file ? (
                <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <Paperclip className="w-4 h-4 shrink-0 text-slate-500" />
                  <span className="truncate flex-1" title={file.name}>{file.name}</span>
                  <span className="text-xs text-slate-500 shrink-0">{formatFileSize(file.size)}</span>
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="Remover arquivo" aria-label="Remover arquivo" onClick={() => setFile(null)}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()}>
                  <Paperclip className="w-3.5 h-3.5" /> Escolher arquivo
                </Button>
              )}
              <p className="text-[11px] text-slate-500">Somente PDF, até {MAX_FILE_MB} MB.</p>
              <FieldError message={errors.file} />
            </div>

            {serverError && (
              <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {serverError}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>Cancelar</Button>
              <Button type="submit">Continuar</Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4 py-1 text-sm">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              <p className="font-semibold">Confira antes de confirmar.</p>
              <p className="text-xs mt-0.5">
                Depois de registrado, o aceite não pode ser desfeito: a proposta não poderá mais ser alterada nem enviada por e-mail.
              </p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-slate-500">Data da assinatura</dt>
              <dd className="font-medium">{formatDateOnlyBR(validated?.data_assinatura)}</dd>
              <dt className="text-slate-500">Assinada por</dt>
              <dd className="font-medium break-words">{[validated?.nome_assinante, validated?.cargo_assinante].filter(Boolean).join(" — ")}</dd>
              <dt className="text-slate-500">Como devolveu</dt>
              <dd className="font-medium">{acceptanceChannelLabel(validated?.canal_aceite)}</dd>
              <dt className="text-slate-500">Arquivo assinado</dt>
              <dd className="font-medium break-all">{file ? file.name : "Nenhum"}</dd>
            </dl>
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={saving} onClick={() => setStep("form")}>Voltar</Button>
              <Button type="button" className="gap-1.5" disabled={saving} onClick={handleConfirm}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {saving ? "Registrando..." : "Confirmar aceite"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
