DROP INDEX IF EXISTS payable_titles_contract_prefixo_parcela_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS payable_titles_contract_prefixo_parcela_active_uidx
  ON payable_titles (contract_id, prefixo, parcela)
  WHERE status = 'aberto';

DROP INDEX IF EXISTS receivable_titles_contract_parcela_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS receivable_titles_contract_parcela_active_uidx
  ON receivable_titles (contract_id, parcela)
  WHERE status = 'aberto';
