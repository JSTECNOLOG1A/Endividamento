import React, { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { jsPDF } from "jspdf";
import { usePlatform } from "@/lib/PlatformContext";
import { toast } from "@/lib/notify";
import { pricingConfigApi } from "@/api/pricingConfig";
import { commercialProposalsApi } from "@/api/commercialProposals";
import { toBRDecimalString } from "@/lib/brNumber";
import { BRAND_CYAN, createPdfHelpers, drawFooterPages, slugify } from "@/lib/pdfBrand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Save, Loader2, Eye, Download, Search, Pencil, FilePlus2, Plus, ArrowLeft } from "lucide-react";

const PAGAMENTO_IMPLANTACAO_OPTIONS = [
  { value: "avista", label: "À vista" },
  { value: "entrada30_6x", label: "Entrada de 30% + saldo em até 6 parcelas" },
  { value: "parcelado12x", label: "Parcelado em até 12x" },
];

const PAGAMENTO_MENSALIDADE_OPTIONS = [
  { value: "boleto", label: "Boleto bancário" },
  { value: "pix", label: "PIX" },
  { value: "debito", label: "Débito recorrente" },
  { value: "cartao", label: "Cartão corporativo" },
];

const DIA_VENCIMENTO_OPTIONS = ["05", "10", "15", "20", "25"];

const MONTHS_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

// A contratada é sempre a Clarity IB — dados fixos, não editáveis por
// proposta (deixaram de ser campo de formulário a pedido do usuário, mas
// continuam entrando automaticamente na geração do contrato).
const CONTRATADA_NOME = "CLARITY IB LTDA";
const CONTRATADA_CNPJ = "52.922.276/0001-20";
const CONTRATADA_ENDERECO_PADRAO = "Av. dos Guarantãs, nº 190, Sala 06, Jardim Maringá — Sinop/MT — CEP 78556-206";
// Cláusulas padrão que também saíram do formulário (redundantes/fixas por
// contrato), mas continuam no texto gerado.
const SUPORTE_PADRAO = "Suporte técnico em horário comercial, por e-mail e canais oficiais da Clarity IB.";
const CANCELAMENTO_PRAZO_DIAS_PADRAO = "30";

// Mesmo parser usado em outros formulários do sistema (ex.:
// GuaranteedAccountFormDialog.jsx) — CurrencyInput trabalha com string em
// formato BR (1.234,56), aqui convertida pra número pra calcular.
const parseBRNumber = (str) => {
  if (!str) return 0;
  const cleaned = String(str).replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
};

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatDateBR(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = String(isoDate).split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

function formatDateTimeBR(isoTimestamp) {
  if (!isoTimestamp) return "—";
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}

const PROPOSAL_STATUS_LABELS = {
  elaborando: "Elaborando",
  enviada: "Enviada",
  aceita: "Aceita",
  recusada: "Recusada",
};

// "Expirada" nunca é gravada no banco — é só um rótulo calculado na hora de
// exibir, pra não travar o status real caso a proposta seja aceita/recusada
// depois do prazo de validade.
function proposalStatusLabel(record) {
  const base = PROPOSAL_STATUS_LABELS[record.status] || record.status;
  if (record.status === "elaborando" || record.status === "enviada") {
    const days = Number(record.validity_days) || 0;
    const createdAt = record.created_date ? new Date(record.created_date) : null;
    if (createdAt && days > 0) {
      const expiresAt = new Date(createdAt.getTime() + days * 86400000);
      if (expiresAt.getTime() < Date.now()) return "Expirada";
    }
  }
  return base;
}

function proposalStatusVariant(label) {
  if (label === "Aceita") return "default";
  if (label === "Recusada") return "destructive";
  if (label === "Expirada") return "secondary";
  return "outline";
}

const TIERS = [
  { value: "standard", prefix: "standard", label: "Standard", desc: "Tudo manual" },
  { value: "pro", prefix: "pro", label: "Standard Pro", desc: "Financeiro via API" },
  { value: "proii", prefix: "proii", label: "Standard Pro II", desc: "Financeiro + Contábil via API" },
];

const PARAM_FIELDS = [
  "standard_implantacao", "standard_mensalidade", "standard_bloco",
  "pro_implantacao", "pro_mensalidade", "pro_bloco",
  "proii_implantacao", "proii_mensalidade", "proii_bloco",
  "cadastramento_valor",
];

// A cada bloco fechado de 20 contratos além dos 10 inclusos na
// mensalidade-base soma um incremento fixo — não é cobrança por contrato
// individual. Ver Artifact "Planos AllDebt" onde esse modelo foi validado.
function blocksFor(count) {
  const n = Math.max(0, Math.round(Number(count) || 0));
  if (n <= 10) return 0;
  return Math.ceil((n - 10) / 20);
}

// Valores iniciais do formulário — usados tanto no useState de cada campo
// quanto para restaurar uma tela em branco ao clicar em "Nova proposta"
// (fábrica, não objeto fixo, porque cronogramaInicio nasce com a data atual).
function getDefaultFormValues() {
  return {
    clientName: "",
    clientCnpj: "",
    clientEndereco: "",
    contactName: "",
    contratanteCargo: "",
    propostaNumero: "",
    validityDays: "15",
    contratadaRepresentante: "Camila Locks",
    contratadaCargo: "Gerente de Projetos",
    tier: "standard",
    contractCount: "",
    wantCadastro: false,
    cadastroQty: "",
    qtdRenegociados: "",
    pagamentoImplantacao: "entrada30_6x",
    pagamentoMensalidade: "boleto",
    diaVencimento: "05",
    outrosValores: "",
    objeto: "Licenciamento de uso do sistema AllDebt — plataforma de gestão de empréstimos e financiamentos, na modalidade SaaS.",
    escopoDisponibilizacao: "Acesso ao sistema via ambiente web (nuvem), incluindo atualizações da versão contratada durante a vigência.",
    escopoImplantacao: "Configuração inicial do ambiente, parametrização dos planos contratados e cadastro da carteira inicial de contratos.",
    escopoIntegracoes: "",
    escopoTreinamento: "Treinamento inicial das equipes envolvidas na operação do sistema.",
    escopoDemais: "",
    cronogramaInicio: new Date().toISOString().slice(0, 10),
    cronogramaPrazo: "2 semanas",
    cronogramaContadoA: "assinatura desta proposta",
    equipeClarityIB: "1 Contador e 1 Analista de Implantação",
    equipeContratante: "",
    vigenciaDuracao: "12 (doze) meses",
    vigenciaInicio: "",
    vigenciaRenovacao: "A vigência será renovada automaticamente por períodos iguais e sucessivos, salvo manifestação em contrário de qualquer das partes, com antecedência mínima de 30 dias do término do período vigente.",
    foroComarca: "Sinop",
    foroEstado: "Mato Grosso",
    assinaturaCidade: "Sinop",
  };
}

export default function CommercialProposal() {
  const { isMaster } = usePlatform();
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ["pricing-config"],
    queryFn: () => pricingConfigApi.get(),
    enabled: isMaster,
  });

  const [params, setParams] = useState(null);
  useEffect(() => {
    if (!config) return;
    setParams(Object.fromEntries(PARAM_FIELDS.map((f) => [f, toBRDecimalString(config[f])])));
  }, [config]);

  const updateParam = (field, value) => setParams((p) => ({ ...p, [field]: value }));

  const saveMutation = useMutation({
    mutationFn: () =>
      pricingConfigApi.update(
        Object.fromEntries(PARAM_FIELDS.map((f) => [f, parseBRNumber(params[f])]))
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(["pricing-config"], saved);
      toast.success("Parâmetros salvos — valem para todos os admins a partir de agora.");
    },
    onError: (error) => toast.error(error.data?.error || error.message || "Erro ao salvar parâmetros"),
  });

  // Dados do cliente / proposta
  const [clientName, setClientName] = useState(() => getDefaultFormValues().clientName);
  const [clientCnpj, setClientCnpj] = useState(() => getDefaultFormValues().clientCnpj);
  const [clientEndereco, setClientEndereco] = useState(() => getDefaultFormValues().clientEndereco);
  const [contactName, setContactName] = useState(() => getDefaultFormValues().contactName);
  const [contratanteCargo, setContratanteCargo] = useState(() => getDefaultFormValues().contratanteCargo);
  const [propostaNumero, setPropostaNumero] = useState(() => getDefaultFormValues().propostaNumero);
  const [validityDays, setValidityDays] = useState(() => getDefaultFormValues().validityDays);

  // Dados da CONTRATADA (Clarity IB): razão social/CNPJ/endereço são fixos
  // (constantes no topo do arquivo) — só representante/cargo da assinatura
  // continuam editáveis, pois variam conforme quem assina.
  const [contratadaRepresentante, setContratadaRepresentante] = useState(() => getDefaultFormValues().contratadaRepresentante);
  const [contratadaCargo, setContratadaCargo] = useState(() => getDefaultFormValues().contratadaCargo);

  // Plano / preço
  const [tier, setTier] = useState(() => getDefaultFormValues().tier);
  const [contractCount, setContractCount] = useState(() => getDefaultFormValues().contractCount);
  const [wantCadastro, setWantCadastro] = useState(() => getDefaultFormValues().wantCadastro);
  const [cadastroQty, setCadastroQty] = useState(() => getDefaultFormValues().cadastroQty);
  const [qtdRenegociados, setQtdRenegociados] = useState(() => getDefaultFormValues().qtdRenegociados);
  const [pagamentoImplantacao, setPagamentoImplantacao] = useState(() => getDefaultFormValues().pagamentoImplantacao);
  const [pagamentoMensalidade, setPagamentoMensalidade] = useState(() => getDefaultFormValues().pagamentoMensalidade);
  const [diaVencimento, setDiaVencimento] = useState(() => getDefaultFormValues().diaVencimento);
  const [outrosValores, setOutrosValores] = useState(() => getDefaultFormValues().outrosValores);

  // Objeto e escopo (seção 2 e 3 do termo)
  const [objeto, setObjeto] = useState(() => getDefaultFormValues().objeto);
  const [escopoDisponibilizacao, setEscopoDisponibilizacao] = useState(() => getDefaultFormValues().escopoDisponibilizacao);
  const [escopoImplantacao, setEscopoImplantacao] = useState(() => getDefaultFormValues().escopoImplantacao);
  const [escopoIntegracoes, setEscopoIntegracoes] = useState(() => getDefaultFormValues().escopoIntegracoes);
  const [escopoTreinamento, setEscopoTreinamento] = useState(() => getDefaultFormValues().escopoTreinamento);
  const [escopoDemais, setEscopoDemais] = useState(() => getDefaultFormValues().escopoDemais);
  // "Módulos/funcionalidades contratados" saiu do formulário — o conteúdo já
  // fica coberto pelo campo Objeto, então não há linha correspondente no
  // contrato. "Suporte" saiu do formulário mas mantém o texto padrão fixo
  // (SUPORTE_PADRAO) no contrato.

  // Condições de execução (seção 5) — cronogramaInicio nasce com a data de
  // hoje (dia em que a proposta é gerada), mas continua editável.
  const [cronogramaInicio, setCronogramaInicio] = useState(() => getDefaultFormValues().cronogramaInicio);
  const [cronogramaPrazo, setCronogramaPrazo] = useState(() => getDefaultFormValues().cronogramaPrazo);
  const [cronogramaContadoA, setCronogramaContadoA] = useState(() => getDefaultFormValues().cronogramaContadoA);
  // Um campo só (qtd. + função juntos em texto livre) em vez dos dois
  // campos separados que existiam antes (quantidade / perfis).
  const [equipeClarityIB, setEquipeClarityIB] = useState(() => getDefaultFormValues().equipeClarityIB);
  const [equipeContratante, setEquipeContratante] = useState(() => getDefaultFormValues().equipeContratante);

  // Vigência, cancelamento e foro (seções 8 e 11)
  const [vigenciaDuracao, setVigenciaDuracao] = useState(() => getDefaultFormValues().vigenciaDuracao);
  const [vigenciaInicio, setVigenciaInicio] = useState(() => getDefaultFormValues().vigenciaInicio);
  const [vigenciaRenovacao, setVigenciaRenovacao] = useState(() => getDefaultFormValues().vigenciaRenovacao);
  // Prazo de aviso p/ cancelamento saiu do formulário — usa o padrão fixo
  // CANCELAMENTO_PRAZO_DIAS_PADRAO no contrato.
  const [foroComarca, setForoComarca] = useState(() => getDefaultFormValues().foroComarca);
  const [foroEstado, setForoEstado] = useState(() => getDefaultFormValues().foroEstado);
  const [assinaturaCidade, setAssinaturaCidade] = useState(() => getDefaultFormValues().assinaturaCidade);

  // Acervo de propostas salvas — id da proposta atualmente aberta (null =
  // proposta nova, ainda não salva) e busca do histórico. "view" controla
  // qual das duas telas do módulo está visível (lista ou formulário).
  const [view, setView] = useState("list"); // "list" | "form"
  const [currentProposalId, setCurrentProposalId] = useState(null);
  const [proposalSearchInput, setProposalSearchInput] = useState("");
  const [proposalSearch, setProposalSearch] = useState("");
  const [pendingAction, setPendingAction] = useState(null); // { type: "open"|"new"|"back", record? }
  const [viewingProposal, setViewingProposal] = useState(null);
  const savedSnapshotRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setProposalSearch(proposalSearchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [proposalSearchInput]);

  const { data: savedProposals, isLoading: loadingProposals } = useQuery({
    queryKey: ["commercial-proposals", proposalSearch],
    queryFn: () => commercialProposalsApi.list({ q: proposalSearch }),
    enabled: isMaster,
    initialData: [],
  });

  // Só os campos de entrada do formulário (sem os valores calculados, que só
  // existem depois do early-return de carregamento) — usado pra detectar
  // alterações não salvas independente de mudanças externas nos parâmetros
  // de precificação (trocar o preço padrão em outra aba não deve marcar
  // "alterações pendentes" numa proposta que o usuário não tocou).
  function buildProposalInputs() {
    return {
      numero: propostaNumero || null,
      client_name: clientName || null,
      client_cnpj: clientCnpj || null,
      client_endereco: clientEndereco || null,
      contact_name: contactName || null,
      contratante_cargo: contratanteCargo || null,
      validity_days: validityDays || null,
      tier,
      contract_count: contractCount || null,
      qtd_renegociados: qtdRenegociados || null,
      want_cadastro: wantCadastro,
      cadastro_qty: cadastroQty || null,
      pagamento_implantacao: pagamentoImplantacao,
      pagamento_mensalidade: pagamentoMensalidade,
      dia_vencimento: diaVencimento,
      outros_valores: outrosValores || null,
      objeto: objeto || null,
      escopo_disponibilizacao: escopoDisponibilizacao || null,
      escopo_implantacao: escopoImplantacao || null,
      escopo_integracoes: escopoIntegracoes || null,
      escopo_treinamento: escopoTreinamento || null,
      escopo_demais: escopoDemais || null,
      cronograma_inicio: cronogramaInicio || null,
      cronograma_prazo: cronogramaPrazo || null,
      cronograma_contado_a: cronogramaContadoA || null,
      equipe_clarity_ib: equipeClarityIB || null,
      equipe_contratante: equipeContratante || null,
      vigencia_duracao: vigenciaDuracao || null,
      vigencia_inicio: vigenciaInicio || null,
      vigencia_renovacao: vigenciaRenovacao || null,
      foro_comarca: foroComarca || null,
      foro_estado: foroEstado || null,
      assinatura_cidade: assinaturaCidade || null,
      contratada_representante: contratadaRepresentante || null,
      contratada_cargo: contratadaCargo || null,
    };
  }

  const currentInputsJson = JSON.stringify(buildProposalInputs());
  if (savedSnapshotRef.current === null) savedSnapshotRef.current = currentInputsJson;
  const isProposalDirty = currentInputsJson !== savedSnapshotRef.current;

  useEffect(() => {
    const handler = (e) => {
      if (!isProposalDirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isProposalDirty]);

  const createProposalMutation = useMutation({
    mutationFn: (payload) => commercialProposalsApi.create(payload),
    onSuccess: (created) => {
      setCurrentProposalId(created.id);
      setPropostaNumero(created.numero || "");
      savedSnapshotRef.current = null;
      queryClient.invalidateQueries({ queryKey: ["commercial-proposals"] });
      toast.success("Proposta salva com sucesso.");
    },
    onError: (error) => toast.error(error.data?.error || error.message || "Erro ao salvar proposta"),
  });

  const updateProposalMutation = useMutation({
    mutationFn: ({ id, payload }) => commercialProposalsApi.update(id, payload),
    onSuccess: () => {
      savedSnapshotRef.current = null;
      queryClient.invalidateQueries({ queryKey: ["commercial-proposals"] });
      toast.success("Proposta salva com sucesso.");
    },
    onError: (error) => toast.error(error.data?.error || error.message || "Erro ao salvar proposta"),
  });

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const docRef = useRef(null);
  const clientSlugRef = useRef("cliente");

  const [quickPreviewOpen, setQuickPreviewOpen] = useState(false);
  const [quickPreviewUrl, setQuickPreviewUrl] = useState(null);
  const quickDocRef = useRef(null);
  const quickClientSlugRef = useRef("cliente");

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      if (quickPreviewUrl) URL.revokeObjectURL(quickPreviewUrl);
    };
  }, [quickPreviewUrl]);

  if (!isMaster) {
    return (
      <div className="w-full px-4 sm:px-6 py-8">
        <Card>
          <CardContent className="p-10 text-center text-sm text-slate-500">
            Acesso restrito ao usuário master.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !params) {
    return (
      <div className="w-full px-4 sm:px-6 py-8 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando parâmetros...
      </div>
    );
  }

  const tierMeta = TIERS.find((t) => t.value === tier);
  const base = parseBRNumber(params[`${tierMeta.prefix}_mensalidade`]);
  const bloco = parseBRNumber(params[`${tierMeta.prefix}_bloco`]);
  const implantacao = parseBRNumber(params[`${tierMeta.prefix}_implantacao`]);
  const cadastramentoValor = parseBRNumber(params.cadastramento_valor);

  const count = Math.max(0, Math.round(Number(contractCount) || 0));
  // Contratos renegociados não têm multiplicador — eles simplesmente somam
  // à carteira ativa e, se isso empurrar a conta pra outro bloco de 20,
  // a mensalidade sobe pela mesma regra de blocos de qualquer contrato novo.
  const renegCount = Math.max(0, Math.round(Number(qtdRenegociados) || 0));
  const totalCount = count + renegCount;
  const blocks = blocksFor(totalCount);
  const mensalidade = base + blocks * bloco;
  const cadastroQtyNum = Math.max(0, Math.round(Number(cadastroQty) || 0));
  const cadastramentoTotal = wantCadastro ? cadastroQtyNum * cadastramentoValor : 0;
  const firstMonth = implantacao + mensalidade + cadastramentoTotal;
  const precisaVencimento = pagamentoImplantacao !== "avista" || pagamentoMensalidade === "boleto";

  // Payload de salvamento = campos de entrada + valores comerciais já
  // calculados acima, congelados no momento do clique em "Salvar proposta"
  // (o histórico nunca recalcula com parâmetros futuros — ver migração).
  const buildProposalPayload = () => ({
    ...buildProposalInputs(),
    pricing_snapshot: params,
    valor_implantacao: implantacao,
    valor_mensalidade: mensalidade,
    valor_cadastramento_total: cadastramentoTotal,
    valor_total_primeiro_mes: firstMonth,
    blocos_count: blocks,
    carteira_total: totalCount,
  });

  const handleSaveProposal = () => {
    const payload = buildProposalPayload();
    if (currentProposalId) {
      updateProposalMutation.mutate({ id: currentProposalId, payload });
    } else {
      createProposalMutation.mutate(payload);
    }
  };

  function applyProposalToForm(record) {
    setClientName(record.client_name || "");
    setClientCnpj(record.client_cnpj || "");
    setClientEndereco(record.client_endereco || "");
    setContactName(record.contact_name || "");
    setContratanteCargo(record.contratante_cargo || "");
    setPropostaNumero(record.numero || "");
    setValidityDays(record.validity_days || "15");
    setContratadaRepresentante(record.contratada_representante || "");
    setContratadaCargo(record.contratada_cargo || "");
    setTier(record.tier || "standard");
    setContractCount(record.contract_count || "");
    setWantCadastro(Boolean(record.want_cadastro));
    setCadastroQty(record.cadastro_qty || "");
    setQtdRenegociados(record.qtd_renegociados || "");
    setPagamentoImplantacao(record.pagamento_implantacao || "entrada30_6x");
    setPagamentoMensalidade(record.pagamento_mensalidade || "boleto");
    setDiaVencimento(record.dia_vencimento || "05");
    setOutrosValores(record.outros_valores || "");
    setObjeto(record.objeto || "");
    setEscopoDisponibilizacao(record.escopo_disponibilizacao || "");
    setEscopoImplantacao(record.escopo_implantacao || "");
    setEscopoIntegracoes(record.escopo_integracoes || "");
    setEscopoTreinamento(record.escopo_treinamento || "");
    setEscopoDemais(record.escopo_demais || "");
    setCronogramaInicio(record.cronograma_inicio || "");
    setCronogramaPrazo(record.cronograma_prazo || "");
    setCronogramaContadoA(record.cronograma_contado_a || "");
    setEquipeClarityIB(record.equipe_clarity_ib || "");
    setEquipeContratante(record.equipe_contratante || "");
    setVigenciaDuracao(record.vigencia_duracao || "");
    setVigenciaInicio(record.vigencia_inicio || "");
    setVigenciaRenovacao(record.vigencia_renovacao || "");
    setForoComarca(record.foro_comarca || "");
    setForoEstado(record.foro_estado || "");
    setAssinaturaCidade(record.assinatura_cidade || "");
    setCurrentProposalId(record.id);
    savedSnapshotRef.current = null;
  }

  function resetProposalForm() {
    const d = getDefaultFormValues();
    setClientName(d.clientName);
    setClientCnpj(d.clientCnpj);
    setClientEndereco(d.clientEndereco);
    setContactName(d.contactName);
    setContratanteCargo(d.contratanteCargo);
    setPropostaNumero(d.propostaNumero);
    setValidityDays(d.validityDays);
    setContratadaRepresentante(d.contratadaRepresentante);
    setContratadaCargo(d.contratadaCargo);
    setTier(d.tier);
    setContractCount(d.contractCount);
    setWantCadastro(d.wantCadastro);
    setCadastroQty(d.cadastroQty);
    setQtdRenegociados(d.qtdRenegociados);
    setPagamentoImplantacao(d.pagamentoImplantacao);
    setPagamentoMensalidade(d.pagamentoMensalidade);
    setDiaVencimento(d.diaVencimento);
    setOutrosValores(d.outrosValores);
    setObjeto(d.objeto);
    setEscopoDisponibilizacao(d.escopoDisponibilizacao);
    setEscopoImplantacao(d.escopoImplantacao);
    setEscopoIntegracoes(d.escopoIntegracoes);
    setEscopoTreinamento(d.escopoTreinamento);
    setEscopoDemais(d.escopoDemais);
    setCronogramaInicio(d.cronogramaInicio);
    setCronogramaPrazo(d.cronogramaPrazo);
    setCronogramaContadoA(d.cronogramaContadoA);
    setEquipeClarityIB(d.equipeClarityIB);
    setEquipeContratante(d.equipeContratante);
    setVigenciaDuracao(d.vigenciaDuracao);
    setVigenciaInicio(d.vigenciaInicio);
    setVigenciaRenovacao(d.vigenciaRenovacao);
    setForoComarca(d.foroComarca);
    setForoEstado(d.foroEstado);
    setAssinaturaCidade(d.assinaturaCidade);
    setCurrentProposalId(null);
    savedSnapshotRef.current = null;
  }

  const openSavedProposal = (record) => {
    if (isProposalDirty) {
      setPendingAction({ type: "open", record });
      return;
    }
    applyProposalToForm(record);
    setView("form");
  };

  const startNewProposal = () => {
    if (isProposalDirty) {
      setPendingAction({ type: "new" });
      return;
    }
    resetProposalForm();
    setView("form");
  };

  const handleBackToList = () => {
    if (isProposalDirty) {
      setPendingAction({ type: "back" });
      return;
    }
    setView("list");
  };

  const confirmPendingAction = () => {
    if (!pendingAction) return;
    if (pendingAction.type === "open") {
      applyProposalToForm(pendingAction.record);
      setView("form");
    } else if (pendingAction.type === "new") {
      resetProposalForm();
      setView("form");
    } else if (pendingAction.type === "back") {
      // "Sair sem salvar" descarta as alterações pendentes desta sessão de
      // edição — a próxima vez que o formulário for aberto (novo ou outra
      // proposta) ele é totalmente sobrescrito de qualquer forma.
      savedSnapshotRef.current = currentInputsJson;
      setView("list");
    }
    setPendingAction(null);
  };

  const buildProposalDoc = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 48;
    const footerH = 66;
    const contentW = pageW - margin * 2;
    const {
      addTitle, addBoldLine, addParagraph, addFieldBlock, addDivider,
      addValueRow, addGap, addCenteredTitle, blankLine, drawHeaderBar, getY, setY,
    } = createPdfHelpers(doc, { margin, contentW, pageW, pageH, footerH });

    drawHeaderBar(renegCount > 0 ? "Proposta Comercial — Inclui Contratos Renegociados" : "Proposta Comercial");
    addCenteredTitle("PROPOSTA COMERCIAL E TERMO DE CONTRATAÇÃO DE SOFTWARE SaaS");
    setY(getY() + 10);

    // Partes
    addBoldLine(`CONTRATADA: ${CONTRATADA_NOME}`);
    addParagraph(`CNPJ: ${CONTRATADA_CNPJ}`);
    addParagraph(`Endereço: ${CONTRATADA_ENDERECO_PADRAO}`);
    addParagraph("Doravante denominada CONTRATADA.");
    addGap(6);
    addBoldLine(clientName ? `CLIENTE: ${clientName}` : "CLIENTE");
    if (clientCnpj) addParagraph(`CNPJ: ${clientCnpj}`);
    if (clientEndereco) addParagraph(`Endereço: ${clientEndereco}`);
    if (contactName) addParagraph(`Responsável: ${contactName}`);
    addParagraph("Doravante denominada CONTRATANTE.");
    addGap(6);
    if (propostaNumero) addValueRow("Proposta nº", propostaNumero);
    addValueRow("Data", new Date().toLocaleDateString("pt-BR"));
    addDivider();

    // 1. Apresentação
    addTitle("1. APRESENTAÇÃO", 12);
    addParagraph("A Clarity IB Ltda é uma empresa de tecnologia dedicada ao desenvolvimento de soluções digitais para otimização, organização e automação de processos empresariais.");
    addParagraph("Como fabricante e proprietária do software objeto desta proposta, a Clarity IB é responsável pela disponibilização da solução na modalidade SaaS (Software as a Service – Software como Serviço), conforme condições estabelecidas neste documento.");
    addDivider();

    // 2. Objeto da proposta
    addTitle("2. OBJETO DA PROPOSTA", 12);
    addFieldBlock("Objeto", objeto);
    addParagraph(`Plano contratado: ${tierMeta.label} — ${tierMeta.desc}.`);
    addParagraph("A presente proposta tem por objeto a disponibilização, pela CONTRATADA à CONTRATANTE, do direito de uso do software acima identificado, na modalidade SaaS, durante o período contratado e conforme o escopo, limites e condições estabelecidos neste documento.");
    addParagraph("A contratação não implica transferência de propriedade do software, código-fonte, tecnologia ou direitos de propriedade intelectual à CONTRATANTE.");
    addDivider();

    // 3. Escopo do trabalho
    addTitle("3. ESCOPO DO TRABALHO", 12);
    addParagraph("A contratação contempla:");
    addFieldBlock("Disponibilização do sistema", escopoDisponibilizacao);
    addFieldBlock("Implantação/configuração inicial", escopoImplantacao);
    addFieldBlock("Integrações previstas", escopoIntegracoes);
    addFieldBlock("Treinamento", escopoTreinamento);
    addFieldBlock("Suporte", SUPORTE_PADRAO);
    addFieldBlock("Demais serviços incluídos", escopoDemais);
    addParagraph("Demandas, personalizações, integrações, desenvolvimentos ou serviços que não estejam expressamente previstos nesta proposta não estão incluídos no valor contratado e, quando solicitados, poderão ser objeto de orçamento e aprovação adicionais.");
    addDivider();

    // 4. Valor da proposta
    addTitle("4. VALOR DA PROPOSTA", 12);
    addParagraph("Pela disponibilização do software e execução dos serviços descritos nesta proposta, a CONTRATANTE pagará à CONTRATADA:");
    addValueRow("Valor de implantação/configuração", formatCurrency(implantacao), { bold: true });
    addValueRow("Mensalidade SaaS", formatCurrency(mensalidade), { bold: true });
    if (wantCadastro && cadastroQtyNum > 0) {
      addValueRow(
        `Cadastramento assistido (${cadastroQtyNum} × ${formatCurrency(cadastramentoValor)})`,
        formatCurrency(cadastramentoTotal)
      );
    }
    if (String(outrosValores || "").trim()) addFieldBlock("Outros valores", outrosValores);
    addValueRow(
      "Forma de pagamento — Implantação",
      PAGAMENTO_IMPLANTACAO_OPTIONS.find((o) => o.value === pagamentoImplantacao)?.label || "—"
    );
    addValueRow(
      "Forma de pagamento — Mensalidade",
      PAGAMENTO_MENSALIDADE_OPTIONS.find((o) => o.value === pagamentoMensalidade)?.label || "—"
    );
    if (precisaVencimento) addValueRow("Vencimento", `Dia ${diaVencimento}`);
    addDivider();

    addTitle("Detalhamento do investimento", 10.5);
    if (contractCount) addValueRow("Contratos ativos", `${count} contrato(s).`);
    if (renegCount > 0) addValueRow("Contratos renegociados", `${renegCount} contrato(s).`);
    if (contractCount || renegCount > 0) addValueRow("Carteira total considerada", `${totalCount} contrato(s).`, { bold: true });
    addValueRow("Mensalidade base (até 10 contratos)", formatCurrency(base));
    if (blocks > 0) {
      addValueRow(
        `+ ${blocks} bloco(s) de 20 contratos × ${formatCurrency(bloco)}`,
        formatCurrency(blocks * bloco)
      );
    }
    addValueRow("Total no 1º mês", formatCurrency(firstMonth), { bold: true, size: 12, color: BRAND_CYAN });
    addValueRow("Recorrente a partir do 2º mês", formatCurrency(mensalidade), { bold: true });
    addGap(4);
    addParagraph("Eventuais impostos incidentes serão tratados conforme a legislação aplicável e as condições comerciais definidas nesta proposta.");
    addDivider();

    // 5. Condições de execução
    addTitle("5. CONDIÇÕES DE EXECUÇÃO", 12);
    addTitle("5.1. Cronograma", 10.5);
    if (cronogramaInicio) addParagraph(`O início dos trabalhos está previsto para ${formatDateBR(cronogramaInicio)}.`);
    if (cronogramaPrazo) {
      addParagraph(`O prazo estimado para implantação/disponibilização será de ${cronogramaPrazo}${cronogramaContadoA ? `, contado a partir da ${cronogramaContadoA}` : ""}.`);
    }
    addParagraph("O cronograma poderá ser ajustado quando houver atraso na entrega de informações, documentos, acessos, validações ou demais providências que dependam da CONTRATANTE ou de terceiros.");
    addGap(4);

    addTitle("5.2. Equipe envolvida", 10.5);
    addParagraph("Para execução do escopo, está prevista a seguinte estrutura:");
    addFieldBlock("Equipe envolvida (Clarity IB)", equipeClarityIB);
    addFieldBlock("Equipe necessária (Contratante)", equipeContratante);
    addParagraph("A CONTRATADA será responsável pela organização e alocação de sua equipe, podendo realizar substituições ou ajustes de profissionais quando necessário, desde que preservada a execução do objeto contratado.");
    addGap(4);

    addTitle("5.3. Responsabilidades da CONTRATANTE", 10.5);
    addParagraph("A CONTRATANTE deverá fornecer, dentro dos prazos acordados, as informações, acessos, documentos, validações e demais elementos necessários à implantação e funcionamento da solução.");
    addParagraph("A CONTRATANTE também será responsável pela correta utilização do sistema por seus usuários e pela veracidade das informações inseridas na plataforma.");
    addDivider();

    // 6. Licença e direito de uso
    addTitle("6. LICENÇA E DIREITO DE USO", 12);
    addParagraph("O software será disponibilizado exclusivamente na modalidade SaaS, mediante direito de uso durante a vigência da contratação.");
    addParagraph("Todos os direitos relativos ao software, incluindo sua estrutura, funcionalidades, código-fonte, tecnologia, documentação técnica, marca e demais elementos de propriedade intelectual permanecem de titularidade da Clarity IB Ltda, ressalvados direitos de terceiros eventualmente utilizados na solução.");
    addParagraph("A CONTRATANTE não poderá copiar, comercializar, sublicenciar, ceder, modificar, realizar engenharia reversa ou permitir acesso não autorizado ao software, salvo mediante autorização expressa da CONTRATADA ou nos limites permitidos pela legislação aplicável.");
    addDivider();

    // 7. Dados e confidencialidade
    addTitle("7. DADOS E CONFIDENCIALIDADE", 12);
    addParagraph("As partes comprometem-se a manter confidencialidade sobre informações comerciais, estratégicas, técnicas e demais informações não públicas a que tiverem acesso em razão desta contratação.");
    addParagraph("Os dados inseridos pela CONTRATANTE no sistema permanecem sob sua titularidade ou responsabilidade, conforme sua natureza.");
    addParagraph("O tratamento de dados pessoais deverá observar a legislação aplicável, especialmente a Lei Geral de Proteção de Dados Pessoais – LGPD (Lei nº 13.709/2018), cabendo às partes cumprir as responsabilidades que lhes forem aplicáveis.");
    addDivider();

    // 8. Vigência e cancelamento
    addTitle("8. VIGÊNCIA E CANCELAMENTO", 12);
    if (vigenciaDuracao && vigenciaInicio) {
      addParagraph(`A contratação terá vigência de ${vigenciaDuracao}, iniciando-se em ${formatDateBR(vigenciaInicio)}.`);
    } else if (vigenciaDuracao) {
      addParagraph(`A contratação terá vigência de ${vigenciaDuracao}.`);
    } else if (vigenciaInicio) {
      addParagraph(`A contratação terá início em ${formatDateBR(vigenciaInicio)}.`);
    }
    addFieldBlock("Após esse período", vigenciaRenovacao);
    addParagraph(`O cancelamento/rescisão poderá ocorrer mediante comunicação prévia de ${CANCELAMENTO_PRAZO_DIAS_PADRAO} dias, observadas as obrigações financeiras já constituídas e demais condições previstas nesta proposta.`);
    addParagraph("Em caso de inadimplência, a CONTRATADA poderá suspender o acesso ao sistema após comunicação à CONTRATANTE, observados os prazos e condições comerciais acordados.");
    addDivider();

    // 9. Validade da proposta
    addTitle("9. VALIDADE DA PROPOSTA", 12);
    addParagraph(`Esta proposta comercial é válida por ${validityDays || "15"} dias, contados da data de sua emissão.`);
    addParagraph("Após esse período, valores, prazos, condições comerciais e disponibilidade para execução poderão ser revistos pela CONTRATADA.");
    addDivider();

    // 10. Aceite e caráter contratual
    addTitle("10. ACEITE E CARÁTER CONTRATUAL", 12);
    addParagraph("A assinatura desta proposta representa a concordância integral das partes com seu conteúdo e formaliza a contratação dos serviços e do direito de uso do software nela descritos.");
    addParagraph("Após assinada pelos representantes das partes, esta proposta passa a produzir efeitos como instrumento contratual entre CLARITY IB LTDA e a CONTRATANTE, dispensando a celebração de instrumento separado para o mesmo objeto, salvo se posteriormente acordado entre as partes.");
    addParagraph("As partes reconhecem como válidas as assinaturas físicas e eletrônicas apostas neste documento, na forma permitida pela legislação aplicável.");
    addDivider();

    // 11. Disposições gerais
    addTitle("11. DISPOSIÇÕES GERAIS", 12);
    addParagraph("Qualquer alteração relevante de escopo, valores, prazos ou condições desta contratação deverá ser formalizada e aceita pelas partes.");
    addParagraph("A eventual tolerância de uma das partes quanto ao descumprimento de determinada obrigação não implicará renúncia ao direito de exigir seu cumprimento posteriormente.");
    addParagraph("Caso alguma disposição deste instrumento seja considerada inválida ou inexequível, as demais disposições permanecerão válidas.");
    if (foroComarca && foroEstado) {
      addParagraph(`Fica eleito o foro da Comarca de ${foroComarca}, Estado de ${foroEstado}, para dirimir eventuais controvérsias decorrentes deste instrumento, ressalvadas as hipóteses legais de competência obrigatória.`);
    } else if (foroComarca || foroEstado) {
      addParagraph(`Fica eleito o foro da Comarca de ${foroComarca || foroEstado}, para dirimir eventuais controvérsias decorrentes deste instrumento, ressalvadas as hipóteses legais de competência obrigatória.`);
    }
    addDivider();

    // Assinaturas
    const now = new Date();
    addParagraph(
      `${assinaturaCidade ? `${assinaturaCidade}, ` : ""}${now.getDate()} de ${MONTHS_PT[now.getMonth()]} de ${now.getFullYear()}.`,
      10,
      [30, 41, 59]
    );
    addGap(10);

    addTitle("CONTRATADA", 11);
    addParagraph(CONTRATADA_NOME);
    if (contratadaRepresentante) addParagraph(`Representante: ${contratadaRepresentante}`);
    if (contratadaCargo) addParagraph(`Cargo: ${contratadaCargo}`);
    addParagraph(`Assinatura: ${blankLine(30)}`);
    addGap(10);

    addTitle("CONTRATANTE", 11);
    if (clientName) addParagraph(clientName);
    if (contactName) addParagraph(`Representante: ${contactName}`);
    if (contratanteCargo) addParagraph(`Cargo: ${contratanteCargo}`);
    addParagraph(`Assinatura: ${blankLine(30)}`);

    drawFooterPages(doc, { margin, pageW, pageH, footerH });
    clientSlugRef.current = slugify(clientName);
    return doc;
  };

  // Versão curta — só a proposta comercial (dados do cliente, plano,
  // investimento e forma de pagamento), sem as 11 seções do termo jurídico.
  // Serve pra conferir o valor antes de preencher o resto do contrato.
  const buildQuickProposalDoc = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 48;
    const footerH = 66;
    const contentW = pageW - margin * 2;
    const { addTitle, addParagraph, addFieldBlock, addDivider, addValueRow, drawHeaderBar } =
      createPdfHelpers(doc, { margin, contentW, pageW, pageH, footerH });

    drawHeaderBar(renegCount > 0 ? "Proposta Comercial — Inclui Contratos Renegociados" : "Proposta Comercial");

    addTitle("Dados do cliente");
    if (clientName) addParagraph(`Cliente: ${clientName}`);
    if (clientCnpj) addParagraph(`CNPJ: ${clientCnpj}`);
    if (clientEndereco) addParagraph(`Endereço: ${clientEndereco}`);
    if (contactName) addParagraph(`Responsável: ${contactName}`);
    addParagraph(`Proposta válida por ${validityDays || "15"} dias a partir da emissão.`);
    addDivider();

    addTitle("Plano contratado");
    addParagraph(`${tierMeta.label} — ${tierMeta.desc}`);
    if (contractCount) addParagraph(`Carteira estimada: ${count} contrato(s) ativo(s).`);
    if (renegCount > 0) {
      addParagraph(
        `+ ${renegCount} contrato(s) renegociado(s) — carteira total considerada: ${totalCount} contrato(s).`,
        10,
        [180, 83, 9]
      );
    }
    addDivider();

    addTitle("Investimento");
    addValueRow("Implantação (única)", formatCurrency(implantacao), { bold: true });
    addValueRow("Mensalidade base (até 10 contratos)", formatCurrency(base));
    if (blocks > 0) {
      addValueRow(
        `+ ${blocks} bloco(s) de 20 contratos × ${formatCurrency(bloco)}`,
        formatCurrency(blocks * bloco)
      );
    }
    addValueRow("Mensalidade recorrente", formatCurrency(mensalidade), { bold: true });
    if (wantCadastro && cadastroQtyNum > 0) {
      addValueRow(
        `Cadastramento assistido (${cadastroQtyNum} × ${formatCurrency(cadastramentoValor)})`,
        formatCurrency(cadastramentoTotal)
      );
    }
    if (String(outrosValores || "").trim()) addFieldBlock("Outros valores", outrosValores);
    addDivider();
    addValueRow("Total no 1º mês", formatCurrency(firstMonth), { bold: true, size: 13, color: BRAND_CYAN });
    addValueRow("Recorrente a partir do 2º mês", formatCurrency(mensalidade), { bold: true });
    addDivider();

    addTitle("Forma de pagamento", 12);
    addValueRow(
      "Implantação",
      PAGAMENTO_IMPLANTACAO_OPTIONS.find((o) => o.value === pagamentoImplantacao)?.label || "—"
    );
    addValueRow(
      "Mensalidade",
      PAGAMENTO_MENSALIDADE_OPTIONS.find((o) => o.value === pagamentoMensalidade)?.label || "—"
    );
    if (precisaVencimento) addValueRow("Vencimento", `Dia ${diaVencimento}`);

    drawFooterPages(doc, { margin, pageW, pageH, footerH });
    quickClientSlugRef.current = slugify(clientName);
    return doc;
  };

  const openPreview = () => {
    const doc = buildProposalDoc();
    docRef.current = doc;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = doc.output("bloburl");
    setPreviewUrl(url);
    setPreviewOpen(true);
  };

  const downloadPdf = () => {
    if (!docRef.current) return;
    docRef.current.save(`Proposta-Comercial-${clientSlugRef.current}.pdf`);
  };

  const openQuickPreview = () => {
    const doc = buildQuickProposalDoc();
    quickDocRef.current = doc;
    if (quickPreviewUrl) URL.revokeObjectURL(quickPreviewUrl);
    const url = doc.output("bloburl");
    setQuickPreviewUrl(url);
    setQuickPreviewOpen(true);
  };

  const downloadQuickPdf = () => {
    if (!quickDocRef.current) return;
    quickDocRef.current.save(`Proposta-Comercial-Resumo-${quickClientSlugRef.current}.pdf`);
  };

  // Compartilhado entre as duas telas: "new" pode ser disparado tanto pela
  // listagem quanto pelo botão rápido dentro do formulário; "open" só pela
  // listagem; "back" só pelo formulário.
  const pendingActionDialog = (
    <AlertDialog open={!!pendingAction} onOpenChange={(v) => { if (!v) setPendingAction(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Existem alterações que ainda não foram salvas.</AlertDialogTitle>
          <AlertDialogDescription>Deseja sair sem salvar?</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setPendingAction(null)}>Continuar editando</AlertDialogCancel>
          <AlertDialogAction onClick={confirmPendingAction}>Sair sem salvar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (view === "list") {
    return (
      <div className="w-full px-4 sm:px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Propostas Comerciais</h1>
            <p className="text-sm text-slate-600 mt-0.5">Consulte e gerencie as propostas comerciais.</p>
          </div>
          <Button className="gap-1.5 shrink-0" onClick={startNewProposal}>
            <Plus className="w-4 h-4" />
            Nova proposta
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                className="h-8 text-sm pl-8"
                value={proposalSearchInput}
                onChange={(e) => setProposalSearchInput(e.target.value)}
                placeholder="Buscar por cliente, CNPJ ou número..."
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loadingProposals ? (
              <div className="text-sm text-slate-500 py-10 text-center">Carregando...</div>
            ) : !savedProposals.length ? (
              <div className="text-sm text-slate-500 py-10 text-center">
                {proposalSearch ? "Nenhuma proposta encontrada." : "Nenhuma proposta salva ainda."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nº</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Plano</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Validade</TableHead>
                      <TableHead className="text-right">Valor mensal</TableHead>
                      <TableHead className="text-right">Valor de implantação</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {savedProposals.map((p) => {
                      const label = proposalStatusLabel(p);
                      return (
                        <TableRow key={p.id} className={p.id === currentProposalId ? "bg-cyan-50/60" : ""}>
                          <TableCell className="font-medium whitespace-nowrap">{p.numero}</TableCell>
                          <TableCell>{p.client_name || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{TIERS.find((t) => t.value === p.tier)?.label || p.tier}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDateTimeBR(p.created_date)}</TableCell>
                          <TableCell className="whitespace-nowrap">{p.validity_days ? `${p.validity_days} dias` : "—"}</TableCell>
                          <TableCell className="text-right whitespace-nowrap">{formatCurrency(p.valor_mensalidade)}</TableCell>
                          <TableCell className="text-right whitespace-nowrap">{formatCurrency(p.valor_implantacao)}</TableCell>
                          <TableCell>
                            <Badge variant={proposalStatusVariant(label)}>{label}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Abrir/Editar" onClick={() => openSavedProposal(p)}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Visualizar" onClick={() => setViewingProposal(p)}>
                                <Eye className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!viewingProposal} onOpenChange={(v) => { if (!v) setViewingProposal(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Proposta {viewingProposal?.numero}</DialogTitle>
            </DialogHeader>
            {viewingProposal && (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-500">Cliente</div>
                    <div className="font-medium">{viewingProposal.client_name || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">CNPJ</div>
                    <div className="font-medium">{viewingProposal.client_cnpj || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Responsável</div>
                    <div className="font-medium">{viewingProposal.contact_name || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Plano</div>
                    <div className="font-medium">{TIERS.find((t) => t.value === viewingProposal.tier)?.label || viewingProposal.tier}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Data de criação</div>
                    <div className="font-medium">{formatDateTimeBR(viewingProposal.created_date)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Validade</div>
                    <div className="font-medium">{viewingProposal.validity_days ? `${viewingProposal.validity_days} dias` : "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Status</div>
                    <Badge variant={proposalStatusVariant(proposalStatusLabel(viewingProposal))}>
                      {proposalStatusLabel(viewingProposal)}
                    </Badge>
                  </div>
                </div>
                <div className="h-px bg-slate-200" />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-500">Implantação</div>
                    <div className="font-medium">{formatCurrency(viewingProposal.valor_implantacao)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Mensalidade</div>
                    <div className="font-medium">{formatCurrency(viewingProposal.valor_mensalidade)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Cadastramento assistido</div>
                    <div className="font-medium">{formatCurrency(viewingProposal.valor_cadastramento_total)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Total no 1º mês</div>
                    <div className="font-semibold text-cyan-700">{formatCurrency(viewingProposal.valor_total_primeiro_mes)}</div>
                  </div>
                </div>
                <div className="h-px bg-slate-200" />
                <div className="text-xs text-slate-500">
                  Criada por {viewingProposal.created_by || "—"} em {formatDateTimeBR(viewingProposal.created_date)}
                  {viewingProposal.updated_by ? (
                    <> • Última atualização por {viewingProposal.updated_by} em {formatDateTimeBR(viewingProposal.updated_date)}</>
                  ) : null}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setViewingProposal(null)}>Fechar</Button>
              <Button
                type="button"
                className="gap-1.5"
                onClick={() => { const r = viewingProposal; setViewingProposal(null); openSavedProposal(r); }}
              >
                <Pencil className="w-3.5 h-3.5" />
                Abrir/Editar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {pendingActionDialog}
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      <div className="mb-6">
        <button
          type="button"
          onClick={handleBackToList}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 mb-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para propostas
        </button>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {currentProposalId ? `Proposta Comercial — ${propostaNumero}` : "Nova Proposta Comercial"}
        </h1>
        <p className="text-sm text-slate-600 mt-0.5">
          Simule a mensalidade por tier e carteira de contratos, e emita a proposta / termo de contratação SaaS em PDF.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6 items-stretch">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-base">Parâmetros dos planos</CardTitle>
            <CardDescription>
              Compartilhados entre todos os admins — só "Salvar parâmetros" grava no banco.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col space-y-4">
            {TIERS.map((t) => (
              <div key={t.value} className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                <p className="text-sm font-semibold text-slate-800">{t.label} <span className="font-normal text-slate-500">— {t.desc}</span></p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">Implantação (R$)</Label>
                    <CurrencyInput className="h-8 text-sm" value={params[`${t.prefix}_implantacao`]} onChange={(e) => updateParam(`${t.prefix}_implantacao`, e.target.value)} placeholder="0,00" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">Mensalidade base (R$)</Label>
                    <CurrencyInput className="h-8 text-sm" value={params[`${t.prefix}_mensalidade`]} onChange={(e) => updateParam(`${t.prefix}_mensalidade`, e.target.value)} placeholder="0,00" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500">Bloco +20 (R$)</Label>
                    <CurrencyInput className="h-8 text-sm" value={params[`${t.prefix}_bloco`]} onChange={(e) => updateParam(`${t.prefix}_bloco`, e.target.value)} placeholder="0,00" />
                  </div>
                </div>
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">Cadastramento assistido, por contrato (R$)</Label>
              <CurrencyInput className="h-8 text-sm" value={params.cadastramento_valor} onChange={(e) => updateParam("cadastramento_valor", e.target.value)} placeholder="0,00" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="gap-1.5 mt-auto"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              <Save className="w-4 h-4" />
              {saveMutation.isPending ? "Salvando..." : "Salvar parâmetros"}
            </Button>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="text-base">Simulador de proposta</CardTitle>
              <CardDescription>Preencha os dados do cliente e emita o PDF.</CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {currentProposalId && (
                <Badge variant="outline" className="text-[10px] font-medium whitespace-nowrap">
                  Editando {propostaNumero || "proposta salva"}
                </Badge>
              )}
              <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-xs h-7 px-2" onClick={startNewProposal}>
                <FilePlus2 className="w-3.5 h-3.5" /> Nova proposta
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Tier</Label>
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIERS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Contratos ativos</Label>
                <Input className="h-8 text-sm" type="number" min="0" value={contractCount} onChange={(e) => setContractCount(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Contratos renegociados</Label>
                <Input className="h-8 text-sm" type="number" min="0" value={qtdRenegociados} onChange={(e) => setQtdRenegociados(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Validade (dias)</Label>
                <Input className="h-8 text-sm" type="number" min="1" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} />
              </div>
            </div>
            {renegCount > 0 && (
              <p className="text-xs text-amber-700 -mt-1.5">
                Soma aos contratos ativos: carteira total de {totalCount} contrato(s) para cálculo da mensalidade (sem multiplicador — só pode empurrar pra outro bloco de 20).
              </p>
            )}

            <div className="flex items-center gap-3">
              <Checkbox id="want-cadastro" checked={wantCadastro} onCheckedChange={(v) => setWantCadastro(Boolean(v))} />
              <Label htmlFor="want-cadastro" className="text-sm font-normal text-slate-700">Incluir cadastramento assistido</Label>
              <Input
                className="h-8 w-24"
                type="number"
                min="0"
                disabled={!wantCadastro}
                value={cadastroQty}
                onChange={(e) => setCadastroQty(e.target.value)}
                placeholder="qtd."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Pagamento da implantação</Label>
                <Select value={pagamentoImplantacao} onValueChange={setPagamentoImplantacao}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAGAMENTO_IMPLANTACAO_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Pagamento da mensalidade</Label>
                <Select value={pagamentoMensalidade} onValueChange={setPagamentoMensalidade}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAGAMENTO_MENSALIDADE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {precisaVencimento && (
                <div className="space-y-1">
                  <Label className="text-xs text-slate-500">Dia de vencimento</Label>
                  <Select value={diaVencimento} onValueChange={setDiaVencimento}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DIA_VENCIMENTO_OPTIONS.map((d) => <SelectItem key={d} value={d}>Dia {d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">Outros valores (opcional)</Label>
              <Textarea className="min-h-[60px] text-sm" value={outrosValores} onChange={(e) => setOutrosValores(e.target.value)} placeholder="Ex.: taxa de setup de integração, etc." />
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5 text-sm">
              {renegCount > 0 && (
                <div className="flex justify-between text-xs text-amber-700 font-medium">
                  <span>Carteira total (ativos + renegociados)</span><span>{count} + {renegCount} = {totalCount}</span>
                </div>
              )}
              <div className="flex justify-between"><span className="text-slate-500">Mensalidade base (até 10)</span><span className="font-medium">{formatCurrency(base)}</span></div>
              <div className="flex justify-between pl-3 text-xs"><span className="text-slate-500">+ {blocks} bloco(s) de 20 × {formatCurrency(bloco)}</span><span className="font-medium">{formatCurrency(blocks * bloco)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Mensalidade recorrente</span><span className="font-semibold">{formatCurrency(mensalidade)}</span></div>
              <div className="h-px bg-slate-200 my-1.5" />
              <div className="flex justify-between"><span className="text-slate-500">Implantação (única)</span><span className="font-medium">{formatCurrency(implantacao)}</span></div>
              {wantCadastro && (
                <div className="flex justify-between"><span className="text-slate-500">Cadastramento ({cadastroQtyNum} × {formatCurrency(cadastramentoValor)})</span><span className="font-medium">{formatCurrency(cadastramentoTotal)}</span></div>
              )}
              <div className="h-px bg-slate-200 my-1.5" />
              <div className="flex justify-between text-base"><span className="font-semibold">Total no 1º mês</span><span className="font-bold text-cyan-700">{formatCurrency(firstMonth)}</span></div>
              <div className="flex justify-between text-xs"><span className="text-slate-500">Recorrente a partir do 2º mês</span><span className="font-medium">{formatCurrency(mensalidade)}</span></div>
            </div>

            <div className="flex items-center gap-2 mt-auto">
              <Button type="button" variant="outline" className="gap-1.5 flex-1" onClick={openQuickPreview}>
                <Eye className="w-4 h-4" />
                Visualizar Proposta Comercial (resumo)
              </Button>
              <Button
                type="button"
                className="gap-1.5 flex-1"
                disabled={createProposalMutation.isPending || updateProposalMutation.isPending}
                onClick={handleSaveProposal}
              >
                <Save className="w-4 h-4" />
                {createProposalMutation.isPending || updateProposalMutation.isPending
                  ? "Salvando..."
                  : currentProposalId ? "Salvar alterações" : "Salvar proposta"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Termo de contratação (SaaS)</CardTitle>
          <CardDescription>
            Preenche as seções 1 a 11 do termo. Campos deixados em branco não aparecem no PDF gerado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-slate-800 mb-2 uppercase tracking-wide">Partes — Contratante (Cliente)</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Razão social</Label>
                <Input className="h-8 text-sm" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nome do cliente" />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">CNPJ</Label>
                <Input className="h-8 text-sm" value={clientCnpj} onChange={(e) => setClientCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Endereço</Label>
                <Input className="h-8 text-sm" value={clientEndereco} onChange={(e) => setClientEndereco(e.target.value)} placeholder="Endereço completo" />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Responsável</Label>
                <Input className="h-8 text-sm" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nome do responsável" />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Cargo do responsável</Label>
                <Input className="h-8 text-sm" value={contratanteCargo} onChange={(e) => setContratanteCargo(e.target.value)} placeholder="Ex.: Diretor" />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Proposta nº</Label>
                <Input className="h-8 text-sm" value={propostaNumero} onChange={(e) => setPropostaNumero(e.target.value)} placeholder="Opcional" />
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-800 mb-2 uppercase tracking-wide">Objeto e escopo</p>
            <div className="space-y-2">
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Objeto</Label>
                <Textarea rows={2} className="min-h-0 text-sm resize-none" value={objeto} onChange={(e) => setObjeto(e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="space-y-0.5">
                  <Label className="text-xs text-slate-500">Disponibilização do sistema</Label>
                  <Textarea rows={2} className="min-h-0 text-sm resize-none" value={escopoDisponibilizacao} onChange={(e) => setEscopoDisponibilizacao(e.target.value)} />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-xs text-slate-500">Implantação/configuração inicial</Label>
                  <Textarea rows={2} className="min-h-0 text-sm resize-none" value={escopoImplantacao} onChange={(e) => setEscopoImplantacao(e.target.value)} />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-xs text-slate-500">Integrações previstas</Label>
                  <Textarea rows={2} className="min-h-0 text-sm resize-none" value={escopoIntegracoes} onChange={(e) => setEscopoIntegracoes(e.target.value)} />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-xs text-slate-500">Treinamento</Label>
                  <Textarea rows={2} className="min-h-0 text-sm resize-none" value={escopoTreinamento} onChange={(e) => setEscopoTreinamento(e.target.value)} />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-xs text-slate-500">Demais serviços incluídos</Label>
                  <Textarea rows={2} className="min-h-0 text-sm resize-none" value={escopoDemais} onChange={(e) => setEscopoDemais(e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-800 mb-2 uppercase tracking-wide">Cronograma e equipe</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Início dos trabalhos</Label>
                <Input className="h-8 text-sm" type="date" value={cronogramaInicio} onChange={(e) => setCronogramaInicio(e.target.value)} />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Prazo estimado de implantação</Label>
                <Input className="h-8 text-sm" value={cronogramaPrazo} onChange={(e) => setCronogramaPrazo(e.target.value)} placeholder="Ex.: 2 semanas" />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Prazo contado a partir da/do...</Label>
                <Input className="h-8 text-sm" value={cronogramaContadoA} onChange={(e) => setCronogramaContadoA(e.target.value)} />
              </div>
              <div className="space-y-0.5 sm:col-span-3">
                <Label className="text-xs text-slate-500">Equipe envolvida (Clarity IB)</Label>
                <Input className="h-8 text-sm" value={equipeClarityIB} onChange={(e) => setEquipeClarityIB(e.target.value)} placeholder="Ex.: 1 Contador e 1 Analista de Implantação" />
              </div>
              <div className="space-y-0.5 sm:col-span-3">
                <Label className="text-xs text-slate-500">Equipe necessária (Contratante)</Label>
                <Input className="h-8 text-sm" value={equipeContratante} onChange={(e) => setEquipeContratante(e.target.value)} placeholder="Ex.: 1 Responsável de TI para acompanhamento" />
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-800 mb-2 uppercase tracking-wide">Vigência, cancelamento e foro</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Duração da vigência</Label>
                <Input className="h-8 text-sm" value={vigenciaDuracao} onChange={(e) => setVigenciaDuracao(e.target.value)} />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Início da vigência</Label>
                <Input className="h-8 text-sm" type="date" value={vigenciaInicio} onChange={(e) => setVigenciaInicio(e.target.value)} />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Comarca do foro</Label>
                <Input className="h-8 text-sm" value={foroComarca} onChange={(e) => setForoComarca(e.target.value)} />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Estado do foro</Label>
                <Input className="h-8 text-sm" value={foroEstado} onChange={(e) => setForoEstado(e.target.value)} />
              </div>
            </div>
            <div className="space-y-0.5 mt-2">
              <Label className="text-xs text-slate-500">Condições de renovação ("Após esse período:")</Label>
              <Textarea rows={2} className="min-h-0 text-sm resize-none" value={vigenciaRenovacao} onChange={(e) => setVigenciaRenovacao(e.target.value)} />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-800 mb-2 uppercase tracking-wide">Assinatura</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Cidade de assinatura</Label>
                <Input className="h-8 text-sm" value={assinaturaCidade} onChange={(e) => setAssinaturaCidade(e.target.value)} />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Representante — Clarity IB</Label>
                <Input className="h-8 text-sm" value={contratadaRepresentante} onChange={(e) => setContratadaRepresentante(e.target.value)} />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs text-slate-500">Cargo — representante Clarity IB</Label>
                <Input className="h-8 text-sm" value={contratadaCargo} onChange={(e) => setContratadaCargo(e.target.value)} />
              </div>
            </div>
          </div>

          <Button type="button" className="gap-1.5 w-full" onClick={openPreview}>
            <Eye className="w-4 h-4" />
            Visualizar Termo de Contratação Completo
          </Button>
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl w-[95vw] h-[90vh] flex flex-col p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Pré-visualização — Termo de Contratação{clientName ? ` · ${clientName}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 rounded-md border border-slate-200 overflow-hidden bg-slate-100">
            {previewUrl && (
              <iframe title="Pré-visualização do Termo de Contratação" src={previewUrl} className="w-full h-full" />
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(false)}>Fechar</Button>
            <Button type="button" className="gap-1.5" onClick={downloadPdf}>
              <Download className="w-4 h-4" />
              Baixar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={quickPreviewOpen} onOpenChange={setQuickPreviewOpen}>
        <DialogContent className="max-w-4xl w-[95vw] h-[90vh] flex flex-col p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Pré-visualização — Proposta Comercial (resumo){clientName ? ` · ${clientName}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 rounded-md border border-slate-200 overflow-hidden bg-slate-100">
            {quickPreviewUrl && (
              <iframe title="Pré-visualização da Proposta Comercial (resumo)" src={quickPreviewUrl} className="w-full h-full" />
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setQuickPreviewOpen(false)}>Fechar</Button>
            <Button type="button" className="gap-1.5" onClick={downloadQuickPdf}>
              <Download className="w-4 h-4" />
              Baixar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pendingActionDialog}
    </div>
  );
}
