## Why

O radar-pluggy sincroniza dados de Open Finance mas descarta, hoje, boa parte do que a Pluggy
realmente retorna: contas de cartão de crédito nunca chegam a ser gravadas (o gateway de histórico
pula qualquer conta que não seja `BANK`), campos inteiros de investimento, conta, transação,
empréstimo e consentimento são descartados na fronteira do gateway antes de chegar à entity, e não
existe registro algum do payload bruto — uma resposta rejeitada pela validação estrita hoje não
deixa nenhum rastro. Isso bloqueia dois objetivos concretos já decididos: mostrar ao titular a
carteira completa (renda fixa com vencimento e taxa, rentabilidade do investimento) e o extrato do
cartão (hoje sem dado nenhum, porque a conta nem é sincronizada), além de impedir auditar o que a
Pluggy realmente enviou quando algo precisar ser conferido depois.

## What Changes

- Conta de cartão de crédito (`CREDIT`) passa a ser fonte de caixa: `readCashSources`
  (`load-pluggy-history.impl.ts`) para de pular contas que não são `BANK`, então a conta de cartão
  passa a ser salva e suas transações entram no scan de histórico.
- Captura de campo completa nos gateways de borda, parando de descartar em silêncio o que a Pluggy
  já manda:
  - **Investment**: `dueDate`, `rate`, `rateType`, `fixedAnnualRate`, `annualRate`,
    `lastMonthRate`, `lastTwelveMonthsRate`, `amountProfit`, `amountWithdrawal`, `issuer`,
    `issuerCNPJ`, `issueDate`, `purchaseDate`, `number`, `owner`, `metadata`
    (`taxRegime`/`proposalNumber`/`processNumber`).
  - **Account**: `taxNumber` (CPF/CNPJ do titular), `bankData` inteiro (saldo disponível, cheque
    especial contratado/usado, `reservedBalances`), `disaggregatedCreditLimits` (reverte exclusão
    hoje documentada em `pluggy-accounts.gateway.ts`).
  - **AccountTransaction**: `creditCardMetadata` inteiro (parcelamento, `billId`,
    `billForecastDate`, tipo de tarifa).
  - **Loan**: schema completo do contrato — reverte o corte hoje documentado em `pluggy-loan.ts`
    (taxas de juros, garantias, parcelas detalhadas, liberações de pagamento).
  - **Consent**: `products` e `openFinancePermissionsGranted`, além de prazo/revogação já
    capturados.
- Novo log de auditoria: uma tabela por recurso (`pluggy_connector_*_raw`), gravando o JSON bruto
  exatamente como a Pluggy devolveu, inserido **junto** do registro na tabela principal, na mesma
  transação — depois da validação já ter passado. Sem chave única (é log, não identidade); falha de
  validação continua sem deixar rastro em nenhuma das duas tabelas, decisão explícita para manter o
  insert simples.
- **BREAKING**: nenhuma. É captura adicional de dado que hoje é descartado — nenhum contrato de
  leitura existente muda de forma incompatível.

## Capabilities

### New Capabilities
- `pluggy-loan`: captura integral do schema `Loan` da Pluggy — hoje nenhuma spec cobre este
  recurso, mesmo já existindo entity/gateway/migration.
- `pluggy-consent`: captura de `products`/`openFinancePermissionsGranted` além de prazo/revogação —
  mesma situação do `pluggy-loan`, sem spec hoje.
- `pluggy-raw-payload-audit`: log append-only do JSON bruto de cada recurso sincronizado, gravado
  junto e na mesma transação do registro principal, para auditoria futura.

### Modified Capabilities
- `pluggy-account`: captura de campo completa (`bankData`, `taxNumber`,
  `disaggregatedCreditLimits`).
- `pluggy-position-sync`: captura de campo completa do `Investment` (vencimento, taxa,
  rentabilidade, emissor, metadata fiscal).
- `pluggy-transaction-history`: conta `CREDIT` passa a ser fonte de caixa (hoje só `BANK`);
  `AccountTransaction` ganha `creditCardMetadata`.

## Impact

- Migrations novas: colunas em `pluggy_connector_positions`, `pluggy_connector_accounts`,
  `pluggy_connector_account_transactions`, `pluggy_connector_loans`, `pluggy_connector_consents`;
  sete tabelas novas de auditoria (`pluggy_connector_*_raw`, uma por recurso).
- Gateways afetados: `pluggy-investments.gateway.ts`, `pluggy-accounts.gateway.ts`,
  `pluggy-account-transactions.gateway.ts`, `pluggy-loans.gateway.ts`,
  `pluggy-consents.gateway.ts`, `load-pluggy-history.impl.ts` (`readCashSources`).
- Entities afetadas: `pluggy-position.ts`, `pluggy-account.ts`, `pluggy-account-transaction.ts`,
  `pluggy-loan.ts`, `pluggy-consent.ts`.
- Repositórios ganham escrita da linha bruta correspondente, na mesma transação do registro
  principal.
- Fora de escopo desta change: os endpoints `GET` de leitura para o front (`/portfolio`,
  `/accounts`, `/accounts/:id/transactions`) e os menus novos do `oplab-radar-front` — dependem
  deste dado estar completo primeiro; ficam em change(s) separada(s), em cada repositório.
- `taxNumber` guarda CPF/CNPJ do titular em repouso — decisão explícita do usuário. Registrado aqui
  porque toca o mesmo tipo de dado sensível que a regra 5 de `fronteira-pluggy` trata com cautela
  (ainda que aquela regra seja sobre o produto `IDENTITY`, não sobre este campo do endpoint
  `/accounts`).
