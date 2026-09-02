-- 034_add_tjlp_rate_type.sql
-- Adiciona TJLP como rate_type válido em cdi_rates (motor ganhou suporte a
-- indexador TJLP — ver backend/src/engine/indexers/TJLPIndexer.js).

ALTER TABLE cdi_rates DROP CONSTRAINT cdi_rates_rate_type_check;
ALTER TABLE cdi_rates ADD CONSTRAINT cdi_rates_rate_type_check CHECK (rate_type IN ('CDI', 'SELIC', 'IPCA', 'TJLP'));
