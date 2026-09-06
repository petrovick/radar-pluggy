## Context

Cada gateway de borda (`pluggy-investments.gateway.ts`, `pluggy-accounts.gateway.ts`,
`pluggy-account-transactions.gateway.ts`, `pluggy-loans.gateway.ts`, `pluggy-consents.gateway.ts`,
`pluggy-items.gateway.ts`) recebe o `raw: unknown` do `pluggy-sdk` e só repassa adiante o subconjunto de
campos que o próprio `toDto` lê explicitamente — qualquer campo que o SDK documenta e o `toDto` não lê é
descartado antes mesmo de chegar à entity. `load-pluggy-history.impl.ts#readCashSources` também filtra
`if (account.type !== 'BANK') continue`, então conta `CREDIT` nunca chega a ser salva nem tem extrato
buscado. Ver proposal.md para a motivação completa.

O banco é MySQL (`sequelize.config.cjs`), migrations via Sequelize, e o padrão "fotografia atual + snapshot
append-only numa tabela separada" já existe para posição (`pluggy_connector_positions` +
`pluggy_connector_position_snapshots`) e empréstimo (`pluggy_connector_loans` +
`pluggy_connector_loan_snapshots`). `Sequelize.JSON` já é o tipo usado para `merchant`/`payment_data` em
`pluggy_connector_account_transactions`.

## Goals / Non-Goals

**Goals:**
- Parar de descartar qualquer campo que os tipos do `pluggy-sdk` (`investment.d.ts`, `account.d.ts`,
  `transaction.d.ts`, `item.d.ts`, `loan.d.ts`, `consent.d.ts`) documentam, nos sete recursos sincronizados.
- Deixar conta `CREDIT` fluir pelo mesmo caminho de descoberta e scan de histórico que conta `BANK` hoje já
  usa.
- Persistir o JSON bruto de cada linha de recurso validada com sucesso, na mesma transação da linha
  correspondente na tabela principal, uma tabela por tipo de recurso.

**Non-Goals:**
- Definir a chave de idempotência/duplicidade das tabelas de negócio (`account_transactions`,
  `investment_transactions`) — investigação separada, já em andamento, não bloqueia esta change.
- Qualquer endpoint `GET` novo expondo este dado ao front — change separada.
- Menus novos no `oplab-radar-front` — repositório e change separados.
- Capturar o JSON bruto de uma linha que falha validação — decisão explícita: o insert do log acontece
  junto do insert principal, então falha de validação continua sem deixar rastro, como hoje.
- Compactar ou deduplicar o log bruto ao longo do tempo — fica para depois, se o disco virar problema real.

## Decisions

**1. Ponto de captura do log bruto = junto do insert principal, depois da validação já ter passado.**
Alternativa considerada: capturar antes da validação, pra também ter rastro da linha que falha. Rejeitada
por decisão explícita do usuário — hoje uma falha de validação já aborta a página inteira antes de qualquer
escrita (`pluggy-investments.gateway.ts#parseInvestmentsPage` lança no meio do `.map`), então capturar
"antes" exigiria um caminho de escrita à parte, fora da transação que já existe, por um caso que o usuário
decidiu não cobrir agora.

**2. Uma tabela de log por recurso, não uma tabela genérica com discriminador.**
Seguindo o padrão já estabelecido de fotografia+snapshot por recurso, em vez de introduzir um padrão novo.
Alternativa considerada (`pluggy_connector_raw_payloads` com coluna `resource_type`): menos migration, mas
foge da convenção de uma tabela por conceito já usada neste repositório, e deixa a coluna JSON com forma
diferente por linha dentro da mesma tabela.

**3. Sem chave única em nenhuma tabela de log.**
Só `id BIGINT UNSIGNED AUTO_INCREMENT` como chave primária, mais índice não-único em (`item_id`, id do
recurso) para consulta. Toda sincronização grava linha nova, mesmo idêntica à anterior. Impor unicidade
aqui exigiria decidir a chave de idempotência agora — questão em aberto, tratada à parte.

**4. Coluna do payload bruto: `JSON` nativo do MySQL**, mesmo tipo já usado em `merchant`/`payment_data`.

**5. Captura de campo no gateway estende o padrão já existente** (`optionalString`/`optionalDecimal`/
`optionalDate`/... em cada `*.gateway.ts`), em vez de trocar para um passthrough genérico. Mantém a
disciplina de "guard nomeia o campo" de `fronteira-pluggy` também para os campos novos, e cada entity
ganha os nomes novos no seu `ALLOWED_CREATE_FIELDS`.

**6. `readCashSources` perde o filtro `account.type !== 'BANK'`.** `BANK` e `CREDIT` viram
`HistorySource` do mesmo jeito; nenhuma mudança na paginação ou no scan de transação em si, que já é
agnóstico ao tipo de conta uma vez removido o filtro.

**7. Critério de refactor posicional → props-por-nome: "dois ou mais campos consecutivos do mesmo
tipo `Decimal`/`Record<string, unknown>[]`/`Record<string, unknown>` opcional".** Aplicado a
`PluggyPosition`, `PluggyLoan` e, por consistência, `PluggyAccountTransaction` (que já tinha
`merchant`/`paymentData` do mesmo tipo antes desta change, e ganhou um terceiro campo,
`creditCardMetadata`, agora). `PluggyConsent` também refatorado pela mesma razão
(`products`/`openFinancePermissionsGranted`, ambos `string[] | undefined`).

## Risks / Trade-offs

- [Risco] Linha que falha validação continua sem deixar rastro nenhum, nem no log bruto → Mitigação:
  nenhuma nesta change; trade-off aceito explicitamente. Revisitar se a investigação de confiabilidade de
  id (separada) mostrar que isso importa.
- [Risco] Tabela de log cresce rápido em recurso de alto churn — no dump de POC uma pessoa só tem 59
  investimentos ressincronizados a cada carga, e uma conta de cartão sozinha teve 608 transações →
  Mitigação: nenhuma agora (custo de disco aceito explicitamente); rotina de compactação fica como trabalho
  futuro se virar problema operacional real.
- [Risco] `taxNumber` grava CPF/CNPJ em repouso → Mitigação: nenhuma além do que já protege
  `radar_pluggy_credentials` (cifra de segredo); esta é uma categoria de dado sensível nova neste serviço e
  deveria receber o mesmo cuidado operacional (backup, acesso) que a tabela de credencial. Decisão explícita
  do usuário.
- [Risco] Reverter o corte documentado de `pluggy-loan` e a exclusão de `disaggregatedCreditLimits` muda o
  formato das linhas já em produção → Mitigação: mudança puramente aditiva (coluna/tabela nova, nula por
  padrão); linha existente continua funcionando, só a próxima sincronização preenche o campo novo. Sem
  backfill de histórico — a Pluggy não oferece replay desses recursos além do que uma ressincronização
  completa já cobre.
- [Risco] Parear log bruto com registro principal por linha, em `scanSource`, trocou um `saveMany` em lote
  por um laço de `save()` individual, cada um dentro do seu próprio `startProcess`/`terminateProcess` — um
  BEGIN/COMMIT por transação processada, não mais um por página. Uma conta de cartão sozinha já teve 608
  transações no dump de POC (~608 pares BEGIN/COMMIT numa única varredura) → Mitigação: nenhuma agora;
  `saveMany` nunca ofereceu atomicidade de lote (já fazia o mesmo loop internamente, sem transação própria),
  então não é regressão de garantia — é custo de latência/round-trip novo, aceito como parte do preço de ter
  o log bruto atômico por linha. Revisitar se o volume real tornar isso perceptível.

## Migration Plan

- Uma migration por tabela modificada (`pluggy_connector_positions`, `pluggy_connector_accounts`,
  `pluggy_connector_account_transactions`, `pluggy_connector_loans`, `pluggy_connector_consents`), mais uma
  migration por tabela de log nova (sete no total) — todas aditivas, todas reversíveis via `down` que
  remove a coluna/tabela.
- Sem backfill: linha histórica mantém o valor atual (possivelmente nulo) nas colunas novas; só a próxima
  sincronização preenche.
- Ordem de rollout: a captura de campo (gateway + entity + migration) de cada recurso é independente das
  outras — pode ir tudo num deploy só ou em deploys separados por recurso. A correção de `readCashSources`
  (BANK→BANK+CREDIT) não tem dependência de ordem com o resto; pode ir junto ou em separado.

## Open Questions

- Chave de idempotência/identidade de `pluggy_connector_account_transactions` e
  `pluggy_connector_investment_transactions` (se o `id` da Pluggy é estável numa transição
  PENDING→POSTED) — investigação separada já iniciada com o usuário; não muda nada desta change, porque a
  unique constraint `(item_id, account_id/investment_id, transaction_id)` de hoje permanece intocada aqui.
- Escala exata de coluna `DECIMAL` para os campos novos de Investment (`rate`, `fixedAnnualRate`,
  `lastMonthRate`, `annualRate`, `lastTwelveMonthsRate`, `amountProfit`, `amountWithdrawal`) — decidida na
  migration em tasks.md; a spec só exige conversão `Decimal` sem perda, não uma escala específica.
