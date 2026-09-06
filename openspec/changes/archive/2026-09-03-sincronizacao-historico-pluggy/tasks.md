As fases de descoberta/posição, dados históricos e webhook podem virar PRs separados, nesta ordem: a carga
manual completa valida banco e paginação; o webhook só passa a dispará-la depois. Todas as tasks preservam a
direção de `arquitetura-camadas`: entidade e invariante antes do interactor, interfaces no interactor,
adapters implementando-as.

## 1. Descoberta e fotografia de posição

- [x] 1.1 Alterar `PluggyInvestmentsGateway` para devolver páginas de `GET /investments?itemId=X` com
      `page`, `pageSize` e `totalPages` validados; o interactor de posição percorre todas as páginas, em vez
      de assumir que a primeira contém a carteira inteira. Cobrir lista com mais de uma página, metadado de
      paginação inválido, página retornada diferente da requisitada, `totalPages` mudando durante o laço e
      item sem mudança (zero chamadas de investimento).
- [x] 1.2 Migration nova para `pluggy_connector_positions`: `quantity` e `value` `DECIMAL(20,8)`; `balance`,
      `amount_original`, `amount`, `taxes`, `taxes2` `DECIMAL(20,2)`; novas colunas nullable para os quatro
      últimos campos. Nunca editar a migration já aplicada. O `down` restaura os tipos/colunas anteriores
      sem apagar índice único.
- [x] 1.3 Atualizar gateway, `PluggyPosition`, model e repositório para `value`, `amount`, `taxes`, `taxes2`
      e para as precisões novas. Atualizar explicitamente `ALLOWED_CREATE_FIELDS`. Testar round-trip de
      `value` com 8 casas e o cenário de campo opcional ausente.
- [x] 1.4 Migration `pluggy_connector_position_snapshots` (design.md D11): PK própria `id`, `item_id`,
      `investment_id`, `quota_date DATETIME(3)`, `balance DECIMAL(20,2)`, `quantity DECIMAL(20,8)` nullable,
      `value DECIMAL(20,8)` nullable, `amount DECIMAL(20,2)` nullable, `amount_original DECIMAL(20,2)`
      nullable, `taxes DECIMAL(20,2)` nullable, `taxes2 DECIMAL(20,2)` nullable, `currency_code`,
      `synced_at DATETIME(3)`, `created_at DATETIME(3)`. Único (`item_id`, `investment_id`, `quota_date`) com
      nome `uq_pluggy_connector_position_snapshots_item_investment_date`; índice (`item_id`, `quota_date`) com
      nome `idx_pluggy_connector_position_snapshots_item_date`. Sem FK física. `down` remove os índices e
      então a tabela. Entity forte `PluggyPositionSnapshot`, model e repositório com upsert nessa mesma
      constraint — nunca `INSERT` simples, `quota_date` repetida atualiza a linha em vez de duplicar.
      `SyncPluggyPositionInteractor` grava a fotografia e o snapshot na mesma transação de banco; se o
      snapshot falhar, a fotografia não avança. Testar: primeira sincronização do dia cria snapshot; segunda
      sincronização da mesma `quota_date` atualiza sem duplicar; `quota_date` diferente cria linha nova sem
      apagar a anterior; falha ao gravar snapshot também desfaz a fotografia da mesma sincronização.

## 2. Contas de depósito (`pluggy_connector_accounts`)

- [x] 2.1 Migration `pluggy_connector_accounts`: PK própria `id`, `item_id`, `account_id`, `type`, `subtype`,
      `number`, `name`, `marketing_name` nullable, `balance DECIMAL(20,2)`, `currency_code`, `owner`
      nullable, `provider_created_at DATETIME(3)`, `provider_updated_at DATETIME(3)`, `created_at DATETIME(3)`,
      `updated_at DATETIME(3)`; único (`item_id`, `account_id`) com nome
      `uq_pluggy_connector_accounts_item_account`. Nas migrations/models, isto é `Sequelize.DATE(3)`. Sem FK física.
      O `down` remove `uq_pluggy_connector_accounts_item_account` e então a tabela.
- [x] 2.2 Entity `PluggyAccount` forte e model/repositório com upsert. Os obrigatórios são `itemId`,
      `accountId`, `type`, `subtype`, `number`, `name`, `balance`, `currencyCode` e timestamps do provedor.
      Testar obrigatório ausente, Decimal exato, upsert e conta ausente em redescoberta permanecendo gravada.
- [x] 2.3 `PluggyAccountsGateway` devolve uma página de `GET /accounts` e valida `results`, página e total.
      O interactor percorre todas as páginas, converte dinheiro na fronteira e aceita somente `type=BANK`.
      Testes cobrem múltiplas páginas, página retornada diferente da requisitada, `totalPages` mutável,
      cartão ignorado, tipo inválido, campo obrigatório ausente e timeout.

## 3. Extrato de conta (`pluggy_connector_account_transactions`)

- [x] 3.1 Migration: PK própria `id`, `item_id`, `account_id`, `transaction_id`, `description`,
      `description_raw` nullable, `currency_code`, `amount DECIMAL(20,2)`,
      `amount_in_account_currency DECIMAL(20,2)` nullable, `balance DECIMAL(20,2)` nullable, `date DATETIME(3)`,
      `transaction_type`, `status`, `category_id` nullable, `category` nullable, `operation_type` nullable,
      `operation_type_additional_info` nullable, `provider_code` nullable, `provider_id` nullable,
      `source_order` nullable, `merchant JSON` nullable, `payment_data JSON` nullable,
      `provider_created_at DATETIME(3)`, `provider_updated_at DATETIME(3)`, `created_at DATETIME(3)`, `updated_at DATETIME(3)`.
      Único (`item_id`, `account_id`, `transaction_id`) com nome
      `uq_pluggy_connector_account_transactions_item_account_tx`; índice (`item_id`, `account_id`, `date`)
      com nome `idx_pluggy_connector_account_transactions_item_account_date`. O `down` remove ambos os índices e então
      a tabela.
- [x] 3.2 Entity e repository com upsert. `id`, `accountId`, `description`, `currencyCode`, `amount`, `date`,
      `type`, `status`, `createdAt` e `updatedAt` são obrigatórios; os demais são opcionais. Testar
      `PENDING` → `POSTED`, transação sem balance, timestamps com milissegundos, recarga sem duplicar e
      ausência numa resposta sem remoção local.
- [x] 3.3 `PluggyAccountTransactionsGateway` devolve uma página por chamada de `GET /v2/transactions`.
      Aceita somente um `next` relativo de `/v2/transactions`, detecta cursor repetido no interactor e não
      segue URL arbitrária. Testar página única, múltiplas páginas, cursor inválido/repetido, campo com tipo
      errado e timeout.

## 4. Movimentação de investimento (`pluggy_connector_investment_transactions`)

- [x] 4.1 Migration: PK própria `id`, `item_id`, `investment_id`, `transaction_id`, `type`,
      `movement_type` nullable, `quantity DECIMAL(20,8)` nullable, `value DECIMAL(20,8)` nullable,
      `amount DECIMAL(20,2)` nullable, `net_amount DECIMAL(20,2)` nullable,
      `price_factor DECIMAL(20,8)` nullable, `indexer_percentage DECIMAL(20,8)` nullable,
      `agreed_rate DECIMAL(20,8)` nullable, `date DATETIME(3)`, `trade_date DATETIME(3)` nullable,
      `description` nullable, `brokerage_number` nullable, as 13 despesas `DECIMAL(20,2)` nullable:
      `service_tax`, `brokerage_fee`, `income_tax`, `trading_assets_notice_fee`, `maintenance_fee`,
      `settlement_fee`, `clearing_fee`, `stock_exchange_fee`, `custody_fee`, `operating_fee`, `other`, `iof`,
      `iof_provision`; `created_at DATETIME(3)`, `updated_at DATETIME(3)`. Único
      (`item_id`, `investment_id`, `transaction_id`) com nome
      `uq_pluggy_connector_inv_transactions_item_inv_tx`; índice
      (`item_id`, `investment_id`, `date`) com nome `idx_pluggy_connector_inv_transactions_item_inv_date`.
      O `down` remove ambos os índices e então a tabela.
- [x] 4.2 Entity, model e repository com upsert. Só `id`, `type` e `date` são obrigatórios; `type` aceita o
      conjunto documentado (BUY, SELL, TAX, TRANSFER, INTEREST, AMORTIZATION). Testar opcional ausente,
      tipo desconhecido, `value`/`quantity` com oito casas e despesas parciais/ausentes.
- [x] 4.3 `PluggyInvestmentTransactionsGateway` devolve uma página de
      `GET /investments/{id}/transactions`, com `page`/`totalPages` coerentes e `Decimal` para todo número.
      O interactor pagina até o fim. Testar página única, múltiplas páginas, total inválido, timeout e
      campos malformados.

## 5. Observação de histórico (`pluggy_connector_history_coverage`)

- [x] 5.1 Migration: PK própria, `item_id`, `reference_id`, `reference_type` (`ACCOUNT`/`INVESTMENT`),
      `oldest_observed_transaction_at DATETIME(3)` nullable, `newest_observed_transaction_at DATETIME(3)` nullable,
      `observed_transaction_count INTEGER.UNSIGNED NOT NULL`, `source_updated_at DATETIME(3)` nullable,
      `last_completed_scan_at DATETIME(3) NOT NULL`, timestamps locais; único
      (`item_id`, `reference_type`, `reference_id`) com nome `uq_pluggy_connector_history_coverage_item_reference`.
      Sem FK física. O `down` remove esse índice e então a tabela.
- [x] 5.2 Entity forte, model e repository por upsert. Uma varredura terminada sem registros guarda contagem
      zero e datas nulas; isso não é “período coberto”. Falha no meio mantém a conclusão anterior intacta.
      Testar ambos os casos e a atualização de `source_updated_at` apenas após sucesso.
- [x] 5.3 Migration, entity, model e repository `pluggy_connector_history_sync_states`: uma linha por `item_id`, com
      `last_completed_item_updated_at DATETIME(3)` e timestamps. É a marca d'água exclusiva do histórico;
      não ler nem escrever `pluggy_connector_items.last_updated_at`. Testar posição e histórico no mesmo item, em ambas
      as ordens, e falha de um sem bloquear a próxima tentativa do outro.

## 6. Carga inicial e incremental

> **Forma obrigatória das seções 6 e 7** (`arquitetura-camadas`, regra 2 — reescrita depois das seções
> 1 a 5): construtor de interactor recebe **só** `params: AppContainer` e resolve **um** gateway
> (`LoadPluggyHistoryGateway` em `load-pluggy-history.types.ts`, estendendo `DefaultGateway`);
> `execute` devolve `{data, error}` e nunca deixa escapar `throw`; credencial, `POST /auth`, api key e
> transação ficam **dentro** do impl (`adapters/gateways/pluggy-history/load-pluggy-history.impl.ts`,
> herdando `DefaultInteractorGatewayImpl`); método de gateway fala a língua do produto, sem `apiKey`
> na assinatura. O fluxo de posição já está nessa forma — use-o como referência.

- [x] 6.1 `LoadPluggyHistoryInteractor`: relê o estado atual do item (incluindo avisos por produto),
      aplica os três estados de produto (sucesso, parcial utilizável, parcial limitado), descobre
      contas/investimentos com paginação completa e, na primeira carga, varre cada fonte elegível por
      inteiro. Persiste cada página imediatamente e conclui a observação somente depois da última
      página. Autenticação e resolução de credencial **não aparecem no caso de uso** — são do impl.
      Os gateways de borda já entregam página a página por gerador (`fetchAccountPages`,
      `fetchTransactionPages`), que é o que permite persistir cada página na hora.
- [x] 6.2 Para carga posterior, usar somente `pluggy_connector_history_sync_states.last_completed_item_updated_at` e
      `updatedAt` de cada conta/investimento contra `source_updated_at`; dia sem mudança faz zero chamadas de
      transação. Recurso sem qualquer um desses timestamps é varrido integralmente. Cobrir estado parcial
      utilizável e limitado, investimentos sem movimentações, recursos inalterados, timestamps ausentes,
      múltiplas páginas, mudança de `totalPages`, accountId divergente da conta consultada, falha intermediária
      e rate limit por produto. Avançar a watermark exclusiva somente após todas as fontes elegíveis terem
      concluído; testar que falha em uma fonte não a avança.
- [x] 6.3 Expor rota manual autenticada apenas para carga inicial/recuperação por decisão explícita do titular;
      ela não chama `PATCH /items`, não recebe pessoa no corpo e retorna a fronteira de erro `{errorType,
      extras}`. Cobrir handler em sucesso, recusa nomeada e erro inesperado.

## 7. Webhook Pluggy no `pluggy-connector`

- [x] 7.1 Alterar `pluggy_connector_credentials` em migration nova para `webhook_secret` cifrado, `webhook_id`,
      `webhook_url` e `webhook_event` nullable, e ampliar o cadastro para gerar/rotacionar esse segredo por
      credencial. Criar `PluggyWebhooksGateway` para `POST /webhooks` inicial com `event: all` e
      `PATCH /webhooks/{webhook_id}` em rotação; persistir URL/evento efetivamente provisionados e nunca
      reutilizar `client_secret`. Testar cifra, rotação sem criar segundo webhook, URL ausente/não HTTPS e
      falha de provisionamento.
- [x] 7.2 Criar inbox própria `pluggy_connector_webhook_events`: `event_id` único, `item_id`, evento, estado
      `PENDING`/`PROCESSING`/`SUCCEEDED`, lease, contador/timestamp de tentativa e erro resumido. Implementar
      insert-or-claim atômico e serialização por item; falha ou lease vencido devolve trabalho a `PENDING`.
      Testar duas entregas iguais, eventos distintos do mesmo item, crash após claim e retry após falha.
- [x] 7.3 Handler: resolve apenas vínculo item-credencial já persistido, compara `webhook_secret` em tempo
      constante, persiste/agenda inbox e responde 2xx antes de 5 segundos. O worker iniciado após a resposta,
      no boot e pela rota manual drena `PENDING`, relê o item e chama posição/histórico em
      `item/created`/`item/updated`; nunca usa payload como dado. Testar assinatura inválida, item
      desconhecido, resposta rápida, evento repetido, recuperação no boot e evento não aplicável.
- [x] 7.4 Registrar handler, worker e dependências no composition root. Não criar cron, poller ou rota no
      `oplab-radar-api`. Expor operação autenticada e explícita de reconciliação para provisionar ou corrigir
      webhooks de credenciais já existentes; ela é idempotente e não roda por cron. Testar backfill sem
      `webhook_id`, webhook remoto já configurado e recuperação de falha de provisionamento.

## Configuração exigida pelo deploy

- [x] `PLUGGY_WEBHOOK_URL` — URL HTTPS pública deste serviço para o webhook (ex.:
      `https://<host>/webhooks/pluggy`). Sem ela a reconciliação recusa com
      `PLUGGY_WEBHOOK_URL_MISSING`; a Pluggy exige HTTPS e host público resolvível, e recusa IP
      literal, `localhost` e nome reservado. Não é segredo: o segredo é por credencial, cifrado.
- [x] `PLUGGY_CREDENTIAL_ENCRYPTION_KEY` — 32 bytes em base64, já exigida antes desta change; agora
      cifra também o `webhook_secret`.

## 8. Verificação

- [x] 8.1 Rodar `openspec validate sincronizacao-historico-pluggy --strict`, `npm run lint`,
      `npm run type-check` e `npm test`; registrar resultados neste arquivo.
      **Resultado (2026-09-03):** `openspec validate --strict` verde; `npm run lint` sem erro;
      `npm run type-check` sem erro; `npm test` 299 testes em 57 arquivos, todos verdes. Cadeia de
      migrations aplicada e revertida em sequência (`db:migrate` → `db:migrate:undo` → `db:migrate`).
- [x] 8.2 Acionar `arquiteto-pluggy-connector` e `engenheiro-pluggy-connector` com diff, arquivos e
      verificações; registrar cada achado e sua resolução antes de aplicar a change.
      **Achados e resolução (2026-09-03), sobre `81999c4..HEAD`:**
      1. *(arquiteto, bloqueante)* `ProcessPluggyWebhookEventInteractor` tinha três colaboradores no
         construtor, violando a regra 2.1, com uma exceção "2.3.3" citada em comentário que não
         existia na skill. **Resolvido:** o interactor, seus types e seu impl foram removidos, e a
         orquestração foi para `infra/webhook-drainer.ts` — o dono que a própria 7.3 já indicava
         ("o worker ... relê o item e chama posição/histórico"). A lição virou a regra 2.3.1.1 da
         skill, inclusive a parte de processo: exceção não se autoconcede no ponto de uso.
      2. *(engenheiro, bloqueante)* `credential.getId() ?? 0` em `reconcile-pluggy-webhook.impl.ts`
         mascarava invariante com valor fabricado. **Resolvido:** trocado por `requireId()`.
      3. *(engenheiro, bloqueante)* `reclaimExpiredLeases` podia devolver à fila evento cujo worker
         ainda estava vivo, e `markSucceeded`/`releaseToPending` não verificavam posse do lease —
         dois workers sobrescreveriam o estado um do outro em silêncio. **Resolvido:** o claim passou
         a devolver um `leaseToken`, e as duas escritas de conclusão o exigem no `WHERE`, devolvendo
         `false` para quem perdeu o lease. Coberto por teste próprio contra MySQL.
      4. *(engenheiro, bloqueante)* Faltavam testes de `ReconcilePluggyWebhookImpl.provisionWebhook`
         (decisão create-vs-update) e de `reconcile-pluggy-webhook.handler.ts`. **Resolvido:** os dois
         existem, mais o teste do `webhook-drainer` que passou a ser o dono da orquestração.
      **Aprovados sem ajuste:** comparação em tempo constante do segredo; convergência da recusa entre
      assinatura inválida e item desconhecido; atomicidade do claim; falha do próprio
      `releaseToPending` (recuperada pelo lease, mesmo mecanismo do crash); ordem da validação de
      `accountId` antes de gravar; `summarize` com página vazia; ausência de retry customizado;
      fronteira decimal e ausência de default para campo obrigatório.
