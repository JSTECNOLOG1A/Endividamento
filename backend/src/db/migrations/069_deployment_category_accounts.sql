-- Implantação de saldos: contas do lançamento de abertura por categoria da operação
-- (empréstimos, financiamentos...), cada uma com principal e juros, circulante e não circulante.
-- Formato: { "emprestimos": { "principal_cp": id, "principal_lp": id, "juros_cp": id, "juros_lp": id }, ... }
-- As quatro colunas antigas (uma conta para todas as categorias) continuam valendo como alternativa
-- para a categoria que não tiver contas próprias.
ALTER TABLE balance_deployment_configs
  ADD COLUMN IF NOT EXISTS category_accounts JSONB;
