import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import GroupForm from "../components/governance/GroupForm";
import EntityForm from "../components/governance/EntityForm";
import BankForm from "../components/governance/BankForm";
import GovernanceList from "../components/governance/GovernanceList";

export default function Governance() {
  const [activeTab, setActiveTab] = useState("groups");
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);

  const queryClient = useQueryClient();

  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: () => base44.entities.Group.list("-created_date", 100),
    initialData: [],
  });

  const { data: entities } = useQuery({
    queryKey: ["entities"],
    queryFn: () => base44.entities.CompanyEntity.list("-created_date", 100),
    initialData: [],
  });

  const { data: banks } = useQuery({
    queryKey: ["banks"],
    queryFn: () => base44.entities.Bank.list("-created_date", 100),
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
      setShowForm(false);
    },
  });

  const updateEntityMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.CompanyEntity.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entities"] });
      setShowForm(false);
      setEditingItem(null);
    },
  });

  const deleteEntityMutation = useMutation({
    mutationFn: (id) => base44.entities.CompanyEntity.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entities"] });
    },
  });

  const createBankMutation = useMutation({
    mutationFn: (data) => base44.entities.Bank.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["banks"] });
      setShowForm(false);
    },
  });

  const updateBankMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Bank.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["banks"] });
      setShowForm(false);
      setEditingItem(null);
    },
  });

  const deleteBankMutation = useMutation({
    mutationFn: (id) => base44.entities.Bank.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["banks"] });
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

  const handleEdit = (item) => {
    setEditingItem(item);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingItem(null);
  };

  const entitiesByGroup = selectedGroup
    ? entities.filter((e) => e.group_id === selectedGroup)
    : [];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Governança</h1>
        <p className="text-sm text-slate-500 mt-0.5">Grupos Econômicos, Entidades e Bancos</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-slate-100">
          <TabsTrigger value="groups" className="text-xs">Grupos Econômicos</TabsTrigger>
          <TabsTrigger value="entities" className="text-xs">Entidades Componentes</TabsTrigger>
          <TabsTrigger value="banks" className="text-xs">Bancos</TabsTrigger>
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
            onDelete={(id) => deleteGroupMutation.mutate(id)}
          />
        </TabsContent>

        {/* Entities */}
        <TabsContent value="entities" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold text-slate-800">Entidades Componentes</h2>
            {!showForm && (
              <div className="flex gap-2">
                {selectedGroup && (
                  <Button
                    variant="outline"
                    onClick={() => setSelectedGroup(null)}
                    size="sm"
                    className="text-xs"
                  >
                    Limpar Filtro
                  </Button>
                )}
                <Button
                  onClick={() => { setEditingItem(null); setShowForm(true); }}
                  size="sm"
                  className="gap-1.5 bg-green-600 hover:bg-green-700"
                >
                  <Plus className="w-3.5 h-3.5" /> Nova Entidade
                </Button>
              </div>
            )}
          </div>
          {showForm && activeTab === "entities" && (
            <EntityForm
              groupId={selectedGroup}
              onSubmit={handleEntitySubmit}
              onCancel={handleCancel}
              initialData={editingItem}
            />
          )}
          {!selectedGroup && (
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
              Selecione um grupo para filtrar entidades ou crie uma nova entidade.
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
        <TabsContent value="banks" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold text-slate-800">Instituições Financeiras</h2>
            {!showForm && (
              <Button
                onClick={() => { setEditingItem(null); setShowForm(true); }}
                size="sm"
                className="gap-1.5 bg-purple-600 hover:bg-purple-700"
              >
                <Plus className="w-3.5 h-3.5" /> Novo Banco
              </Button>
            )}
          </div>
          {showForm && activeTab === "banks" && (
            <BankForm
              onSubmit={handleBankSubmit}
              onCancel={handleCancel}
              initialData={editingItem}
            />
          )}
          <GovernanceList
            items={banks}
            type="bank"
            onEdit={handleEdit}
            onDelete={(id) => deleteBankMutation.mutate(id)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}