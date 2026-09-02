-- A matriz contábil (accounting_event_mappings) passa a ser configurada por
-- empresa + evento + categoria de operação (empréstimos, financiamentos,
-- terceiros/partes relacionadas), não só por empresa + evento. Isso permite
-- separar as contas no balancete — inclusive é obrigatório separar
-- operações com partes relacionadas das demais.
--
-- Linhas já configuradas (todas anteriores a esta migração eram, na
-- prática, sobre contratos de empréstimos/financiamentos "de mercado")
-- recebem 'emprestimos' como categoria por padrão — quem quiser separar
-- financiamentos ou já tiver contratos de terceiros só precisa cadastrar as
-- linhas adicionais na Matriz Contábil.
ALTER TABLE accounting_event_mappings
  ADD COLUMN operation_category TEXT NOT NULL DEFAULT 'emprestimos'
    CHECK (operation_category IN ('emprestimos', 'financiamentos', 'terceiros'));

DROP INDEX accounting_event_mappings_entity_event_uidx;

CREATE UNIQUE INDEX accounting_event_mappings_entity_event_category_uidx
  ON accounting_event_mappings (entity_id, event_type, operation_category);
