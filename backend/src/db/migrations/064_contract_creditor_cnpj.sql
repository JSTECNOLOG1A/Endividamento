-- CNPJ da instituição financeira (credor) no contrato.
-- Usado na geração de títulos a pagar para localizar fornecedor SA2 no Protheus
-- (A2_COD / A2_LOJA) pelo A2_CGC, em vez de derivar do código COMPE do banco.

ALTER TABLE loan_contracts
  ADD COLUMN IF NOT EXISTS creditor_cnpj text;

COMMENT ON COLUMN loan_contracts.creditor_cnpj IS
  'CNPJ da instituição financeira credora (somente dígitos). Lookup SA2 na geração de títulos.';
