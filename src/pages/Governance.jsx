import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Download } from "lucide-react";
import { toast } from "@/lib/notify";
import GroupForm from "../components/governance/GroupForm";
import EntityForm from "../components/governance/EntityForm";
import BankForm from "../components/governance/BankForm";
import BankAccountForm from "../components/governance/BankAccountForm";
import BankAccountImportModal from "../components/governance/BankAccountImportModal";
import NatureForm from "../components/governance/NatureForm";
import NatureImportModal from "../components/governance/NatureImportModal";
import ChartOfAccountsForm from "../components/governance/ChartOfAccountsForm";
import ChartImportModal from "../components/governance/ChartImportModal";
import GovernanceList from "../components/governance/GovernanceList";

export default function Governance() {
  const [activeTab, setActiveTab] = useState("groups");
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [importNaturesOpen, setImportNaturesOpen] = useState(false);
  const [importBankAccountsOpen, setImportBankAccountsOpen] = useState(false);
  const [importChartOpen, setImportChartOpen] = useState(false);
  const [selectedBankId, setSelectedBankId] = useState(null);
  const [editingKind, setEditingKind] = useState(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [accountEntityFilter, setAccountEntityFilter] = useState("__all__");
  const [accountStatusFilter, setAccountStatusFilter] = useState("todas");
  const [natureSearch, setNatureSearch] = useState("");
  const [natureEntityFilter, setNatureEntityFilter] = useState("__all__");
  const [natureLcdprFilter, setNatureLcdprFilter] = useState("todas");
  const [natureTipoFilter, setNatureTipoFilter] = useState("todas");
  const [natureStatusFilter, setNatureStatusFilter] = useState("todas");

  const queryClient = useQueryClient();

  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: () => base44.entities.Group.list("-created_date", 100),
    initialData: [],
  });

  const { data: entities } = useQuery({
    queryKey: ["entities"],
    queryFn: () => base44.entities.CompanyEntity.list("-created_date", 1000),
    initialData: [],
  });

  const { data: banks } = useQuery({
    queryKey: ["banks"],
    queryFn: () => base44.entities.Bank.list("-created_date", 500),
    initialData: [],
  });

  const { data: bankAccounts } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: () => base44.entities.BankAccount.list("-created_date", 5000),
    initialData: [],
  });

  const { data: natures } = useQuery({
    queryKey: ["natures"],
    queryFn: () => base44.entities.Nature.list("codigo", 5000),
    initialData: [],
  });

  const { data: accounts } = useQuery({
    queryKey: ["chart-of-accounts"],
    queryFn: () => base44.entities.ChartOfAccount.list("account_code", 20000),
    initialData: [],
  });

  // Mutations
  const createGroupMutation = useMutation({
    mutationFn: (data) => base44.entities.Group.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      setShowForm(false);
    },
  });

  const updateGroupMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Group.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      setShowForm(false);
      setEditingItem(null);
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id) => base44.entities.Group.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });

  const createEntityMutation = useMutation({
    mutationFn: (data) => base44.entities.CompanyEntity.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entities"] });
      queryClient.invalidateQueries({ queryKey: ["natures"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setShowForm(false);
      toast.success("Entidade criada");
    },
    onError: (error) => {
      toast.error(error.data?.error || error.message || "Não foi possível criar a entidade");
    },
  });

  const updateEntityMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.CompanyEntity.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entities"] });
      queryClient.invalidateQueries({ queryKey: ["natures"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setShowForm(false);
      setEditingItem(null);
      toast.success("Entidade atualizada");
    },
    onError: (error) => {
      toast.error(error.data?.error || error.message || "Não foi possível atualizar a entidade");
    },
  });

  const deleteEntityMutation = useMutation({
    mutationFn: (id) => base44.entities.CompanyEntity.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entities"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
    },
    onError: (error) => {
      toast.error(error.data?.error || error.message || "Não foi possível excluir a entidade");
    },
  });

  const createBankMutation = useMutation({
    mutationFn: (data) => base44.entities.Bank.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["banks"] });
      setShowForm(false);
      setEditingKind(null);
    },
  });

  const updateBankMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Bank.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["banks"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setShowForm(false);
      setEditingItem(null);
      setEditingKind(null);
    },
  });

  const deleteBankMutation = useMutation({
    mutationFn: (id) => base44.entities.Bank.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["banks"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
    },
    onError: (error) => {
      toast.error(error.data?.error || error.message || "Não foi possível excluir o banco");
    },
  });

  const createBankAccountMutation = useMutation({
    mutationFn: (data) => base44.entities.BankAccount.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setShowForm(false);
      setEditingItem(null);
      setEditingKind(null);
      toast.success("Conta bancária criada");
    },
    onError: (error) => {
      toast.error(error.data?.error || error.message || "Não foi possível criar a conta");
    },
  });

  const updateBankAccountMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.BankAccount.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setShowForm(false);
      setEditingItem(null);
      setEditingKind(null);
      toast.success("Conta bancária atualizada");
    },
    onError: (error) => {
      toast.error(error.data?.error || error.message || "Não foi possível atualizar a conta");
    },
  });

  const deleteBankAccountMutation = useMutation({
    mutationFn: (id) => base44.entities.BankAccount.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
    },
  });

  const createNatureMutation = useMutation({
    mutationFn: (data) => base44.entities.Nature.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["natures"] });
      setShowForm(false);
      toast.success("Natureza criada");
    },
    onError: (error) => {
      toast.error(error.data?.error || error.message || "Não foi possível criar a natureza");
    },
  });

  const updateNatureMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Nature.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["natures"] });
      setShowForm(false);
      setEditingItem(null);
      toast.success("Natureza atualizada");
    },
    onError: (error) => {
      toast.error(error.data?.error || error.message || "Não foi possível atualizar a natureza");
    },
  });

  const deleteNatureMutation = useMutation({
    mutationFn: (id) => base44.entities.Nature.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["natures"] });
    },
  });

  const createAccountMutation = useMutation({
    mutationFn: (data) => base44.entities.ChartOfAccount.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      setShowForm(false);
    },
  });

  const updateAccountMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ChartOfAccount.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
      setShowForm(false);
      setEditingItem(null);
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: (id) => base44.entities.ChartOfAccount.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] });
    },
  });

  const handleGroupSubmit = (data) => {
    if (editingItem) {
      updateGroupMutation.mutate({ id: editingItem.id, data });
    } else {
      createGroupMutation.mutate(data);
    }
  };

  const handleEntitySubmit = (data) => {
    if (!data.group_id) {
      toast.warning("Selecione o grupo econômico");
      return;
    }
    if (editingItem) {
      updateEntityMutation.mutate({ id: editingItem.id, data });
    } else {
      createEntityMutation.mutate(data);
    }
  };

  const handleBankSubmit = (data) => {
    if (editingItem) {
      updateBankMutation.mutate({ id: editingItem.id, data });
    } else {
      createBankMutation.mutate(data);
    }
  };

  const handleBankAccountSubmit = (data) => {
    if (editingItem && editingKind === "account") {
      updateBankAccountMutation.mutate({ id: editingItem.id, data });
    } else {
      createBankAccountMutation.mutate(data);
    }
  };

  const handleNatureSubmit = (data) => {
    if (editingItem) {
      updateNatureMutation.mutate({ id: editingItem.id, data });
    } else {
      createNatureMutation.mutate(data);
    }
  };

  const handleAccountSubmit = (data) => {
    if (editingItem) {
      updateAccountMutation.mutate({ id: editingItem.id, data });
    } else {
      createAccountMutation.mutate(data);
    }
  };

  const handleEdit = (item, kind = null) => {
    setEditingKind(kind);
    setEditingItem(item);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingItem(null);
    setEditingKind(null);
  };

  const entitiesByGroup = selectedGroup
    ? entities.filter((e) => e.group_id === selectedGroup)
    : [];

  const naturesWithEntity = useMemo(() => {
    const byId = new Map((entities || []).map((entity) => [entity.id, entity]));
    return (natures || []).map((item) => {
      const entity = item.entity_id ? byId.get(item.entity_id) : null;
      return {
        ...item,
        entity_name: entity?.entity_name || "",
        entity_codigo: entity?.codigo_empresa || item.empresa || "",
      };
    });
  }, [natures, entities]);

  const filteredNatures = useMemo(() => {
    const term = natureSearch.trim().toLowerCase();
    return naturesWithEntity.filter((item) => {
      if (term) {
        const empresa = String(item.empresa || "").toLowerCase();
        const entityName = String(item.entity_name || "").toLowerCase();
        const matches =
          String(item.codigo || "").toLowerCase().includes(term) ||
          String(item.descricao || "").toLowerCase().includes(term) ||
          entityName.includes(term) ||
          empresa.includes(term);
        if (!matches) return false;
      }
      if (natureEntityFilter === "__unlinked__") {
        if (item.entity_id) return false;
      } else if (natureEntityFilter !== "__all__" && item.entity_id !== natureEntityFilter) {
        return false;
      }
      if (natureLcdprFilter === "sim" && !item.gera_lcdpr) return false;
      if (natureLcdprFilter === "nao" && item.gera_lcdpr) return false;
      if (natureTipoFilter !== "todas" && item.tipo_natureza !== natureTipoFilter) return false;
      if (natureStatusFilter !== "todas" && item.status !== natureStatusFilter) return false;
      return true;
    });
  }, [naturesWithEntity, natureSearch, natureEntityFilter, natureLcdprFilter, natureTipoFilter, natureStatusFilter]);

  const selectedBank = (banks || []).find((bank) => bank.id === selectedBankId) || null;

  const accountsWithRefs = useMemo(() => {
    const entitiesById = new Map((entities || []).map((entity) => [entity.id, entity]));
    const banksById = new Map((banks || []).map((bank) => [bank.id, bank]));
    return (bankAccounts || []).map((item) => {
      const entity = item.entity_id ? entitiesById.get(item.entity_id) : null;
      const bank = item.bank_id ? banksById.get(item.bank_id) : null;
      return {
        ...item,
        entity_name: entity?.entity_name || "",
        bank_name: bank?.bank_name || "",
        bank_code: bank?.bank_code || item.bank_code || "",
      };
    });
  }, [bankAccounts, entities, banks]);

  const filteredBankAccounts = useMemo(() => {
    const term = accountSearch.trim().toLowerCase();
    return accountsWithRefs.filter((item) => {
      if (selectedBankId && item.bank_id !== selectedBankId) return false;
      if (term) {
        const haystack = [
          item.entity_name,
          item.empresa,
          item.bank_name,
          item.bank_code,
          item.agencia,
          item.conta,
          item.digito,
          item.nome,
        ].join(" ").toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (accountEntityFilter === "__unlinked__") {
        if (item.entity_id) return false;
      } else if (accountEntityFilter !== "__all__" && item.entity_id !== accountEntityFilter) {
        return false;
      }
      if (accountStatusFilter !== "todas" && item.status !== accountStatusFilter) return false;
      return true;
    });
  }, [accountsWithRefs, accountSearch, accountEntityFilter, accountStatusFilter, selectedBankId]);

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Governança</h1>
        <p className="text-sm text-slate-600 mt-0.5">Grupos, entidades, bancos, contas, naturezas e plano de contas</p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value);
          setShowForm(false);
          setEditingItem(null);
          setEditingKind(null);
        }}
      >
        <TabsList className="bg-slate-100 flex-wrap h-auto">
          <TabsTrigger value="groups" className="text-xs">Grupos Econômicos</TabsTrigger>
          <TabsTrigger value="entities" className="text-xs">Entidades Componentes</TabsTrigger>
          <TabsTrigger value="banks" className="text-xs">Bancos</TabsTrigger>
          <TabsTrigger value="natures" className="text-xs">Naturezas</TabsTrigger>
          <TabsTrigger value="chart" className="text-xs">Plano de contas</TabsTrigger>
        </TabsList>

        {/* Groups */}
        <TabsContent value="groups" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold text-slate-800">Grupos Econômicos</h2>
            {!showForm && (
              <Button
                onClick={() => { setEditingItem(null); setShowForm(true); }}
                size="sm"
                className="gap-1.5 bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="w-3.5 h-3.5" /> Novo Grupo
              </Button>
            )}
          </div>
          {showForm && activeTab === "groups" && (
            <GroupForm
              onSubmit={handleGroupSubmit}
              onCancel={handleCancel}
              initialData={editingItem}
            />
          )}
          <GovernanceList
            items={groups}
            type="group"
            onEdit={handleEdit}
            onSelect={(item) => {
              setSelectedGroup(item.id);
              setActiveTab("entities");
              setShowForm(false);
              setEditingItem(null);
            }}
            onDelete={(id) => deleteGroupMutation.mutate(id)}
          />
        </TabsContent>

        {/* Entities */}
        <TabsContent value="entities" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold text-slate-800">Entidades Componentes</h2>
            {!showForm && (
              <Button
                onClick={() => { setEditingItem(null); setShowForm(true); }}
                size="sm"
                className="gap-1.5 bg-green-600 hover:bg-green-700"
              >
                <Plus className="w-3.5 h-3.5" /> Nova Entidade
              </Button>
            )}
          </div>
          {showForm && activeTab === "entities" && (
            <EntityForm
              groups={groups}
              groupId={selectedGroup}
              onSubmit={handleEntitySubmit}
              onCancel={handleCancel}
              initialData={editingItem}
              submitting={createEntityMutation.isPending || updateEntityMutation.isPending}
            />
          )}
          {!showForm && (
            <div className="space-y-1 max-w-sm">
              <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Grupo</Label>
              <Select
                value={selectedGroup || "__all__"}
                onValueChange={(value) => setSelectedGroup(value === "__all__" ? null : value)}
              >
                <SelectTrigger className="h-9"><SelectValue placeholder="Todos os grupos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos os grupos</SelectItem>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>{group.group_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <GovernanceList
            items={selectedGroup ? entitiesByGroup : entities}
            type="entity"
            onEdit={handleEdit}
            onDelete={(id) => deleteEntityMutation.mutate(id)}
          />
        </TabsContent>

        {/* Banks */}
        <TabsContent value="banks" className="mt-4 space-y-8">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-base font-semibold text-slate-800">Instituições Financeiras</h2>
              {!(showForm && editingKind === "bank") && (
                <Button
                  onClick={() => { setEditingKind("bank"); setEditingItem(null); setShowForm(true); }}
                  size="sm"
                  className="gap-1.5 bg-purple-600 hover:bg-purple-700"
                >
                  <Plus className="w-3.5 h-3.5" /> Novo Banco
                </Button>
              )}
            </div>
            {showForm && activeTab === "banks" && editingKind === "bank" && (
              <BankForm
                onSubmit={handleBankSubmit}
                onCancel={handleCancel}
                initialData={editingItem}
              />
            )}
            <GovernanceList
              items={banks}
              type="bank"
              selectedId={selectedBankId}
              onSelect={(item) => setSelectedBankId((current) => current === item.id ? null : item.id)}
              onRelated={(item) => setSelectedBankId(item.id)}
              relatedTitle="Ver contas"
              onEdit={(item) => handleEdit(item, "bank")}
              onDelete={(id) => deleteBankMutation.mutate(id)}
            />
            <p className="text-xs text-slate-500">Clique no banco ou no ícone de carteira para filtrar as contas.</p>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center gap-3 flex-wrap">
              <div>
                <h2 className="text-base font-semibold text-slate-800">Contas bancárias</h2>
                {selectedBank ? (
                  <p className="text-xs text-slate-600 mt-0.5">
                    {selectedBank.bank_code} — {selectedBank.bank_name}
                    {" "}
                    <button
                      type="button"
                      className="text-violet-600 hover:underline"
                      onClick={() => setSelectedBankId(null)}
                    >
                      ver todas
                    </button>
                  </p>
                ) : (
                  <p className="text-xs text-slate-600 mt-0.5">Vinculadas ao banco e à empresa Protheus da entidade</p>
                )}
              </div>
              {!(showForm && editingKind === "account") && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setImportBankAccountsOpen(true)}
                    size="sm"
                    className="gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" /> Importar
                  </Button>
                  <Button
                    onClick={() => {
                      if (!banks.length) {
                        toast.warning("Cadastre o banco antes de criar a conta");
                        return;
                      }
                      setEditingKind("account");
                      setEditingItem(null);
                      setShowForm(true);
                    }}
                    size="sm"
                    className="gap-1.5 bg-violet-600 hover:bg-violet-700"
                  >
                    <Plus className="w-3.5 h-3.5" /> Nova Conta
                  </Button>
                </div>
              )}
            </div>
            {showForm && activeTab === "banks" && editingKind === "account" && (
              <BankAccountForm
                key={editingItem?.id || `new-${selectedBankId || "all"}`}
                banks={banks}
                entities={entities}
                bankId={editingItem?.bank_id || selectedBankId}
                onSubmit={handleBankAccountSubmit}
                onCancel={handleCancel}
                initialData={editingItem}
              />
            )}
            {!(showForm && editingKind === "account") && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="space-y-1 col-span-2 md:col-span-1">
                  <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Busca</Label>
                  <Input
                    value={accountSearch}
                    onChange={(e) => setAccountSearch(e.target.value)}
                    placeholder="Agência, conta, banco ou entidade"
                    className="h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Entidade</Label>
                  <Select value={accountEntityFilter} onValueChange={setAccountEntityFilter}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todas</SelectItem>
                      <SelectItem value="__unlinked__">Sem vínculo</SelectItem>
                      {entities.map((entity) => (
                        <SelectItem key={entity.id} value={entity.id}>{entity.entity_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Status</Label>
                  <Select value={accountStatusFilter} onValueChange={setAccountStatusFilter}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas</SelectItem>
                      <SelectItem value="ativo">Ativo</SelectItem>
                      <SelectItem value="inativo">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <GovernanceList
              items={filteredBankAccounts}
              type="bankAccount"
              onEdit={(item) => handleEdit(item, "account")}
              onDelete={(id) => deleteBankAccountMutation.mutate(id)}
            />
            <BankAccountImportModal
              open={importBankAccountsOpen}
              onOpenChange={setImportBankAccountsOpen}
              entities={entities}
              banks={banks}
              onImported={() => queryClient.invalidateQueries({ queryKey: ["bank-accounts"] })}
            />
          </div>
        </TabsContent>

        <TabsContent value="natures" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold text-slate-800">Naturezas</h2>
            {!showForm && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setImportNaturesOpen(true)}
                  size="sm"
                  className="gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> Importar
                </Button>
                <Button
                  onClick={() => { setEditingItem(null); setShowForm(true); }}
                  size="sm"
                  className="gap-1.5 bg-amber-600 hover:bg-amber-700"
                >
                  <Plus className="w-3.5 h-3.5" /> Nova Natureza
                </Button>
              </div>
            )}
          </div>
          {showForm && activeTab === "natures" && (
            <NatureForm
              entities={entities}
              onSubmit={handleNatureSubmit}
              onCancel={handleCancel}
              initialData={editingItem}
            />
          )}
          {!showForm && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="space-y-1 col-span-2 md:col-span-3 lg:col-span-1">
                <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Busca</Label>
                <Input
                  value={natureSearch}
                  onChange={(e) => setNatureSearch(e.target.value)}
                  placeholder="Código, descrição ou entidade"
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Entidade</Label>
                <Select value={natureEntityFilter} onValueChange={setNatureEntityFilter}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas</SelectItem>
                    <SelectItem value="__unlinked__">Sem vínculo</SelectItem>
                    {entities.map((entity) => (
                      <SelectItem key={entity.id} value={entity.id}>{entity.entity_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">LCDPR</Label>
                <Select value={natureLcdprFilter} onValueChange={setNatureLcdprFilter}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    <SelectItem value="sim">Gera LCDPR</SelectItem>
                    <SelectItem value="nao">Não gera</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Tipo</Label>
                <Select value={natureTipoFilter} onValueChange={setNatureTipoFilter}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    <SelectItem value="analitica">Analítica</SelectItem>
                    <SelectItem value="sintetica">Sintética</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Status</Label>
                <Select value={natureStatusFilter} onValueChange={setNatureStatusFilter}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="inativo">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <GovernanceList
            items={filteredNatures}
            type="nature"
            onEdit={handleEdit}
            onDelete={(id) => deleteNatureMutation.mutate(id)}
          />
          <NatureImportModal
            open={importNaturesOpen}
            onOpenChange={setImportNaturesOpen}
            entities={entities}
            onImported={() => queryClient.invalidateQueries({ queryKey: ["natures"] })}
          />
        </TabsContent>

        <TabsContent value="chart" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-base font-semibold text-slate-800">Plano de contas</h2>
              <p className="text-xs text-slate-600 mt-0.5">Compartilhado no grupo 01, sem validação de filial. Contas bloqueadas no ERP não entram.</p>
            </div>
            {!showForm && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setImportChartOpen(true)}
                  size="sm"
                  className="gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> Importar
                </Button>
                <Button
                  onClick={() => { setEditingItem(null); setShowForm(true); }}
                  size="sm"
                  className="gap-1.5 bg-indigo-600 hover:bg-indigo-700"
                >
                  <Plus className="w-3.5 h-3.5" /> Nova Conta
                </Button>
              </div>
            )}
          </div>
          {showForm && activeTab === "chart" && (
            <ChartOfAccountsForm
              onSubmit={handleAccountSubmit}
              onCancel={handleCancel}
              initialData={editingItem}
            />
          )}
          <GovernanceList
            items={accounts}
            type="chart"
            onEdit={handleEdit}
            onDelete={(id) => deleteAccountMutation.mutate(id)}
          />
          <ChartImportModal
            open={importChartOpen}
            onOpenChange={setImportChartOpen}
            onImported={() => queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}