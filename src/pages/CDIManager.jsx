import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CDIImporter from "../components/loan/CDIImporter";
import HolidayImporter from "../components/loan/HolidayImporter";
import PTAXImporter from "../components/loan/PTAXImporter";

export default function CDIManager() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Indexadores e Feriados</h1>
        <p className="text-sm text-slate-500 mt-0.5">Importação de séries históricas (CDI, SELIC, PTAX USD) e feriados nacionais</p>
      </div>
      
      <Tabs defaultValue="cdi-selic">
        <TabsList className="bg-slate-100">
          <TabsTrigger value="cdi-selic">CDI / SELIC</TabsTrigger>
          <TabsTrigger value="ptax-usd">PTAX USD</TabsTrigger>
          <TabsTrigger value="feriados">Feriados</TabsTrigger>
        </TabsList>
        <TabsContent value="cdi-selic" className="mt-4">
          <CDIImporter />
        </TabsContent>
        <TabsContent value="ptax-usd" className="mt-4">
          <PTAXImporter />
        </TabsContent>
        <TabsContent value="feriados" className="mt-4">
          <HolidayImporter />
        </TabsContent>
      </Tabs>
    </div>
  );
}