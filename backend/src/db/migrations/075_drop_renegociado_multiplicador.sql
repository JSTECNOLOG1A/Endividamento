-- A regra de "contratos renegociados" deixou de ser um multiplicador sobre
-- implantação/mensalidade — agora a quantidade informada na proposta soma
-- direto à carteira ativa (mesmo mecanismo de blocos de 20 contratos já
-- existente). O parâmetro fica sem uso.
ALTER TABLE commercial_pricing_config
  DROP COLUMN IF EXISTS renegociado_multiplicador;
