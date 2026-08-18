ALTER TABLE payable_titles
  ADD COLUMN IF NOT EXISTS fornecedor TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS fornecedor_loja TEXT NOT NULL DEFAULT '01',
  ADD COLUMN IF NOT EXISTS fornecedor_nome TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS integrado_erp BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS integrado_erp_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS erp_mensagem TEXT;

UPDATE payable_titles t
SET
  fornecedor = CASE
    WHEN COALESCE(t.fornecedor, '') <> '' THEN t.fornecedor
    WHEN COALESCE(b.bank_code, '') <> '' THEN lpad(regexp_replace(b.bank_code, '[^0-9]', '', 'g'), 6, '0')
    ELSE t.fornecedor
  END,
  fornecedor_nome = CASE
    WHEN COALESCE(t.fornecedor_nome, '') <> '' THEN t.fornecedor_nome
    ELSE COALESCE(b.bank_name, t.fornecedor_nome, '')
  END,
  fornecedor_loja = CASE
    WHEN COALESCE(t.fornecedor_loja, '') <> '' THEN t.fornecedor_loja
    ELSE '01'
  END
FROM loan_contracts c
LEFT JOIN banks b ON b.id = c.bank_id
WHERE t.contract_id = c.id;

CREATE INDEX IF NOT EXISTS payable_titles_erp_idx
  ON payable_titles (integrado_erp, status);
