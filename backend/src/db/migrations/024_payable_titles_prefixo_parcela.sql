DROP INDEX IF EXISTS payable_titles_contract_parcela_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS payable_titles_contract_prefixo_parcela_uidx
  ON payable_titles (contract_id, prefixo, parcela);
