import React, { useState } from "react";
import { Banknote, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/notify";
import { schedulesApi } from "@/api/schedules";

export default function AccountsReceivable() {
  const [busy, setBusy] = useState(false);

  const handleConsultNow = async () => {
    setBusy(true);
    try {
      const result = await schedulesApi.runTask("consultar_titulos_receber");
      if (result.ok) toast.success(result.message || "Títulos consultados no ERP");
      else toast.warning(result.message || "A consulta terminou com alerta");
    } catch (error) {
      toast.error(error.data?.error || error.message || "Não foi possível consultar os títulos");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Contas a receber</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Títulos a receber. Classifique a natureza e integre os pendentes no ERP.
          </p>
        </div>
        <Button type="button" variant="outline" className="h-9 gap-1.5 border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 hover:text-sky-900" onClick={handleConsultNow} disabled={busy}>
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
          Consultar títulos
        </Button>
      </div>

      <Card className="border-slate-200 border-dashed">
        <CardContent className="p-12 text-center">
          <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center mx-auto mb-3">
            <Banknote className="w-6 h-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-600 font-medium">Nenhum título a receber</p>
          <p className="text-xs text-slate-400 mt-1">
            Os títulos entram aqui quando houver operação a receber.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
