-- Evento novo do fechamento contábil: ajuste de provisão de juros.
-- Contratos indexados (CDI, SELIC, IPCA...) são provisionados com a melhor estimativa: taxa real onde já foi
-- publicada, última taxa conhecida onde não. Quando a taxa real sai, o fechamento recalcula o cronograma e a
-- diferença entre a provisão acumulada e o que já estava lançado entra no mês corrente por este evento
-- (débito = despesa financeira, crédito = provisão de juros; o sistema inverte quando a provisão diminui).
ALTER TABLE accounting_event_mappings
  DROP CONSTRAINT accounting_event_mappings_event_type_check,
  ADD CONSTRAINT accounting_event_mappings_event_type_check CHECK (event_type IN (
    'liberacao', 'juros_apropriados', 'pagamento_principal', 'pagamento_juros',
    'variacao_cambial_passiva', 'variacao_cambial_ativa',
    'variacao_cambial_passiva_realizada', 'variacao_cambial_ativa_realizada',
    'tarifa_bancaria', 'iof',
    'custo_transacao_inicial', 'custo_transacao_apropriacao',
    'capitalizacao_juros', 'ajuste_provisao_juros',
    'reclassificacao_circulante_principal', 'reclassificacao_circulante_juros',
    'multa_mora', 'desconto_financeiro', 'ajuste_arredondamento', 'outros'
  ));
