-- Título a pagar com código de barras e linha digitável, enviados ao Protheus na inclusão (E2_CODBAR / E2_LINDIG).
-- Opcionais: os títulos de empréstimo não têm boleto e continuam sem. Só dígitos.
--   codigo_barras: 44 dígitos — guia de arrecadação (começa com 8) ou boleto bancário.
--   linha_digitavel: 48 dígitos (arrecadação, começa com 8) ou 47 (boleto bancário), e só junto do código de
--   barras, que precisa ser o mesmo que a linha representa (mesma regra de tax_installment_guides).

ALTER TABLE payable_titles ADD COLUMN IF NOT EXISTS codigo_barras TEXT;
ALTER TABLE payable_titles ADD COLUMN IF NOT EXISTS linha_digitavel TEXT;

ALTER TABLE payable_titles ADD CONSTRAINT payable_titles_codigo_barras_check
  CHECK (codigo_barras IS NULL OR codigo_barras ~ '^[0-9]{44}$');

ALTER TABLE payable_titles ADD CONSTRAINT payable_titles_linha_digitavel_check
  CHECK (
    linha_digitavel IS NULL
    OR (
      codigo_barras IS NOT NULL
      AND (
        -- Arrecadação: os 4 blocos de 11 da linha (sem os dígitos de bloco) são o código de barras.
        (linha_digitavel ~ '^8[0-9]{47}$'
          AND substr(linha_digitavel, 1, 11) || substr(linha_digitavel, 13, 11)
              || substr(linha_digitavel, 25, 11) || substr(linha_digitavel, 37, 11) = codigo_barras)
        OR
        -- Boleto bancário: banco+moeda, DV geral, fator+valor e os três campos do campo livre.
        (linha_digitavel ~ '^[0-9]{47}$'
          AND substr(linha_digitavel, 1, 4) || substr(linha_digitavel, 33, 1) || substr(linha_digitavel, 34, 14)
              || substr(linha_digitavel, 5, 5) || substr(linha_digitavel, 11, 10) || substr(linha_digitavel, 22, 10)
              = codigo_barras)
      )
    )
  );
