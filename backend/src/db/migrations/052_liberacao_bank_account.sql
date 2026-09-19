-- Conta bancária específica na liberação e vínculo real de conta bancária
-- com o plano de contas — hoje a matriz contábil (accounting_event_mappings)
-- só tem UMA conta de banco por evento+categoria, sem como distinguir
-- "recurso caiu na conta X do Sicredi" de "conta Y do Sicredi, outra
-- agência" ou de outro banco. Ver plano "Conta bancária específica no
-- motor de fechamento (liberação e pagamentos)".
--
-- 100% aditivo: nenhuma coluna existente muda. Contrato/conta bancária sem
-- esses campos preenchidos continuam sendo lançados exatamente como hoje
-- (fallback para a matriz em accounting/closingEngine.js e
-- src/lib/accountingClosing.js).
ALTER TABLE loan_contracts
  ADD COLUMN IF NOT EXISTS disbursement_bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL;

ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS chart_account_id TEXT REFERENCES chart_of_accounts(id) ON DELETE SET NULL;

-- Backfill best-effort: só preenche onde o texto livre importado do
-- Protheus (conta_contabil) bate exatamente com um account_code do plano
-- de contas do mesmo grupo (ou do catálogo compartilhado) — não força
-- nenhum vínculo ambíguo.
UPDATE bank_accounts ba
SET chart_account_id = coa.id
FROM chart_of_accounts coa
WHERE ba.chart_account_id IS NULL
  AND ba.conta_contabil IS NOT NULL AND btrim(ba.conta_contabil) <> ''
  AND coa.account_code = btrim(ba.conta_contabil)
  AND (coa.group_id = ba.group_id OR coa.group_id IS NULL);
