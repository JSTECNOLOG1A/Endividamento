import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CDIImporter from "../components/loan/CDIImporter";
import HolidayImporter from "../components/loan/HolidayImporter";
import PTAXImporter from "../components/loan/PTAXImporter";
import MonthlyIndexImporter from "../components/loan/MonthlyIndexImporter";

export default function CDIManager() {
  return (
    <div className="w-full px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Indexadores e Feriados</h1>
        <p className="text-sm text-slate-600 mt-0.5">Importação de séries históricas (CDI, SELIC, PTAX USD, IPCA, INPC, IGP-M) e feriados nacionais</p>
      </div>

      <Tabs defaultValue="cdi">
        <TabsList className="bg-slate-100">
          <TabsTrigger value="cdi">CDI</TabsTrigger>
          <TabsTrigger value="selic">SELIC</TabsTrigger>
          <TabsTrigger value="ptax-usd">PTAX USD</TabsTrigger>
          <TabsTrigger value="ipca">IPCA</TabsTrigger>
          <TabsTrigger value="inpc">INPC</TabsTrigger>
          <TabsTrigger value="igpm">IGP-M</TabsTrigger>
          <TabsTrigger value="feriados">Feriados</TabsTrigger>
        </TabsList>
        <TabsContent value="cdi" className="mt-4">
          <CDIImporter rateType="CDI" />
        </TabsContent>
        <TabsContent value="selic" className="mt-4">
          <CDIImporter rateType="SELIC" />
        </TabsContent>
        <TabsContent value="ptax-usd" className="mt-4">
          <PTAXImporter />
        </TabsContent>
        <TabsContent value="ipca" className="mt-4">
          <MonthlyIndexImporter rateType="IPCA" label="IPCA" bacenFunction="getIPCAFromBACEN" />
        </TabsContent>
        <TabsContent value="inpc" className="mt-4">
          <MonthlyIndexImporter rateType="INPC" label="INPC" bacenFunction="getINPCFromBACEN" />
        </TabsContent>
        <TabsContent value="igpm" className="mt-4">
          <MonthlyIndexImporter rateType="IGPM" label="IGP-M" bacenFunction="getIGPMFromBACEN" />
        </TabsContent>
        <TabsContent value="feriados" className="mt-4">
          <HolidayImporter />
        </TabsContent>
      </Tabs>
    </div>
  );
}
