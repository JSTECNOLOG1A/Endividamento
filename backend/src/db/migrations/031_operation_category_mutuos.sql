-- A categoria "terceiros" (partes relacionadas) virou duas categorias
-- distintas de primeiro nível: "Mútuos com Partes Relacionadas" (sócios,
-- controladora, coligadas) e "Mútuos com Terceiros" (fora do grupo
-- econômico, sem ser banco) — o cliente decidiu que balancete e notas
-- explicativas precisam diferenciar as duas, não só separá-las do resto.
--
-- Linhas da matriz contábil já configuradas como 'terceiros' são
-- remapeadas para 'mutuos_terceiros' (mais próximo do agrupamento
-- anterior) — reconfigure na tela se precisar também de contas separadas
-- para 'mutuos_partes_relacionadas'.
UPDATE accounting_event_mappings SET operation_category = 'mutuos_terceiros' WHERE operation_category = 'terceiros';

ALTER TABLE accounting_event_mappings
  DROP CONSTRAINT accounting_event_mappings_operation_category_check;

ALTER TABLE accounting_event_mappings
  ADD CONSTRAINT accounting_event_mappings_operation_category_check
    CHECK (operation_category IN ('emprestimos', 'financiamentos', 'mutuos_partes_relacionadas', 'mutuos_terceiros'));
