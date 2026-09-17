-- Liberação em parcelas ("tranches"): linhas de crédito com carência longa
-- (FCO/FNO, projetos de investimento) frequentemente liberam o principal em
-- várias datas, não tudo de uma vez em operation_date. Guarda o cronograma
-- como [{date, amount}, ...]; quando presente e não-vazio, é a fonte de
-- verdade de COMO o principal entra no cálculo (ver CalculationEngine.js).
-- operation_value continua sendo o total (deve bater com a soma dos valores
-- aqui dentro).
--
-- 100% aditivo/opcional: contrato sem este campo (NULL ou []) continua se
-- comportando exatamente como hoje — liberação única em operation_date.
ALTER TABLE loan_contracts
  ADD COLUMN IF NOT EXISTS disbursement_schedule JSONB;
