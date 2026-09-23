-- Custo de transação por contrato: reconhecido no ato (padrão, comportamento inalterado) ou amortizado ao longo
-- do prazo. CPC 08 (R1), item 12: os encargos financeiros da captação são apropriados ao resultado em função da
-- fluência do prazo, pelo método dos juros efetivos (TIR da operação) — aqui, simplificação em linha reta por
-- dias corridos (ver closingEngine.js / accountingClosing.js).
ALTER TABLE loan_contracts
  ADD COLUMN IF NOT EXISTS transaction_cost_recognition TEXT NOT NULL DEFAULT 'imediato';

ALTER TABLE loan_contracts
  DROP CONSTRAINT IF EXISTS loan_contracts_transaction_cost_recognition_check,
  ADD CONSTRAINT loan_contracts_transaction_cost_recognition_check
  CHECK (transaction_cost_recognition IN ('imediato', 'amortizado'));

-- Novo evento na matriz contábil: custo de transação diferido (ativo, reconhecido no desembolso quando a
-- política do contrato é "amortizado"); a apropriação mensal já existe (custo_transacao_apropriacao, revivido).
ALTER TABLE accounting_event_mappings
  DROP CONSTRAINT IF EXISTS accounting_event_mappings_event_type_check,
  ADD CONSTRAINT accounting_event_mappings_event_type_check CHECK (event_type IN (
    'liberacao', 'juros_apropriados', 'pagamento_principal', 'pagamento_juros',
    'variacao_cambial_passiva', 'variacao_cambial_ativa',
    'variacao_cambial_passiva_realizada', 'variacao_cambial_ativa_realizada',
    'tarifa_bancaria', 'iof',
    'custo_transacao_inicial', 'custo_transacao_apropriacao', 'custo_transacao_diferido',
    'capitalizacao_juros', 'ajuste_provisao_juros',
    'reclassificacao_circulante_principal', 'reclassificacao_circulante_juros',
    'multa_mora', 'desconto_financeiro', 'ajuste_arredondamento', 'outros'
  ));
