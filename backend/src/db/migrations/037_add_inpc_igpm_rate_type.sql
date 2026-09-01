-- 037_add_inpc_igpm_rate_type.sql
-- Adiciona INPC e IGP-M como rate_type válidos em cdi_rates (motor ganhou
-- suporte aos indexadores INPC e IGP-M — ver
-- backend/src/engine/indexers/INPCIndexer.js e IGPMIndexer.js).

ALTER TABLE cdi_rates DROP CONSTRAINT cdi_rates_rate_type_check;
ALTER TABLE cdi_rates ADD CONSTRAINT cdi_rates_rate_type_check CHECK (rate_type IN ('CDI', 'SELIC', 'IPCA', 'TJLP', 'TR', 'INPC', 'IGPM'));
