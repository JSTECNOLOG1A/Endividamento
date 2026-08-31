import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, Wallet, RefreshCw, AlertTriangle } from "lucide-react";
import { INDEXERS } from "@/lib/contractOptions";
import { toast } from "@/lib/notify";

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(Number(value) || 0);
}
function formatDate(value) {
  if (!value) return "—";
  return String(value).split("T")[0].split("-").reverse().join("/");
}
const parseBRNumber = (str) => {
  if (!str) return 0;
  const cleaned = String(str).replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
};

function rateLabel(contract) {
  if (!contract.indexer || contract.indexer === "NA") return `${contract.fixed_rate}% a.a.`;
  if (contract.indexer_mode === "PERCENTAGE") return `${contract.indexer_percentage}% do ${contract.indexer}`;
  return `${contract.indexer} + ${contract.indexer_spread}% a.a.`;
}

const emptyForm = {
  group_id: "", entity_id: "", bank_id: "",
  contract_number: "", operation_value: "",
  fixed_rate: "", indexer: "NA", indexer_spread: "",
  operation_date: new Date().toISOString().split("T")[0],
  final_maturity_date: "",
};

function NewAccountDialog({ open, onOpenChange, groups, entities, banks, onCreated }) {
  const [form, setForm] = useState(emptyForm);
  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));
  const filteredEntities = form.group_id ? entities.filter((e) => e.group_id === form.group_id) : [];
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => base44.entities.LoanContract.create({
      group_id: form.group_id,
      entity_id: form.entity_id,
      bank_id: form.bank_id,
      contract_number: form.contract_number,
      operation_category: "emprestimos",
      operation_type: "conta_garantida",
      operation_value: parseBRNumber(form.operation_value),
      fixed_rate: parseBRNumber(form.fixed_rate),
      indexer: form.indexer,
      indexer_spread: parseBRNumber(form.indexer_spread),
      operation_date: form.operation_date,
      final_maturity_date: form.final_maturity_date,
      calculation_system: "CONTA_GARANTIDA",
      status: "aprovado",
    }),
    onSuccess: async (created) => {
      toast.success("Conta garantida criada");
      setForm(emptyForm);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ["guaranteed-accounts"] });
      onCreated(created);
    },
    onError: (err) => toast.error("Erro ao criar: " + err.message),
  });

  const canSubmit = form.group_id && form.entity_id && form.bank_id && form.contract_number
    && parseBRNumber(form.operation_value) > 0 && form.operation_date && form.final_maturity_date;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Conta Garantida</DialogTitle>
          <DialogDescription>Limite rotativo com vencimento — os saques e pagamentos são lançados depois, na tela do contrato.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Grupo Econômico</Label>
              <Select value={form.group_id} onValueChange={(v) => { update("group_id", v); update("entity_id", ""); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.group_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Entidade</Label>
              <Select value={form.entity_id} onValueChange={(v) => update("entity_id", v)} disabled={!form.group_id}>
                <SelectTrigger className="h-9"><SelectValue placeholder={form.group_id ? "Selecione" : "Selecione um grupo primeiro"} /></SelectTrigger>
                <SelectContent>
                  {filteredEntities.map((e) => <SelectItem key={e.id} value={e.id}>{e.entity_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Banco</Label>
              <Select value={form.bank_id} onValueChange={(v) => update("bank_id", v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {banks.map((b) => <SelectItem key={b.id} value={b.id}>{b.bank_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Número do Contrato</Label>
              <Input className="h-9" value={form.contract_number} onChange={(e) => update("contract_number", e.target.value)} placeholder="000.000.000" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Limite Contratado (R$)</Label>
            <CurrencyInput className="flex h-9 w-full border border-slate-300 px-3 py-2 text-sm" value={form.operation_value} onChange={(e) => update("operation_value", e.target.value)} placeholder="0,00" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Indexador</Label>
              <Select value={form.indexer} onValueChange={(v) => update("indexer", v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INDEXERS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{form.indexer === "NA" ? "Taxa (% a.a.)" : "Taxa Fixa Adicional (% a.a.)"}</Label>
              <CurrencyInput type="percent" className="flex h-9 w-full border border-slate-300 px-3 py-2 text-sm" value={form.fixed_rate} onChange={(e) => update("fixed_rate", e.target.value)} placeholder="0,00" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Spread sobre {form.indexer !== "NA" ? form.indexer : "indexador"} (% a.a.)</Label>
              <CurrencyInput type="percent" className="flex h-9 w-full border border-slate-300 px-3 py-2 text-sm" value={form.indexer_spread} onChange={(e) => update("indexer_spread", e.target.value)} placeholder="0,00" disabled={form.indexer === "NA"} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Data de Abertura</Label>
              <Input className="h-9" type="date" value={form.operation_date} onChange={(e) => update("operation_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Vencimento</Label>
              <Input className="h-9" type="date" value={form.final_maturity_date} onChange={(e) => update("final_maturity_date", e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!canSubmit || createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? "Criando..." : "Criar Conta Garantida"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddMovementForm({ contractId, onAdded }) {
  const [type, setType] = useState("saque");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [amount, setAmount] = useState("");
  const [obs, setObs] = useState("");

  const mutation = useMutation({
    mutationFn: () => base44.entities.AccountMovement.create({
      contract_id: contractId,
      movement_date: date,
      movement_type: type,
      amount: parseBRNumber(amount),
      observacao: obs || null,
    }),
    onSuccess: () => {
      toast.success(type === "saque" ? "Saque lançado" : "Pagamento lançado");
      setAmount("");
      setObs("");
      onAdded();
    },
    onError: (err) => toast.error("Erro ao lançar: " + err.message),
  });

  return (
    <div className="flex flex-wrap items-end gap-3 p-4 bg-slate-50 border border-slate-200">
      <div className="space-y-1.5">
        <Label className="text-xs">Tipo</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="saque">Saque</SelectItem>
            <SelectItem value="pagamento">Pagamento</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Data</Label>
        <Input className="h-9 w-40" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Valor (R$)</Label>
        <CurrencyInput className="flex h-9 w-40 border border-slate-300 px-3 py-2 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
      </div>
      <div className="space-y-1.5 flex-1 min-w-[180px]">
        <Label className="text-xs">Observação (opcional)</Label>
        <Input className="h-9" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: capital de giro" />
      </div>
      <Button
        size="sm"
        disabled={parseBRNumber(amount) <= 0 || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? "Lançando..." : "Lançar"}
      </Button>
    </div>
  );
}

function RenewDialog({ open, onOpenChange, contract, statement, onRenewed }) {
  const [newLimit, setNewLimit] = useState("");
  const [newMaturity, setNewMaturity] = useState("");
  const [newOpenDate, setNewOpenDate] = useState(contract?.final_maturity_date?.split("T")[0] || "");

  React.useEffect(() => {
    if (open) {
      setNewLimit("");
      setNewMaturity("");
      setNewOpenDate(contract?.final_maturity_date?.split("T")[0] || new Date().toISOString().split("T")[0]);
    }
  }, [open, contract]);

  const mutation = useMutation({
    mutationFn: () => base44.functions.invoke("renewGuaranteedAccount", {
      contractId: contract.id,
      newLimit: parseBRNumber(newLimit),
      newMaturityDate: newMaturity,
      newOperationDate: newOpenDate,
    }),
    onSuccess: (res) => {
      toast.success(`Renovado — saldo de ${formatCurrency(res.data.saldo_transferido)} transferido para o novo contrato`);
      onOpenChange(false);
      onRenewed(res.data.new_contract_id);
    },
    onError: (err) => toast.error("Erro ao renovar: " + err.message),
  });

  const canSubmit = parseBRNumber(newLimit) > 0 && newMaturity && newOpenDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Renovar Conta Garantida</DialogTitle>
          <DialogDescription>
            Encerra esta vigência (status "Devolvido") e cria uma nova com o saldo atual
            {statement ? ` (${formatCurrency(statement.saldo_atual)} na data de abertura da nova vigência)` : ""} como lançamento de abertura.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Novo Limite (R$)</Label>
            <CurrencyInput className="flex h-9 w-full border border-slate-300 px-3 py-2 text-sm" value={newLimit} onChange={(e) => setNewLimit(e.target.value)} placeholder="0,00" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Data de Abertura da Nova Vigência</Label>
              <Input className="h-9" type="date" value={newOpenDate} onChange={(e) => setNewOpenDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Novo Vencimento</Label>
              <Input className="h-9" type="date" value={newMaturity} onChange={(e) => setNewMaturity(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Renovando..." : "Confirmar Renovação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountDetail({ contract, banks, onBack, onSelectContract }) {
  const [renewOpen, setRenewOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: statement, isLoading, refetch } = useQuery({
    queryKey: ["guaranteed-account-statement", contract.id],
    queryFn: async () => (await base44.functions.invoke("calculateGuaranteedAccountStatement", { contractId: contract.id })).data,
  });

  const bankName = banks.find((b) => b.id === contract.bank_id)?.bank_name || "—";
  const isRenewed = contract.status === "cancelado" && contract.rejection_comments?.includes("Renovado");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5 text-xs">
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar
        </Button>
        {!isRenewed && (
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setRenewOpen(true)}>
            <RefreshCw className="w-3.5 h-3.5" /> Renovar
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-3">
              {bankName} — {contract.contract_number}
              <Badge variant={contract.status === "aprovado" ? "default" : "secondary"}>
                {isRenewed ? "Renovado" : contract.status === "aprovado" ? "Ativa" : contract.status}
              </Badge>
            </CardTitle>
            <CardDescription>
              Limite {formatCurrency(contract.operation_value)} • {rateLabel(contract)}
              {" "}• Abertura {formatDate(contract.operation_date)} • Vencimento {formatDate(contract.final_maturity_date)}
            </CardDescription>
          </div>
        </CardHeader>
        {isRenewed && (
          <CardContent className="pt-0">
            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 px-3 py-2">{contract.rejection_comments}</div>
          </CardContent>
        )}
      </Card>

      {statement && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-slate-600">Saldo Utilizado</div>
              <div className="text-xl font-bold mt-1">{formatCurrency(statement.saldo_atual)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-slate-600">Limite Disponível</div>
              <div className="text-xl font-bold mt-1 text-green-700">{formatCurrency(statement.limite_disponivel)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-slate-600">Juros Acumulados</div>
              <div className="text-xl font-bold mt-1">{formatCurrency(statement.total_juros_acumulado)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-slate-600">Posição em</div>
              <div className="text-xl font-bold mt-1">{formatDate(statement.as_of_date)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {statement?.excedeu_limite_alguma_vez && (
        <div className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          O saldo utilizado ultrapassou o limite contratado em algum momento do período (máximo: {formatCurrency(statement.saldo_maximo_no_periodo)}).
        </div>
      )}

      {!isRenewed && (
        <AddMovementForm contractId={contract.id} onAdded={() => { refetch(); queryClient.invalidateQueries({ queryKey: ["guaranteed-accounts"] }); }} />
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Extrato</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-slate-500 py-6 text-center">Calculando...</div>
          ) : !statement?.extrato?.length ? (
            <div className="text-sm text-slate-500 py-6 text-center">Nenhum lançamento ainda.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Juros do Período</TableHead>
                    <TableHead className="text-right">Saldo Após</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statement.extrato.map((row) => (
                    <TableRow key={row.movement_id} className={row.excedeu_limite ? "bg-amber-50" : ""}>
                      <TableCell>{formatDate(row.date)}</TableCell>
                      <TableCell className="capitalize">{row.type.replace("_", " ")}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.amount)}</TableCell>
                      <TableCell className="text-right text-slate-500">{formatCurrency(row.juros_periodo)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(row.saldo_apos)}</TableCell>
                    </TableRow>
                  ))}
                  {statement.juros_periodo_final > 0 && (
                    <TableRow className="bg-slate-50">
                      <TableCell>{formatDate(statement.as_of_date)}</TableCell>
                      <TableCell className="text-slate-500">Juros até a posição</TableCell>
                      <TableCell className="text-right">—</TableCell>
                      <TableCell className="text-right text-slate-500">{formatCurrency(statement.juros_periodo_final)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(statement.saldo_atual)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <RenewDialog
        open={renewOpen}
        onOpenChange={setRenewOpen}
        contract={contract}
        statement={statement}
        onRenewed={(newId) => {
          queryClient.invalidateQueries({ queryKey: ["guaranteed-accounts"] });
          onSelectContract(newId);
        }}
      />
    </div>
  );
}

export default function GuaranteedAccounts() {
  const [selectedId, setSelectedId] = useState(null);
  const [newOpen, setNewOpen] = useState(false);

  const { data: contracts, isLoading } = useQuery({
    queryKey: ["guaranteed-accounts"],
    queryFn: async () => (await base44.entities.LoanContract.list("-created_date", 1000))
      .filter((c) => c.operation_type === "conta_garantida"),
    initialData: [],
  });

  const { data: groups } = useQuery({ queryKey: ["groups"], queryFn: () => base44.entities.Group.list("", 100), initialData: [] });
  const { data: entities } = useQuery({ queryKey: ["entities"], queryFn: () => base44.entities.CompanyEntity.list("", 100), initialData: [] });
  const { data: banks } = useQuery({ queryKey: ["banks"], queryFn: () => base44.entities.Bank.list("", 100), initialData: [] });

  const selectedContract = contracts.find((c) => c.id === selectedId);

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      {selectedContract ? (
        <AccountDetail
          contract={selectedContract}
          banks={banks}
          onBack={() => setSelectedId(null)}
          onSelectContract={setSelectedId}
        />
      ) : (
        <>
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <Wallet className="w-5 h-5" /> Contas Garantidas
              </h1>
              <p className="text-sm text-slate-600 mt-0.5">Limites rotativos — juros sobre saldo utilizado, sem cronograma fixo</p>
            </div>
            <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}>
              <Plus className="w-4 h-4" /> Nova Conta Garantida
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="text-sm text-slate-500 py-10 text-center">Carregando...</div>
              ) : !contracts.length ? (
                <div className="text-sm text-slate-500 py-10 text-center">Nenhuma conta garantida cadastrada ainda.</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Contrato</TableHead>
                        <TableHead>Banco</TableHead>
                        <TableHead className="text-right">Limite</TableHead>
                        <TableHead>Taxa</TableHead>
                        <TableHead>Vencimento</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contracts.map((c) => (
                        <TableRow key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelectedId(c.id)}>
                          <TableCell className="font-medium">{c.contract_number}</TableCell>
                          <TableCell>{banks.find((b) => b.id === c.bank_id)?.bank_name || "—"}</TableCell>
                          <TableCell className="text-right">{formatCurrency(c.operation_value)}</TableCell>
                          <TableCell>{rateLabel(c)}</TableCell>
                          <TableCell>{formatDate(c.final_maturity_date)}</TableCell>
                          <TableCell>
                            <Badge variant={c.status === "aprovado" ? "default" : "secondary"}>
                              {c.status === "cancelado" && c.rejection_comments?.includes("Renovado") ? "Renovado" : c.status === "aprovado" ? "Ativa" : c.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <NewAccountDialog
            open={newOpen}
            onOpenChange={setNewOpen}
            groups={groups}
            entities={entities}
            banks={banks}
            onCreated={(created) => setSelectedId(created.id)}
          />
        </>
      )}
    </div>
  );
}
