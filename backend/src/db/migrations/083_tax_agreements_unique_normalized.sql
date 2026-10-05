-- Gestão Tributária: o número do parcelamento é único por empresa, órgão e modalidade sem diferenciar
-- maiúsculas/minúsculas nem espaços — "Receita Federal" e "receita  federal" são o mesmo acordo e não podem
-- entrar duas vezes no saldo total. O servidor já grava normalizado; o índice garante contra qualquer caminho.

-- Espaço sobrando nas pontas ou repetido no meio sai dos dados já gravados (mesma regra da gravação).
UPDATE tax_agreements
   SET orgao = regexp_replace(btrim(orgao), '\s+', ' ', 'g'),
       modalidade = regexp_replace(btrim(modalidade), '\s+', ' ', 'g'),
       codigo_parcelamento = regexp_replace(btrim(codigo_parcelamento), '\s+', ' ', 'g')
 WHERE orgao <> regexp_replace(btrim(orgao), '\s+', ' ', 'g')
    OR modalidade <> regexp_replace(btrim(modalidade), '\s+', ' ', 'g')
    OR codigo_parcelamento <> regexp_replace(btrim(codigo_parcelamento), '\s+', ' ', 'g');

-- Duplicata que só difere por caixa já gravada não é resolvida aqui (escolher qual manter é decisão de
-- negócio): a migração para com a lista do que precisa ser corrigido antes.
DO $$
DECLARE
  duplicates TEXT;
BEGIN
  SELECT string_agg(format('grupo %s, empresa %s, órgão "%s", modalidade "%s", número "%s"',
                           group_id, entity_id, orgao_key, modalidade_key, codigo_key), '; ')
    INTO duplicates
    FROM (
      SELECT group_id, entity_id, lower(orgao) AS orgao_key, lower(modalidade) AS modalidade_key,
             lower(codigo_parcelamento) AS codigo_key
        FROM tax_agreements
       GROUP BY 1, 2, 3, 4, 5
      HAVING count(*) > 1
    ) d;
  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'Parcelamentos duplicados (diferem só por maiúsculas/minúsculas): %', duplicates;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tax_agreements_code_norm_uidx
  ON tax_agreements (group_id, entity_id, lower(orgao), lower(modalidade), lower(codigo_parcelamento));

-- O índice anterior (exato) fica contido no novo.
DROP INDEX IF EXISTS tax_agreements_code_uidx;
