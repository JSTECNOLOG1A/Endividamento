# T0 — Calendário de feriados (simulação, sem gravar em produção)

Verificado em 19/09/2026. A tabela `holidays` de produção tinha **0 registros**.

| Arquivo | Conteúdo |
|---|---|
| `feriados_nacionais_2020_2033.json` | Carga proposta: 178 feriados nacionais (formato do importador: `holiday_date`, `holiday_name`, `day_of_week`) |
| `feriados_validacao.json` | Comparação BrasilAPI × cálculo independente (Páscoa + datas fixas): 0 divergências |
| `resultado_simulacao.json` | Impacto nos 6 contratos de produção: reprodução do cronograma salvo (diferença 0,00) e parcelas que mudam de vencimento com a carga |
| `holidays_dataset.mjs` / `simulate.mjs` | Scripts que geram a carga e a simulação (a simulação roda no container da API, só leitura) |

## Resultado

- O motor reproduz exatamente o cronograma salvo dos 6 contratos (diferença de valor 0,00, datas iguais).
- Piloto (2915274241): só a parcela 30 muda, de 07/09/2026 (feriado) para **08/09/2026**. Valores e juros não mudam. Se os títulos dessa parcela já estiverem integrados ao ERP, o vencimento precisa ser corrigido lá.
- Demais contratos (rascunhos): parcelas com vencimento deslocado em 1 a 3 dias, sem alteração de juros; diferenças de centavos na última parcela em 3 contratos.
- Carga nacional apenas: feriados estaduais e municipais não estão incluídos.

## Como aplicar (depois de aprovado)

Cadastrar a carga pela tela de importação de feriados, por cliente; recalcular contratos e ajustar títulos já integrados ou pagos só depois de conferir a simulação. **Não aplicar em produção antes da aprovação.**
