# Decisões da implantação de saldos (registro)

Data: 19/09/2026. Complementa `PLANO-VIRADA-DE-SALDOS.md` (v9).

| Decisão | Resultado |
|---|---|
| D6 — quem contabiliza a baixa bancária | **Protheus** contabiliza a baixa bancária; o AllDebt contabiliza tudo o que é competência (abertura, juros, capitalização, reclassificação, variação cambial, custos) e **não exporta lançamento de pagamento**. Para o passivo baixar, os títulos gerados pelo AllDebt levam a conta contábil do passivo do AllDebt (parâmetros de conta dos títulos, em Configurações → Lógica Contábil) |
| D7 — início da baixa efetiva | **Uma data por cliente**, parâmetro `accounting.settlement_required_from` (AAAA-MM-DD; vazio = regra antiga). Parcelas anteriores não mudam; fechamentos aprovados nunca mudam. Valor sugerido para o Grupo Cangaia: 01/09/2026 (a definir na tela) |
| D8 — custo de transação | **Reconhecido no ato da operação**, cada verba na sua conta (IOF na conta do IOF; demais taxas na conta de custo de transação). Sem apropriação mensal. **Política única da ferramenta**, não por empresa |
| Piloto | Contrato 2915274241, Grupo Cangaia; o responsável do projeto assina a conciliação |

## O que foi implementado (T0 a T3)

- **T0** — carga de feriados nacionais 2020–2033 (178 datas, validada contra a BrasilAPI e contra cálculo independente) e simulação de impacto nos contratos de produção, **sem gravar nada** (`T0-calendario/`).
- **T1** — fechamento com juros por competência, liberação/IOF/custo na data da operação, evento de capitalização de juros, chaves de idempotência de evento (`accountingClosing.js` e `closingEngine.js`; teste: `npm run test:closing`).
- **T2** — regra de baixa efetiva por cliente; baixa manual em Contas a Pagar (parcial ou total); baixa manual entra nas baixas derivadas do fechamento automático.
- **T3** — marca de implantação por contrato, geração de títulos filtrada, retenção da integração automática, bloqueio de fechamento até a data de corte.

Nada disso muda o comportamento de contratos e clientes existentes até ser ativado: a regra de baixa depende do parâmetro (vazio por padrão) e a implantação depende da marca no contrato.

## Limitações conhecidas

- Contratos em moeda estrangeira: o saldo de principal do fechamento não incorpora a variação cambial acumulada (já era assim); o teste de saldo zerado no fim do contrato não cobre USD.
- Juros por competência usam rateio linear por dias corridos dentro de cada período do cronograma.
