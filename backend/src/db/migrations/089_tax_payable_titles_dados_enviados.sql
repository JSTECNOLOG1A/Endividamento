-- Título de tributo: os dados gravados (chave, valor, vencimento...) chegaram a ser mandados ao Protheus?
-- Falso quando o título parou antes do envio (ex.: a chave já existia no Protheus): são os dados que SERIAM enviados.
ALTER TABLE tax_payable_titles ADD COLUMN IF NOT EXISTS dados_enviados BOOLEAN NOT NULL DEFAULT true;
