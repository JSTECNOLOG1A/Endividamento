-- Substitui o placeholder único "reclassificacao_circulante" por dois
-- eventos separados (principal e juros), cada um com seu próprio par de
-- contas na matriz — nenhuma linha em accounting_event_mappings usa o valor
-- antigo ainda (o evento nunca chegou a ser gerado pelo motor), então é
-- seguro trocar direto sem migração de dados.
ALTER TABLE accounting_event_mappings
  DROP CONSTRAINT accounting_event_mappings_event_type_check,
  ADD CONSTRAINT accounting_event_mappings_event_type_check CHECK (event_type IN (
    'liberacao', 'juros_apropriados', 'pagamento_principal', 'pagamento_juros',
    'variacao_cambial_passiva', 'variacao_cambial_ativa', 'tarifa_bancaria',
    'custo_transacao_inicial', 'custo_transacao_apropriacao',
    'reclassificacao_circulante_principal', 'reclassificacao_circulante_juros',
    'multa_mora', 'desconto_financeiro', 'ajuste_arredondamento', 'outros'
  ));
