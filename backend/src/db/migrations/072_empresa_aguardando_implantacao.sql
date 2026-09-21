-- Pré-implantação: toda empresa nasce (e as existentes ficam) aguardando a implantação de saldos.
-- Enquanto a chave está ligada, aprovar contrato não gera títulos, nada é integrado ao ERP e o fechamento contábil
-- automático não roda para a empresa. A chave desliga ao aplicar a implantação (que gera os títulos necessários,
-- retidos até a liberação).
ALTER TABLE company_entities
  ADD COLUMN IF NOT EXISTS implantacao_pendente BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS implantacao_liberada_em TIMESTAMPTZ;
