# Conformidade ISO (software)

Este documento mapeia controles **implementados no código** às normas. Não é certificação.

| Norma | Controle no sistema |
| --- | --- |
| ISO/IEC 12207 | Ciclo: migração versionada, seed, health/ready, CI |
| ISO/IEC 25010 | Segurança (JWT, helmet, rate limit), manutenibilidade (módulos), confiabilidade (FK, ready) |
| ISO/IEC 27001 A.5 / A.8 / A.9 | Auth obrigatória, RBAC admin, senha bcrypt 12, segredos em env, audit_events append-only, X-Request-Id |
| ISO 9001 | Git + GitHub Actions + migrações rastreáveis |
| ISO 8601 | `TIMESTAMPTZ` / `DATE` |
| ISO 4217 | `CHAR(3)` com check `^[A-Z]{3}$` |
| ISO/IEC 60559 | `NUMERIC` no banco; HALF_EVEN no motor de cálculo (servidor) |
| ISO 31000 | Flags de risco no motor; log de acesso na API |

## Ainda não coberto (backlog de auditoria)

- Criptografia em trânsito (TLS no reverse proxy)
- Backup automatizado do Postgres
- Separação de deveres além de admin/user/viewer
- Testes automatizados amplos do motor no CI (há smoke PRICE)
- Política formal de retenção/exclusão (LGPD)
