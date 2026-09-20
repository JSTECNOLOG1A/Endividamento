-- Implantação de saldos: título de parcela que a implantação já tratou (vencimento até a data-base e não
-- informada como vencida em aberto) recebe um status próprio. Não é aberto nem pago: fica fora da integração
-- com o ERP, da baixa, da consulta ao ERP, das baixas do fechamento e da lista do Contas a Pagar.
-- Nada é apagado; o status anterior fica guardado para auditoria e eventual reversão.
ALTER TABLE payable_titles DROP CONSTRAINT IF EXISTS payable_titles_status_check;
ALTER TABLE payable_titles
  ADD CONSTRAINT payable_titles_status_check
  CHECK (status IN ('aberto', 'baixado', 'cancelado', 'ignorado_implantacao'));

ALTER TABLE payable_titles
  ADD COLUMN IF NOT EXISTS status_antes_implantacao TEXT;
