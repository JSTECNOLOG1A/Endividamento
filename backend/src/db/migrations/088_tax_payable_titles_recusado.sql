-- Título de tributo recusado explicitamente pelo Protheus (erro com mensagem): não é reenviado pelo agendador;
-- volta a tentar quando alguém pede ou quando muda algo do envio (guia, parâmetros).
ALTER TABLE tax_payable_titles DROP CONSTRAINT IF EXISTS tax_payable_titles_situacao_check;
ALTER TABLE tax_payable_titles ADD CONSTRAINT tax_payable_titles_situacao_check
  CHECK (situacao IN ('pendente', 'incerto', 'recusado', 'enviado', 'estornado', 'baixado', 'parcial', 'conferencia'));
