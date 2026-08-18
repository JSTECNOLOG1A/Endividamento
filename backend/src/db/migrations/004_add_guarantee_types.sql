-- Novos campos: Garantia (dois eixos independentes e opcionais)
-- Garantia Real (bens/direitos): alienação fiduciária, hipoteca, penhor, cessão de recebíveis.
-- Garantia Pessoal/Fidejussória (pessoas): aval, fiança.
-- Contratos existentes ficam com ambos NULL ("Não informado") até serem editados.
ALTER TABLE loan_contracts
  ADD COLUMN IF NOT EXISTS guarantee_real_type TEXT,
  ADD COLUMN IF NOT EXISTS guarantee_personal_type TEXT;
