import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/lib/notify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileText, Download, Mail, Search } from "lucide-react";

function sanitizeFilename(name) {
  return String(name || "documento")
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

async function downloadRenamed(url, filename) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    toast.error("Erro ao baixar o arquivo: " + (err.message || "tente novamente"));
  }
}

function EmailDialog({ open, onOpenChange, document }) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!email.trim()) {
      toast.warning("Informe o e-mail do destinatário.");
      return;
    }
    setSending(true);
    try {
      const { data } = await base44.functions.invoke("sendDocumentByEmail", {
        document_type: document.documentType,
        document_id: document.id,
        to_email: email.trim(),
      });
      if (data?.status === "simulado") {
        toast.success("Registrado. O envio real de e-mail ainda não está configurado neste sistema — nenhum e-mail foi disparado de fato.");
      } else {
        toast.success("E-mail enviado.");
      }
      onOpenChange(false);
      setEmail("");
    } catch (err) {
      toast.error("Erro ao registrar envio: " + (err.message || "tente novamente"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="w-4 h-4" /> Enviar por e-mail</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-slate-600">{document?.label}</p>
          <div className="space-y-1">
            <Label className="text-xs">E-mail do destinatário</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.com" />
          </div>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            O envio real de e-mail ainda não está configurado neste sistema — por enquanto, isso só registra o
            pedido (visível em auditoria) com um link pro documento.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>Cancelar</Button>
          <Button type="button" onClick={handleSend} disabled={sending}>{sending ? "Enviando..." : "Enviar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Documents() {
  const [search, setSearch] = useState("");
  const [emailTarget, setEmailTarget] = useState(null);

  const { data: contracts = [] } = useQuery({
    queryKey: ["documents-contracts"],
    queryFn: () => base44.entities.LoanContract.list("-created_date", 5000),
    initialData: [],
  });

  const { data: settlements = [] } = useQuery({
    queryKey: ["documents-settlements"],
    queryFn: () => base44.entities.ContractSettlement.list("-created_date", 5000),
    initialData: [],
  });

  const { data: banks = [] } = useQuery({
    queryKey: ["banks"],
    queryFn: () => base44.entities.Bank.list("", 1000),
    initialData: [],
  });

  const { data: entities = [] } = useQuery({
    queryKey: ["entities"],
    queryFn: () => base44.entities.CompanyEntity.list("", 1000),
    initialData: [],
  });

  const bankName = (bankId) => banks.find((b) => b.id === bankId)?.bank_name || "Sem Banco";
  const entityName = (entityId) => entities.find((e) => e.id === entityId)?.entity_name || "";
  const contractById = useMemo(() => new Map(contracts.map((c) => [c.id, c])), [contracts]);

  const rows = useMemo(() => {
    const contractRows = contracts
      .filter((c) => c.contract_pdf_url)
      .map((c) => ({
        documentType: "contract_pdf",
        id: c.id,
        tipo: "Contrato",
        banco: bankName(c.bank_id),
        contrato: c.contract_number,
        empresa: entityName(c.entity_id),
        data: c.created_date,
        url: c.contract_pdf_url,
        label: `Contrato — ${bankName(c.bank_id)} nº ${c.contract_number}`,
      }));

    const settlementRows = settlements
      .filter((s) => s.proof_url)
      .map((s) => {
        const contract = contractById.get(s.contract_id);
        return {
          documentType: "settlement_proof",
          id: s.id,
          tipo: "Comprovante de baixa",
          banco: contract ? bankName(contract.bank_id) : "—",
          contrato: contract ? `${contract.contract_number} (parcela ${s.parcela || "-"})` : s.contract_id,
          empresa: contract ? entityName(contract.entity_id) : "",
          data: s.actual_payment_date || s.created_date,
          url: s.proof_url,
          label: `Comprovante de baixa — ${contract ? `${bankName(contract.bank_id)} nº ${contract.contract_number}` : s.contract_id} — parcela ${s.parcela || "-"}`,
        };
      });

    return [...contractRows, ...settlementRows].sort((a, b) => (a.data < b.data ? 1 : -1));
  }, [contracts, settlements, banks, entities, contractById]);

  const filteredRows = rows.filter((r) => {
    if (!search.trim()) return true;
    const term = search.trim().toLowerCase();
    return (
      r.banco.toLowerCase().includes(term) ||
      String(r.contrato).toLowerCase().includes(term) ||
      r.empresa.toLowerCase().includes(term)
    );
  });

  const handleDownload = (row) => {
    const filename = `${sanitizeFilename(row.banco)}_${sanitizeFilename(row.contrato)}.pdf`;
    downloadRenamed(row.url, filename);
  };

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Documentos</p>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Diretório de PDFs</h1>
          <p className="text-sm text-slate-500 mt-1">
            Todos os PDFs anexados no sistema — contratos e comprovantes de baixa — num só lugar.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="relative max-w-sm">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por banco, contrato ou empresa..."
                className="pl-8 h-9"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <FileText className="w-4 h-4" /> {filteredRows.length} documento(s)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredRows.length === 0 ? (
              <p className="text-sm text-slate-500 py-10 text-center">Nenhum PDF encontrado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[820px]">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left font-medium text-slate-500 uppercase text-xs px-2 py-2">Tipo</th>
                      <th className="text-left font-medium text-slate-500 uppercase text-xs px-2 py-2">Banco</th>
                      <th className="text-left font-medium text-slate-500 uppercase text-xs px-2 py-2">Contrato</th>
                      <th className="text-left font-medium text-slate-500 uppercase text-xs px-2 py-2">Empresa</th>
                      <th className="text-left font-medium text-slate-500 uppercase text-xs px-2 py-2">Data</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <tr key={`${row.documentType}-${row.id}`} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-2">
                          <Badge variant={row.documentType === "contract_pdf" ? "default" : "secondary"}>{row.tipo}</Badge>
                        </td>
                        <td className="px-2 py-2 text-slate-700">{row.banco}</td>
                        <td className="px-2 py-2 text-slate-700">{row.contrato}</td>
                        <td className="px-2 py-2 text-slate-700">{row.empresa}</td>
                        <td className="px-2 py-2 text-slate-700">{row.data ? String(row.data).slice(0, 10).split("-").reverse().join("/") : "—"}</td>
                        <td className="px-2 py-2 text-right">
                          <div className="flex gap-1.5 justify-end">
                            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => handleDownload(row)}>
                              <Download className="w-3 h-3" /> Baixar
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setEmailTarget(row)}>
                              <Mail className="w-3 h-3" /> E-mail
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <EmailDialog open={!!emailTarget} onOpenChange={(open) => !open && setEmailTarget(null)} document={emailTarget} />
    </div>
  );
}
