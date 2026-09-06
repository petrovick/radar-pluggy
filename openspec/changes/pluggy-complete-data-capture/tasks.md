## 1. Migrations (aditivas, sem backfill)

- [x] 1.1 Migration adicionando a `pluggy_connector_positions` as colunas novas do `Investment`
  (`due_date`, `rate`, `rate_type`, `fixed_annual_rate`, `annual_rate`, `last_month_rate`,
  `last_twelve_months_rate`, `amount_profit`, `amount_withdrawal`, `issuer`, `issuer_cnpj`,
  `issue_date`, `purchase_date`, `number`, `owner`, `metadata` JSON) e verificar `up`/`down` local
- [x] 1.2 Migration adicionando a `pluggy_connector_accounts` as colunas `tax_number`, `bank_data`
  (JSON) e `disaggregated_credit_limits` (JSON), e verificar `up`/`down` local
- [x] 1.3 Migration adicionando `credit_card_metadata` (JSON) a
  `pluggy_connector_account_transactions`, e verificar `up`/`down` local
- [x] 1.4 Migration adicionando a `pluggy_connector_loans` as colunas do schema completo (`ipoc_code`,
  `disbursement_dates`, `first_installment_due_date`, `cet`, `installment_periodicity`,
  `installment_periodicity_additional_info`, `amortization_scheduled`,
  `amortization_scheduled_additional_info`, `cnpj_consignee`, `interest_rates`, `contracted_fees`,
  `contracted_finance_charges`, `warranties`, `installments`, `payments` — listas complexas como
  JSON), e verificar `up`/`down` local
- [x] 1.5 Migration adicionando `products` e `open_finance_permissions_granted` (JSON) a
  `pluggy_connector_consents`, e verificar `up`/`down` local
- [x] 1.6 Sete migrations criando as tabelas de log bruto (`pluggy_connector_item_raw`,
  `_consent_raw`, `_position_raw`, `_account_raw`, `_account_transaction_raw`,
  `_investment_transaction_raw`, `_loan_raw`), cada uma com `id` autoincrement, colunas de escopo
  (`item_id` + id do recurso), `raw_payload` JSON, `captured_at`, e índice não-único em
  (`item_id`, id do recurso) — verificar `up`/`down` local de cada uma

**Verificado:** cadeia completa (30 migrations) rodou limpa num banco descartável do zero; as 12
novas aplicaram e reverteram sem erro no banco de dev (`oplab_radar`).

**Verificado (checkpoint):** `npx tsc --noEmit` limpo; `npm test` — 551 passaram, 12 falharam, todas
as 12 em `pluggy-credential-item`/`pluggy-webhook` (schema pré-existente inconsistente em
`oplab_radar_test`, não relacionado a esta change — FK de `pluggy_connector_credential_items` aponta
pra tabela `pluggy_credentials` órfã).

## 2. Entities

- [x] 2.1 Estender `PluggyPosition` (`ALLOWED_CREATE_FIELDS`, construtor, getters) com os campos
  novos do Investment e testar campo opcional ausente/presente (spec `pluggy-position-sync`).
  Construtor refatorado de posicional para `props` por nome (mesmo padrão de `PluggyAccount`) —
  7 campos `Decimal | undefined` consecutivos tornavam a transposição um risco real.
- [x] 2.2 Estender `PluggyAccount` com `taxNumber`/`bankData`/`disaggregatedCreditLimits` e testar
  (spec `pluggy-account`)
- [x] 2.3 Estender `PluggyAccountTransaction` com `creditCardMetadata` e testar (spec
  `pluggy-transaction-history`). Construtor também refatorado de posicional para `props` por nome,
  por consistência com Position/Loan (`merchant`/`paymentData`/`creditCardMetadata`, mesmo tipo
  `Record<string, unknown> | undefined` — achado da revisão do `engenheiro-radar-pluggy`).
- [x] 2.4 Estender `PluggyLoan` com o schema completo, revertendo o corte hoje documentado, e testar
  (spec `pluggy-loan`). Construtor também refatorado de posicional para `props` por nome — 4 campos
  `Record<string, unknown>[] | undefined` consecutivos.
- [x] 2.5 Estender `PluggyConsent` com `products`/`openFinancePermissionsGranted` e testar (spec
  `pluggy-consent`). Também corrigido: `PluggyConsentStatus`/`readConsentStatus`/`saveConsentStatus`
  descartavam os dois campos no meio do fluxo de sync, entre a leitura e a gravação.
- [x] 2.6 Decidido: DTO simples (`Save*RawInput`), sem entity — log bruto não carrega invariante de
  negócio, só armazena o que chegou. `assertNoUnexpectedFields` não se aplica: o payload é livre por
  natureza.

## 3. Models e Repositórios

- [x] 3.1 Atualizar os models Sequelize de posição, conta, transação de conta, empréstimo e
  consentimento com as colunas novas
- [x] 3.2 Criar model + repositório para cada uma das sete tabelas de log bruto

## 4. Gateways (fronteira Pluggy)

- [x] 4.1 Estender `pluggy-investments.gateway.ts#toDto` para ler os campos novos do Investment,
  usando os helpers `optionalDecimal`/`optionalDate`/`optionalString` já existentes
- [x] 4.2 Estender `pluggy-accounts.gateway.ts#toDto` para ler `taxNumber`, `bankData` e
  `disaggregatedCreditLimits`
- [x] 4.3 Estender `pluggy-account-transactions.gateway.ts#toDto` para ler `creditCardMetadata`
- [x] 4.4 Estender `pluggy-loans.gateway.ts#toDto` para ler o schema completo de `Loan`
- [x] 4.5 Estender `pluggy-consents.gateway.ts#toDto` para ler `products` e
  `openFinancePermissionsGranted`
- [x] 4.6 Remover o filtro `account.type !== 'BANK'` de `readCashSources`
  (`load-pluggy-history.impl.ts`) e verificar que conta `CREDIT` passa a virar `HistorySource`

## 5. Persistência do log bruto junto do registro principal

- [x] 5.1 Repositório/gateway de posição passa a receber o `raw` e gravar fotografia + log bruto na
  mesma transação
- [x] 5.2 Idem para conta (`readCashSources`, mini-transação por conta)
- [x] 5.3 Idem para transação de conta (`scanSource`, mini-transação por transação — trocado
  `saveMany` por laço com `save()` individual para poder parear com o log bruto)
- [x] 5.4 Idem para empréstimo (fotografia + snapshot + log bruto, mesma transação)
- [x] 5.5 Idem para consentimento (`saveConsentStatus`, que não tinha transação própria antes —
  agora tem)
- [x] 5.6 Idem para item (`saveSyncedItemState`, idem — não tinha transação própria antes)
- [x] 5.7 Idem para transação de investimento (mesmo padrão de 5.3)

## 6. Testes

- [x] 6.1 Teste de gateway por recurso: campo novo lido corretamente do payload bruto; campo
  ausente/`null` não recusa a linha (cobre as cinco specs modificadas/novas de captura de campo)
- [x] 6.2 Teste de `readCashSources`: conta `CREDIT` aparece como `HistorySource` e tem extrato
  buscado, conta `BANK` continua funcionando como antes
- [x] 6.3 Teste de persistência do log bruto por recurso: sucesso grava as duas tabelas na mesma
  transação, e falha no log bruto desfaz o registro principal da mesma linha — coberto com
  transação MySQL real para os 7 recursos: posição, empréstimo (via rollback do snapshot, D11),
  conta (`readCashSources`), transação de conta e transação de investimento (`scanSource`, ambos os
  ramos), consentimento (`saveConsentStatus`) e item (`saveSyncedItemState`) — os dois últimos não
  tinham transação própria antes desta change; achado da revisão do `engenheiro-radar-pluggy` que a
  cobertura inicial só tinha os dois primeiros com teste de rollback real
- [x] 6.4 Teste confirmando que duas sincronizações sem mudança geram duas linhas no log bruto (sem
  deduplicação) — coberto para posição

## 7. Verificação

- [x] 7.1 Rodar `npm run lint` (inclui `tsc --noEmit`) e confirmar verde — 1 erro pré-existente e
  não relacionado, em `test-digest.js` (arquivo solto na raiz, não rastreado pelo git, fora do
  escopo desta change); zero erro em qualquer arquivo tocado por ela
- [x] 7.2 Rodar `npm test` e confirmar verde — 560/572 passaram; as 12 falhas restantes são
  pré-existentes, isoladas em `pluggy-credential-item`/`pluggy-webhook` (schema inconsistente em
  `oplab_radar_test`, não relacionado a esta change — ver nota no grupo 1)
- [x] 7.3 Rodar `openspec validate pluggy-complete-data-capture --strict` e confirmar sem erro
  bloqueante — 1 aviso cosmético pré-existente (RFC 2119, specs em português), sem erro
