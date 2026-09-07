-- 051: primeiro acesso do usuário (onboarding por user) + documentos legais / LGPD

-- Estado de onboarding / tour por usuário (fonte oficial — não localStorage)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS first_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_shown_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_skipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_version TEXT;

-- Usuários que já acessaram o sistema não devem receber tour automático na implantação
UPDATE users
SET onboarding_shown_at = COALESCE(last_login_at, created_date, now()),
    onboarding_version = COALESCE(onboarding_version, '1.0')
WHERE onboarding_shown_at IS NULL
  AND (last_login_at IS NOT NULL OR created_date IS NOT NULL);

-- Catálogo versionado de documentos legais (global / plataforma)
CREATE TABLE IF NOT EXISTS legal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type TEXT NOT NULL
    CHECK (document_type IN ('PRIVACY_POLICY', 'TERMS_OF_USE', 'MARKETING_CONSENT')),
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_url TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  requires_acknowledgement BOOLEAN NOT NULL DEFAULT false,
  requires_acceptance BOOLEAN NOT NULL DEFAULT true,
  legal_basis TEXT NOT NULL DEFAULT 'CONSENT'
    CHECK (legal_basis IN ('CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST')),
  created_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_type, version)
);

CREATE INDEX IF NOT EXISTS idx_legal_documents_active
  ON legal_documents (document_type, is_active, effective_at DESC);

-- Histórico append-only de aceites / revogações (por usuário + tenant)
CREATE TABLE IF NOT EXISTS legal_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  group_id TEXT,
  user_id UUID NOT NULL REFERENCES users(id),
  document_type TEXT NOT NULL
    CHECK (document_type IN ('PRIVACY_POLICY', 'TERMS_OF_USE', 'MARKETING_CONSENT')),
  document_version TEXT NOT NULL,
  document_id UUID REFERENCES legal_documents(id),
  action TEXT NOT NULL
    CHECK (action IN ('ACCEPTED', 'REVOKED', 'ACKNOWLEDGED')),
  legal_basis TEXT
    CHECK (legal_basis IS NULL OR legal_basis IN ('CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST')),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user
  ON legal_acceptances (user_id, document_type, accepted_at DESC);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_tenant
  ON legal_acceptances (group_id, user_id, document_type);

-- Solicitações de direitos do titular (LGPD) — análise humana, sem exclusão automática
CREATE TABLE IF NOT EXISTS privacy_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  group_id TEXT,
  user_id UUID NOT NULL REFERENCES users(id),
  request_type TEXT NOT NULL
    CHECK (request_type IN (
      'ACCESS', 'CORRECTION', 'PORTABILITY', 'ERASURE', 'INFORMATION', 'OTHER'
    )),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_review', 'fulfilled', 'rejected', 'not_applicable')),
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_user
  ON privacy_requests (user_id, created_at DESC);

-- Seed documentos v1.0 (somente se ainda não existirem)
INSERT INTO legal_documents (
  document_type, version, title, content, is_active,
  requires_acknowledgement, requires_acceptance, legal_basis
)
SELECT
  'PRIVACY_POLICY',
  '1.0',
  'Política de Privacidade',
  $pp$
# Política de Privacidade — AllDebt

Esta Política descreve como o AllDebt trata dados pessoais no contexto da plataforma de gestão de endividamento e contratos financeiros.

## 1. Controlador e finalidade
O tratamento ocorre para prestar o serviço contratado pela empresa (tenant), com bases legais de execução de contrato, cumprimento de obrigação legal/regulatória e, quando aplicável, consentimento para finalidades opcionais.

## 2. Dados tratados
Podemos tratar dados cadastrais de usuários (nome, e-mail, cargo), dados de autenticação, logs de acesso e auditoria, além de dados operacionais inseridos pelo cliente no uso do sistema.

## 3. Compartilhamento
Dados podem ser compartilhados com prestadores essenciais à operação (hospedagem, e-mail transacional) e autoridades quando houver obrigação legal. Não vendemos dados pessoais.

## 4. Segurança
Adotamos controles de acesso, isolamento multi-tenant, criptografia em trânsito (HTTPS em produção) e trilha de auditoria append-only.

## 5. Direitos do titular
Você pode solicitar acesso, correção, portabilidade (quando aplicável), informação e, quando juridicamente possível, exclusão — observada retenção legal, regulatória e de auditoria.

## 6. Contato
Utilize a área Privacidade e Dados no AllDebt ou o canal indicado pelo administrador da sua empresa.
$pp$,
  true, true, false, 'CONTRACT'
WHERE NOT EXISTS (
  SELECT 1 FROM legal_documents WHERE document_type = 'PRIVACY_POLICY' AND version = '1.0'
);

INSERT INTO legal_documents (
  document_type, version, title, content, is_active,
  requires_acknowledgement, requires_acceptance, legal_basis
)
SELECT
  'TERMS_OF_USE',
  '1.0',
  'Termos de Uso',
  $tu$
# Termos de Uso — AllDebt

Ao utilizar o AllDebt, a empresa contratante e seus usuários autorizados concordam com estes Termos.

## 1. Objeto
O AllDebt é uma plataforma SaaS para simulação, gestão e acompanhamento de operações de crédito e endividamento.

## 2. Contas e responsabilidades
Cada usuário é responsável por manter credenciais em sigilo. O administrador do tenant gerencia acessos e permissões.

## 3. Uso adequado
É proibido uso ilícito, tentativa de acesso não autorizado, interferência na disponibilidade do serviço ou compartilhamento indevido de dados de terceiros.

## 4. Dados e retenção
Registros financeiros, contratos e eventos de auditoria podem ser retidos conforme obrigação legal, regulatória ou necessidade operacional legítima.

## 5. Disponibilidade e alterações
Podemos atualizar funcionalidades e estes Termos. Quando a nova versão exigir nova aceitação, o sistema solicitará manifestação antes do uso continuado.

## 6. Contato
Em caso de dúvidas, fale com o administrador da sua empresa ou utilize os canais de suporte do AllDebt.
$tu$,
  true, false, true, 'CONTRACT'
WHERE NOT EXISTS (
  SELECT 1 FROM legal_documents WHERE document_type = 'TERMS_OF_USE' AND version = '1.0'
);

INSERT INTO legal_documents (
  document_type, version, title, content, is_active,
  requires_acknowledgement, requires_acceptance, legal_basis
)
SELECT
  'MARKETING_CONSENT',
  '1.0',
  'Comunicações comerciais',
  $mk$
Consentimento opcional para receber comunicações comerciais, novidades e materiais sobre o AllDebt.
Você pode retirar este consentimento a qualquer momento em Privacidade e Dados.
$mk$,
  true, false, false, 'CONSENT'
WHERE NOT EXISTS (
  SELECT 1 FROM legal_documents WHERE document_type = 'MARKETING_CONSENT' AND version = '1.0'
);
