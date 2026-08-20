import React, { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/lib/notify";
import { base44 } from "@/api/base44Client";

const MIN_PARTY = 2;

function formatCnpj(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return digits;
}

export default function ErpLookupPanel({
  kind,
  initialSearch = "",
  empresa = "",
  onSelect,
  onBack,
}) {
  const isTipos = kind === "tipos";
  const isClientes = kind === "clientes";
  const partyKind = isClientes ? "clientes" : "fornecedores";
  const partyLabel = isClientes ? "Clientes no Protheus" : "Fornecedores no Protheus";
  const [search, setSearch] = useState(initialSearch || "");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    setSearch(initialSearch || "");
  }, [initialSearch, kind]);

  useEffect(() => {
    if (!kind) return undefined;
    const query = String(search || "").trim();
    if (!isTipos && query.length < MIN_PARTY) {
      setItems([]);
      setMeta(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const handle = setTimeout(() => {
      setLoading(true);
      base44.functions.invoke("lookupPayableErp", {
        kind: isTipos ? "tipos" : partyKind,
        search: query,
        empresa,
        limit: 40,
      })
        .then((result) => {
          if (cancelled) return;
          const data = result?.data || result || {};
          setItems(Array.isArray(data.items) ? data.items : []);
          setMeta(data);
        })
        .catch((error) => {
          if (cancelled) return;
          setItems([]);
          setMeta(null);
          toast.error(error.data?.error || error.message || "Não foi possível consultar o Protheus");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, query ? 400 : 0);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [kind, search, isTipos, partyKind, empresa]);

  const query = String(search || "").trim();
  const waitingChars = !isTipos && query.length < MIN_PARTY;
  const showSpinner = loading && items.length === 0;

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-slate-600" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar
        </Button>
        <p className="text-sm font-medium text-slate-800">
          {isTipos ? "Tipos de título no Protheus" : partyLabel}
        </p>
      </div>
      <p className="text-xs text-slate-500">
        {isTipos
          ? "Consulta SX5 tabela 05. Tipos deletados não aparecem."
          : "Busca no Protheus por código, nome ou CNPJ (espaços são ignorados). Deletados e bloqueados não aparecem."}
        {meta?.endpoint ? ` · ${meta.endpoint}` : ""}
      </p>
      <div className="relative">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-9"
          placeholder={isTipos ? "Código ou descrição (NP, NF, IOF...)" : "Digite ao menos 2 caracteres"}
          autoFocus
        />
        {loading && items.length > 0 ? (
          <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-slate-400" />
        ) : null}
      </div>
      <ScrollArea className="h-72 rounded-md border border-slate-200">
        {waitingChars ? (
          <div className="flex h-72 items-center justify-center px-6 text-center text-sm text-slate-500">
            Digite ao menos {MIN_PARTY} caracteres para consultar o Protheus.
          </div>
        ) : showSpinner ? (
          <div className="flex h-72 items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Consultando Protheus...
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-72 items-center justify-center px-6 text-center text-sm text-slate-500">
            Nenhum registro ativo encontrado. Tente o início do nome, o código ou o CNPJ.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => {
              const key = isTipos ? item.codigo : `${item.codigo}-${item.loja}`;
              return (
                <li key={key}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left hover:bg-sky-50"
                    onClick={() => onSelect(item)}
                  >
                    {isTipos ? (
                      <>
                        <span className="text-sm font-semibold text-slate-800">{item.codigo}</span>
                        <span className="text-xs text-slate-500">{item.descricao}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-sm font-medium text-slate-800">
                          <span className="">{item.codigo}</span>
                          <span className="mx-1.5 text-slate-300">·</span>
                          loja {item.loja}
                          <span className="mx-1.5 text-slate-300">·</span>
                          {item.nome}
                        </span>
                        {(item.razao && item.razao !== item.nome) || item.cnpj ? (
                          <span className="text-xs text-slate-500">
                            {[item.razao !== item.nome ? item.razao : "", formatCnpj(item.cnpj)].filter(Boolean).join(" · ")}
                          </span>
                        ) : null}
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
      {meta?.truncated ? (
        <p className="text-xs text-slate-400">Mostrando os primeiros registros. Refine a busca para localizar o item.</p>
      ) : null}
    </div>
  );
}

export function LookupField({ label, value, onChange, onLookup, placeholder, className = "", mono = false }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <Label className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</Label>
      <div className="flex gap-1">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`h-9 ${mono ? "" : ""}`}
          placeholder={placeholder}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0 border-sky-200 text-sky-700 hover:bg-sky-50"
          title="Consultar no Protheus"
          onClick={onLookup}
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
