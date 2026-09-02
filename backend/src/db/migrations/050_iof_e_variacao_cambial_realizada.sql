-- Completa o motor de fechamento contábil do lado passivo: IOF (evento
-- novo — hoje é só um valor fixo no contrato, sem apropriação) e a divisão
-- de variação cambial em provisão (já existente, calculada por competência
-- a partir do cronograma) x realizada (nova, calculada na baixa pela PTAX
-- real do pagamento).
ALTER TABLE accounting_event_mappings
  DROP CONSTRAINT accounting_event_mappings_event_type_check,
  ADD CONSTRAINT accounting_event_mappings_event_type_check CHECK (event_type IN (
    'liberacao', 'juros_apropriados', 'pagamento_principal', 'pagamento_juros',
    'variacao_cambial_passiva', 'variacao_cambial_ativa',
    'variacao_cambial_passiva_realizada', 'variacao_cambial_ativa_realizada',
    'tarifa_bancaria', 'iof',
    'custo_transacao_inicial', 'custo_transacao_apropriacao',
    'reclassificacao_circulante_principal', 'reclassificacao_circulante_juros',
    'multa_mora', 'desconto_financeiro', 'ajuste_arredondamento', 'outros'
  ));

-- PTAX na data real do pagamento — necessária pra calcular a variação
-- cambial realizada (a tabela hoje só guarda os valores pagos, não a taxa
-- vigente naquele dia). Só preenchido pra contratos indexados em USD.
ALTER TABLE contract_settlements
  ADD COLUMN IF NOT EXISTS exchange_rate_pagamento NUMERIC(18, 6);
