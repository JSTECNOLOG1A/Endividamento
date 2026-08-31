-- 035_add_tr_rate_type.sql
-- Adiciona TR como rate_type válido em cdi_rates (motor ganhou suporte a
-- indexador TR — ver backend/src/engine/indexers/TRIndexer.js).

ALTER TABLE cdi_rates DROP CONSTRAINT cdi_rates_rate_type_check;
ALTER TABLE cdi_rates ADD CONSTRAINT cdi_rates_rate_type_check CHECK (rate_type IN ('CDI', 'SELIC', 'IPCA', 'TJLP', 'TR'));
