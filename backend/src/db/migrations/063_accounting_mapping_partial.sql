-- A matriz da Lógica Contábil passa a salvar automaticamente, mesmo com só uma
-- das contas informada (débito ou crédito). Um mapeamento incompleto não gera
-- lançamento: o fechamento o trata como "matriz incompleta" até as duas contas
-- estarem preenchidas.
ALTER TABLE accounting_event_mappings ALTER COLUMN debit_account_id DROP NOT NULL;
ALTER TABLE accounting_event_mappings ALTER COLUMN credit_account_id DROP NOT NULL;
