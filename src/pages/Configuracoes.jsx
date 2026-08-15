import React from "react";
import { Settings, Building2, SlidersHorizontal, Info } from "lucide-react";

export default function Configuracoes() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Configurações</h1>
        <p className="text-sm text-slate-500 mt-0.5">Preferências gerais do sistema Endividamento</p>
      </div>

      <div className="space-y-6">
        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-900">Perfil da Empresa</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Nome da Empresa
              </label>
              <input
                type="text"
                placeholder="Ex: FAL Auditores e Consultores"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                CNPJ
              </label>
              <input
                type="text"
                placeholder="00.000.000/0001-00"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <SlidersHorizontal className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-900">Preferências do Sistema</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Moeda Padrão
              </label>
              <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500">
                <option>BRL (Padrão)</option>
                <option>USD</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Formato de Data
              </label>
              <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500">
                <option>DD/MM/AAAA</option>
                <option>MM/DD/AAAA</option>
              </select>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Info className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-900">Sobre o Sistema</h2>
          </div>
          <dl className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wide">Aplicação</dt>
              <dd className="text-slate-700 mt-0.5">Endividamento</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500 uppercase tracking-wide">Motor de Cálculo</dt>
              <dd className="text-slate-700 mt-0.5">Local (SQLite)</dd>
            </div>
          </dl>
        </section>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Settings className="w-3.5 h-3.5" />
          <span>Esta é uma tela inicial de configurações — os campos ainda não estão conectados ao backend.</span>
        </div>
      </div>
    </div>
  );
}
