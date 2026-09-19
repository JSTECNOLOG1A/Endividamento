-- Evento novo do fechamento contábil: capitalização de juros (juros a pagar -> principal).
-- Contratos com carência e capitalização incorporam juros ao principal; sem este evento o
-- fechamento deixava principal negativo e juros a pagar positivo no fim do contrato.
ALTER TABLE accounting_event_mappings
  DROP CONSTRAINT accounting_event_mappings_event_type_check,
  ADD CONSTRAINT accounting_event_mappings_event_type_check CHECK (event_type IN (
    'liberacao', 'juros_apropriados', 'pagamento_principal', 'pagamento_juros',
    'variacao_cambial_passiva', 'variacao_cambial_ativa',
    'variacao_cambial_passiva_realizada', 'variacao_cambial_ativa_realizada',
    'tarifa_bancaria', 'iof',
    'custo_transacao_inicial', 'custo_transacao_apropriacao',
    'capitalizacao_juros',
    'reclassificacao_circulante_principal', 'reclassificacao_circulante_juros',
    'multa_mora', 'desconto_financeiro', 'ajuste_arredondamento', 'outros'
  ));
