-- T2 (baixa efetiva) e T3 (implantação de saldos). Tudo aditivo e com padrão neutro:
-- nenhum contrato ou título existente muda de comportamento.

-- Origem e data da baixa do título (retorno do ERP ou baixa manual em Contas a Pagar).
ALTER TABLE payable_titles
  ADD COLUMN IF NOT EXISTS baixa_origem TEXT CHECK (baixa_origem IS NULL OR baixa_origem IN ('erp', 'manual')),
  ADD COLUMN IF NOT EXISTS baixa_data DATE,
  ADD COLUMN IF NOT EXISTS baixa_por TEXT,
  ADD COLUMN IF NOT EXISTS retido_implantacao BOOLEAN NOT NULL DEFAULT false;

-- Contrato em implantação de saldos: só gera título de parcelas depois da data de corte
-- (mais as parcelas vencidas em aberto informadas) e o fechamento não roda competências
-- até o corte. Sem a marca, o contrato se comporta exatamente como hoje.
ALTER TABLE loan_contracts
  ADD COLUMN IF NOT EXISTS deployment_mode BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deployment_cutoff DATE,
  ADD COLUMN IF NOT EXISTS deployment_open_parcelas JSONB;

CREATE INDEX IF NOT EXISTS payable_titles_retido_idx ON payable_titles (retido_implantacao) WHERE retido_implantacao;
