import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { digitsOnly, formatCnpj, signupApi } from "@/api/signup";

const EMPTY_COMPANY = {
  cnpj: "",
  razao_social: "",
  nome_fantasia: "",
  situacao: "",
  data_abertura: "",
  natureza_juridica: "",
  porte: "",
  capital_social: "",
  cnae: "",
  cnae_codigo: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  municipio: "",
  uf: "",
  cep: "",
  telefone: "",
  email: "",
  endereco: "",
};

function Field({ id, label, children }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export default function Signup() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [domain, setDomain] = useState("");
  const [company, setCompany] = useState(EMPTY_COMPANY);
  const [lookuping, setLookuping] = useState(false);
  const [lookedUp, setLookedUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const cnpjDigits = digitsOnly(company.cnpj);

  async function lookup(cnpj) {
    const digits = digitsOnly(cnpj);
    if (digits.length !== 14) return;
    setLookuping(true);
    setError(null);
    try {
      const data = await signupApi.lookupCnpj(digits);
      setCompany({ ...EMPTY_COMPANY, ...data, cnpj: formatCnpj(data.cnpj || digits) });
      setCompanyName((current) => current || data.razao_social || data.nome_fantasia || "");
      setLookedUp(true);
    } catch (err) {
      setLookedUp(false);
      setError(err.message || "Não foi possível consultar o CNPJ");
    } finally {
      setLookuping(false);
    }
  }

  useEffect(() => {
    if (cnpjDigits.length !== 14) {
      setLookedUp(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      lookup(cnpjDigits);
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cnpjDigits]);

  const inactive = useMemo(() => {
    const situacao = String(company.situacao || "").toUpperCase();
    return situacao && !situacao.includes("ATIVA");
  }, [company.situacao]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const created = await signupApi.start({
        full_name: fullName,
        email,
        company_name: companyName,
        domain,
        cnpj: cnpjDigits,
        company,
      });
      setResult(created);
    } catch (err) {
      setError(err.message || "Não foi possível iniciar o cadastro");
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <div className="fixed inset-0 overflow-auto bg-slate-50 p-6">
        <div className="mx-auto w-full max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <h1 className="text-lg font-semibold text-slate-900">Verifique seu e-mail</h1>
          <p className="text-sm text-slate-600">
            Enviamos um link para <strong>{result.email}</strong> concluir o cadastro da empresa{" "}
            <strong>{result.company_name}</strong> e criar a primeira senha.
          </p>
          {result.email_sent ? (
            <p className="text-sm text-slate-500">O link expira em 48 horas.</p>
          ) : (
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p>O servidor de e-mail ainda não está configurado. Use o link abaixo para concluir o cadastro neste ambiente.</p>
              {result.confirm_url ? (
                <a className="break-all text-sky-700 underline" href={result.confirm_url}>
                  {result.confirm_url}
                </a>
              ) : null}
            </div>
          )}
          <Link to="/" className="inline-block text-sm text-slate-600 underline">
            Voltar ao login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-auto bg-slate-50 p-6">
      <form onSubmit={handleSubmit} className="mx-auto w-full max-w-3xl space-y-6 rounded-xl border border-slate-200 bg-white p-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Criar conta</h1>
          <p className="mt-1 text-sm text-slate-500">
            Cadastre a empresa principal. Os dados do CNPJ são preenchidos automaticamente pela Receita Federal.
          </p>
        </div>

        <section className="grid gap-4 md:grid-cols-2">
          <Field id="cnpj" label="CNPJ">
            <Input
              id="cnpj"
              value={company.cnpj}
              onChange={(e) => {
                setLookedUp(false);
                setCompany((current) => ({ ...current, cnpj: formatCnpj(e.target.value) }));
              }}
              placeholder="00.000.000/0000-00"
              required
            />
            {lookuping ? <p className="text-xs text-slate-500">Consultando Receita Federal...</p> : null}
          </Field>
          <Field id="company_name" label="Empresa principal">
            <Input
              id="company_name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
            />
          </Field>
          <Field id="domain" label="Domínio da empresa">
            <Input
              id="domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="empresa.com.br"
              required
            />
            <p className="text-xs text-slate-500">Cada domínio pode ser usado em uma única conta.</p>
          </Field>
          <Field id="razao_social" label="Razão social">
            <Input
              id="razao_social"
              value={company.razao_social}
              onChange={(e) => setCompany((current) => ({ ...current, razao_social: e.target.value }))}
              readOnly={lookedUp}
            />
          </Field>
          <Field id="nome_fantasia" label="Nome fantasia">
            <Input
              id="nome_fantasia"
              value={company.nome_fantasia}
              onChange={(e) => setCompany((current) => ({ ...current, nome_fantasia: e.target.value }))}
            />
          </Field>
          <Field id="situacao" label="Situação cadastral">
            <Input id="situacao" value={company.situacao} readOnly />
          </Field>
          <Field id="data_abertura" label="Data de abertura">
            <Input id="data_abertura" value={company.data_abertura} readOnly />
          </Field>
          <Field id="natureza" label="Natureza jurídica">
            <Input id="natureza" value={company.natureza_juridica} readOnly />
          </Field>
          <Field id="porte" label="Porte">
            <Input id="porte" value={company.porte} readOnly />
          </Field>
          <Field id="capital" label="Capital social">
            <Input id="capital" value={company.capital_social} readOnly />
          </Field>
          <div className="md:col-span-2">
            <Field id="cnae" label="CNAE principal">
              <Input id="cnae" value={[company.cnae_codigo, company.cnae].filter(Boolean).join(" — ")} readOnly />
            </Field>
          </div>
          <Field id="logradouro" label="Logradouro">
            <Input id="logradouro" value={company.logradouro} readOnly />
          </Field>
          <Field id="numero" label="Número">
            <Input id="numero" value={company.numero} readOnly />
          </Field>
          <Field id="complemento" label="Complemento">
            <Input id="complemento" value={company.complemento} readOnly />
          </Field>
          <Field id="bairro" label="Bairro">
            <Input id="bairro" value={company.bairro} readOnly />
          </Field>
          <Field id="municipio" label="Município">
            <Input id="municipio" value={company.municipio} readOnly />
          </Field>
          <Field id="uf" label="UF">
            <Input id="uf" value={company.uf} readOnly />
          </Field>
          <Field id="cep" label="CEP">
            <Input id="cep" value={company.cep} readOnly />
          </Field>
          <Field id="telefone" label="Telefone">
            <Input id="telefone" value={company.telefone} readOnly />
          </Field>
        </section>

        {inactive ? (
          <p className="text-sm text-amber-700">
            A situação cadastral deste CNPJ não está ativa. Confira os dados antes de continuar.
          </p>
        ) : null}

        <section className="grid gap-4 border-t border-slate-100 pt-4 md:grid-cols-2">
          <Field id="full_name" label="Seu nome completo">
            <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </Field>
          <Field id="email" label="E-mail da conta">
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
        </section>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="text-sm text-slate-600 underline">
            Já tenho conta
          </Link>
          <Button type="submit" disabled={saving || lookuping || cnpjDigits.length !== 14}>
            {saving ? "Enviando..." : "Criar conta"}
          </Button>
        </div>
      </form>
    </div>
  );
}
