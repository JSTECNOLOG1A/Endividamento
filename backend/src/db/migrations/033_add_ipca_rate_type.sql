-- 033_add_ipca_rate_type.sql
-- Adiciona IPCA como rate_type válido em cdi_rates (motor de cálculo ganhou
-- suporte a indexador IPCA — ver backend/src/engine/indexers/IPCAIndexer.js).
-- A tabela é reaproveitada para qualquer índice de taxa/correção monetária
-- por rate_date; o nome "cdi_rates" ficou como legado.

ALTER TABLE cdi_rates DROP CONSTRAINT cdi_rates_rate_type_check;
ALTER TABLE cdi_rates ADD CONSTRAINT cdi_rates_rate_type_check CHECK (rate_type IN ('CDI', 'SELIC', 'IPCA'));
