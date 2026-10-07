-- Título de tributo pago no Protheus sem data de baixa informada (a parcela não pode ser atualizada sem a data):
-- desde quando. O agendador desiste depois de um prazo; a consulta pedida na tela continua tentando.
ALTER TABLE tax_payable_titles ADD COLUMN IF NOT EXISTS baixa_sem_data_desde TIMESTAMPTZ;
