-- Desfecho da proposta comercial: aceite (com o arquivo assinado, opcional)
-- e recusa. Até aqui o CHECK de status (076) previa 'aceita'/'recusada', mas
-- nenhum caminho gravava esses valores nem guardava quem decidiu e quando.
--
-- Arquivos (assinado e PDF enviado por e-mail) ficam no disco, em pasta
-- própria dentro do diretório de uploads; aqui fica só o caminho relativo a
-- essa pasta (arquivo_assinado_chave / file_key) e o nome original, usado no
-- download.
--
-- Nomes: conteúdo do negócio em português, como as colunas irmãs do termo de
-- contratação (assinatura_cidade, contratada_cargo); metadados de registro
-- (quem e quando) em inglês, como created_by/updated_date. Em
-- commercial_proposal_sends todas as colunas são em inglês (file_name), e as
-- novas seguem a tabela.

ALTER TABLE commercial_proposals
  -- Aceite
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_by_email TEXT,
  ADD COLUMN IF NOT EXISTS accepted_by_name TEXT,
  -- Data em que o cliente assinou (dia de calendário, não o registro).
  ADD COLUMN IF NOT EXISTS data_assinatura DATE,
  ADD COLUMN IF NOT EXISTS nome_assinante TEXT,
  ADD COLUMN IF NOT EXISTS cargo_assinante TEXT,
  ADD COLUMN IF NOT EXISTS canal_aceite TEXT
    CHECK (canal_aceite IN ('email', 'whatsapp', 'em_maos')),
  ADD COLUMN IF NOT EXISTS observacao_aceite TEXT,
  ADD COLUMN IF NOT EXISTS arquivo_assinado_chave TEXT,
  ADD COLUMN IF NOT EXISTS arquivo_assinado_nome TEXT,
  ADD COLUMN IF NOT EXISTS arquivo_assinado_tamanho INTEGER,
  -- Recusa
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by_email TEXT,
  ADD COLUMN IF NOT EXISTS rejected_by_name TEXT,
  ADD COLUMN IF NOT EXISTS motivo_recusa TEXT;

-- Proposta aceita sempre carrega quem assinou, quando e por qual canal;
-- recusada sempre carrega o motivo. NOT VALID: vale para toda escrita daqui em
-- diante sem reprovar a migração por alguma linha antiga gravada fora do app.
ALTER TABLE commercial_proposals
  ADD CONSTRAINT commercial_proposals_acceptance_complete CHECK (
    status <> 'aceita'
    OR (accepted_at IS NOT NULL AND data_assinatura IS NOT NULL AND nome_assinante IS NOT NULL AND canal_aceite IS NOT NULL)
  ) NOT VALID;

ALTER TABLE commercial_proposals
  ADD CONSTRAINT commercial_proposals_rejection_complete CHECK (
    status <> 'recusada' OR (rejected_at IS NOT NULL AND motivo_recusa IS NOT NULL)
  ) NOT VALID;

-- PDF que foi de fato anexado ao e-mail. NULL em tentativa que falhou (nada
-- chegou ao cliente) e nos envios anteriores a esta migração.
ALTER TABLE commercial_proposal_sends
  ADD COLUMN IF NOT EXISTS file_key TEXT,
  ADD COLUMN IF NOT EXISTS file_size INTEGER;
