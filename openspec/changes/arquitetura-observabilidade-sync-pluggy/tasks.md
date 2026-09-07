## 1. Catálogo central de tradução de fontes (D32)

- [x] 1.1 `adapters/gateways/pluggy-source-catalog.ts`: tabela única `ProductType` (SDK, ex.
      `INVESTMENTS_TRANSACTIONS`) ↔ chave de `statusDetail` (ex. `investmentTransactions`) ↔
      `PluggySource` de domínio (ex. `INVESTMENT_TRANSACTIONS`) para as cinco fontes; funções
      `sourceFromProductType`, `sourceFromStatusDetailKey`, `statusDetailKeyFromSource`,
      `productTypeFromSource`; verificar com teste de tabela cobrindo as cinco linhas nos dois
      sentidos, incluindo os nomes que não coincidem entre si (`INVESTMENTS_TRANSACTIONS` vs.
      `investmentTransactions` vs. `INVESTMENT_TRANSACTIONS`)

## 2. Correções de shape contra o SDK/documentação (D6, D7, D26, D27 — bloqueiam os grupos 4, 6 e 9)

- [x] 2.1 `PluggyItemsGateway`: corrigir a chave de `statusDetail` de `investmentsTransactions` para
      `investmentTransactions` e adicionar `'loans'` a `PRODUCT_KEYS`/`PluggyProductKey` (usando o
      catálogo de 1.1); verificar com teste que um payload real de
      `statusDetail.investmentTransactions`/`statusDetail.loans` é parseado
- [x] 2.2 `PluggyItem.VALID_STATUSES`: adicionar `WAITING_USER_ACTION` e `MERGING`; verificar com
      teste que `PluggyItem.create`/`reconstitute` aceitam os dois novos valores sem lançar
- [x] 2.3 Extrair `toSourceState`/`isUsable` (baseado em `isUpdated`, não em código de `warning`,
      nome de domínio próprio — D6, nunca `limitedByRateLimit`) para um módulo compartilhado
      (`adapters/gateways/pluggy-source-state.ts`); verificar com teste de tabela que
      `isUpdated !== true` em `PARTIAL_SUCCESS` recusa a fonte e `isUpdated === true` a libera
- [x] 2.4 `PluggyItemsGateway.parseItem`: parsear `data.products` (campo `products` do payload bruto
      — não tipado em `Item` no `.d.ts` do SDK instalado, confirmado no OpenAPI/documentação atual)
      como `itemProducts: string[] | undefined` — `undefined` (`UNKNOWN`) quando ausente ou não for
      array de strings reconhecíveis, nunca `[]` nesse caso nem inferido de `connectorProducts`;
      verificar com teste que um payload com `products` parseia a lista, e teste que payload sem
      `products` reconhecível resulta em `itemProducts` `undefined`, nunca `[]`
- [x] 2.5 `PluggyItemsGateway.parseItem`: parsear `data.updatedAt` como campo obrigatório (SDK:
      `updatedAt: Date`, não-nullable) — recusa nomeada (`PLUGGY_ITEMS_RESPONSE_INVALID`) se ausente
      ou malformado, mesmo padrão defensivo dos demais campos; verificar com teste
- [x] 2.6 `toVersionAt(item)` (usa 1.1/2.3): `Item.lastUpdatedAt ?? Item.updatedAt` quando
      `executionStatus === 'SUCCESS'`; `statusDetail.<fonte>.lastUpdatedAt` quando
      `PARTIAL_SUCCESS` e `isUsable`; recusa nomeada
      (`PLUGGY_ITEM_PRODUCT_UPDATED_WITHOUT_LAST_UPDATED_AT`) quando `PARTIAL_SUCCESS` +
      `isUpdated === true` + `lastUpdatedAt` ausente — nunca inventa valor nesse caso; verificar com
      teste de tabela cobrindo os quatro casos (cenários da spec `pluggy-sync-progress`, "SUCCESS
      sem lastUpdatedAt usa Item.updatedAt como versão; PARTIAL_SUCCESS inconsistente recusa
      nomeado")
- [x] 2.7 `LoadPluggyHistoryImpl`: trocar a derivação local de `limitedByRateLimit` pela função
      compartilhada de 2.3 (renomear o campo de domínio para `isUsable` em todo o arquivo); verificar
      que a suíte de testes existente de `load-pluggy-history.interactor.test.ts` continua verde
      após ajustar os fixtures

## 3. Escrita atômica de marca d'água (D17 — corrige código já em `staging`, entra antes da reescrita dos interactors)

- [x] 3.1 `PluggyItemRep.save`: trocar `row.update(...)` incondicional por `UPDATE ... WHERE item_id
      = ? AND (last_updated_at IS NULL OR last_updated_at < ?)`; zero linhas afetadas é no-op, nunca
      erro; verificar com teste concorrente representativo (dois `save` disparados antes de aguardar
      qualquer um, versões diferentes) que a versão mais nova sempre prevalece, independente da
      ordem de conclusão
- [x] 3.2 `PluggyHistoryCoverageRep.save`: mesma troca, condição por `last_completed_scan_at`/
      `source_updated_at`; verificar com teste concorrente equivalente

## 4. Marca d'água por consumidor e por fonte real, com dependência e elegibilidade por itemProducts (D4, D5, D12, D13, D26)

- [x] 4.1 Migration: criar `radar_pluggy_sync_progress` (`item_id`, `consumer` — valores
      `POSITION_SYNC`, `HISTORY_LOAD` —, `source` — valores `ACCOUNTS`, `ACCOUNT_TRANSACTIONS`,
      `INVESTMENTS`, `INVESTMENT_TRANSACTIONS`, `LOANS` —, `last_completed_version_at`, índice único
      `(item_id, consumer, source)`) e remover `radar_pluggy_history_sync_states` na mesma migration;
      verificar com `npm run migrate` limpo em banco vazio
- [x] 4.2 Entity `PluggySyncProgress` (create/reconstitute, avanço sem regressão) e
      `PluggySyncProgressRep` (`read(itemId, consumer, source)`, `advance(itemId, consumer, source,
      versionAt)` com escrita atômica — mesmo padrão de 3.1); verificar com teste de contrato
      modelo↔migration, teste de recusa de regressão e teste concorrente
- [x] 4.3 Gate de elegibilidade por fonte: `enabledForItem` (de `itemProducts`, 2.4) MUST ser
      verdadeiro antes de qualquer outra checagem — `enabledForItem === false` ou `UNKNOWN` nunca é
      elegível, mesmo sem marca d'água prévia; módulo compartilhado por `SyncPluggyPositionImpl` e
      `LoadPluggyHistoryImpl`; verificar com os cenários da spec `pluggy-sync-progress` ("Fonte não
      habilitada para o Item nunca é elegível")
- [x] 4.4 `LoadPluggyHistoryImpl`/`Interactor`: portão passa de `radar_pluggy_history_sync_states`
      (item-level) para `PluggySyncProgressRep` com `consumer = HISTORY_LOAD`, sob o gate de 4.3 —
      `CASH` elegível quando `(HISTORY_LOAD, ACCOUNTS)` ou `(HISTORY_LOAD, ACCOUNT_TRANSACTIONS)`
      estiver desatualizada; `CUSTODY`, quando `(HISTORY_LOAD, INVESTMENTS)` ou `(HISTORY_LOAD,
      INVESTMENT_TRANSACTIONS)` estiver desatualizada; verificar com os cenários da spec
      `pluggy-transaction-history`
- [x] 4.5 `LoadPluggyHistoryImpl`/`Interactor`: `ACCOUNT_TRANSACTIONS` só avança (D13) quando a
      coleta de transações **e** `ACCOUNTS` estiverem utilizáveis na mesma execução; mesma regra
      para `INVESTMENT_TRANSACTIONS`/`INVESTMENTS`; `ACCOUNTS`/`INVESTMENTS` avançam sozinhas;
      verificar com os cenários da spec `pluggy-transaction-history` ("Fonte de transação depende de
      sua fonte de descoberta")
- [x] 4.6 `LoadPluggyHistoryImpl`: varredura de transações deixa de filtrar por
      `Account.providerUpdatedAt`/`Investment.updatedAt` (D14) — quando `ACCOUNT_TRANSACTIONS`/
      `INVESTMENT_TRANSACTIONS` está elegível, varre transações de todas as contas/investimentos que
      a listagem atual trouxe; verificar com teste que uma conta com `updatedAt` inalterado ainda
      tem suas transações varridas
- [x] 4.7 `SyncPluggyPositionImpl`/`Interactor`: aceitar `executionStatus` `SUCCESS` ou
      `PARTIAL_SUCCESS`; processar `investments`/`loans` de forma independente sob o gate de 4.3,
      avançando `(POSITION_SYNC, INVESTMENTS)`/`(POSITION_SYNC, LOANS)` via `PluggySyncProgressRep`
      com a versão de 2.6 — linhas próprias deste consumidor, nunca as de `HISTORY_LOAD` para
      `INVESTMENTS`; verificar com os cenários da spec `pluggy-position-sync` e um teste específico
      de que `SyncPluggyPositionImpl` avançar `(POSITION_SYNC, INVESTMENTS)` não altera
      `(HISTORY_LOAD, INVESTMENTS)`
- [x] 4.8 `radar_pluggy_items.last_updated_at`: confirmar (teste de regressão) que só avança quando
      `executionStatus === 'SUCCESS'`, nunca em `PARTIAL_SUCCESS`, mesmo com fonte processada

## 5. Reconciliação de fotografia e semântica de lista vazia (D21 — corrige código já em `staging`)

- [x] 5.1 `SyncPluggyPositionInteractor.execute`: remover a recusa incondicional de lista vazia de
      investimentos (`PLUGGY_INVESTMENTS_EMPTY_WITH_SUCCESS_STATUS`) — consentimento já é verificado
      antes; lista vazia de uma fonte utilizável passa a ser autoritativa; verificar com o cenário
      "Lista vazia autoritativa reconcilia como portfólio vazio" da spec `pluggy-position-sync`
- [x] 5.2 `savePositionsWithSnapshots`/`saveLoansWithSnapshots`
      (`sync-pluggy-position.impl.ts`): depois do upsert de cada item presente, remover (ou marcar
      como não-corrente) da fotografia atual (`PluggyPositionRep`/`PluggyLoanRep`) todo registro
      daquele Item cujo identificador natural não veio na leitura autoritativa desta execução — só
      quando a fonte for `isUsable`; mesma transação dos upserts; verificar com os cenários da spec
      `pluggy-position-sync` (investimento que sumiu, fonte recusada não reconcilia, primeira carga
      vazia)
- [x] 5.3 `LoadPluggyHistoryImpl.readCashSources`: mesma reconciliação para `PluggyAccountRep`,
      condicionada a `ACCOUNTS` ser `isUsable` nesta execução; verificar com os cenários da spec
      `pluggy-transaction-history` ("Leitura autoritativa de contas reconcilia a fotografia atual")
- [x] 5.4 Confirmar que `PluggyPositionSnapshotRep`/`PluggyPositionRawRep`/equivalentes de
      loan/account **não** são tocados pela reconciliação — teste explícito

## 6. Eventos de webhook: categorização e item terminal (D28, D29)

- [x] 6.1 `PluggyWebhookEvent`: trocar `isApplicable(): boolean` por `categorize(): 'FULL_INGESTION' |
      'OBSERVATION_REFRESH' | 'TERMINAL' | 'IGNORED'` — `item/created`/`item/updated` →
      `FULL_INGESTION`; `item/error`/`item/waiting_user_input`/`item/waiting_user_action`/
      `item/login_succeeded` → `OBSERVATION_REFRESH`; `item/deleted` → `TERMINAL`;
      `connector/status_updated` e demais → `IGNORED` (decisão deliberada, documentada no
      comentário); verificar com teste de tabela cobrindo as quatro categorias
- [x] 6.2 Migration: `radar_pluggy_credential_items.inactive_at` (nullable); verificar com
      `npm run migrate` limpo
- [x] 6.3 `webhook-drainer.ts`: para `FULL_INGESTION`, fluxo atual (seção 7); para
      `OBSERVATION_REFRESH`, chamar só `PluggyItemStateResolver.read(itemId)` (sem lease, sem
      Position/History) e marcar o evento concluído; para `TERMINAL`, marcar
      `radar_pluggy_credential_items.inactive_at = now()` **sem** chamar `fetchItem`, e marcar o
      evento concluído; para `IGNORED`, comportamento atual (concluído sem trabalho); verificar com
      os cenários da spec `pluggy-connection-observability` ("item/deleted marca o vínculo inativo
      sem tentar reler")
- [x] 6.4 Tradução `(status, executionStatus) → connectionStatus`: checar `inactive_at` **antes** de
      qualquer tradução de `(status, executionStatus)` — presente vira `DISCONNECTED`
      incondicionalmente; incluir `DISCONNECTED` no vocabulário fechado; verificar com os cenários
      da spec `pluggy-connection-observability`
- [x] 6.5 `PluggyPersonItemResolver.itemIdsFor(personId)`: filtrar `inactive_at IS NULL` — corrige
      `GET /portfolio` (`ReadPluggyPositionInteractor`) e `GET /accounts`
      (`ReadPluggyAccountInteractor`) num só ponto; verificar com os cenários das specs
      `pluggy-position-sync`/`pluggy-transaction-history` ("Item inativo não contribui...") e um
      teste ponta a ponta: item com posições → `item/deleted` → vínculo inativo →
      `/credentials/status` mostra `DISCONNECTED` → `/portfolio` não mostra mais a posição →
      snapshot/raw permanecem

## 7. Coordenação de ingestão: lease com fencing token e heartbeat, Position/History independentes (D11, D15, D16, D30 — supera o PR #12)

- [x] 7.1 Migration: `radar_pluggy_item_ingestion_leases` (`item_id` único, `trigger`, `lease_until`,
      `fencing_token` BIGINT, `acquired_at`); verificar com `npm run migrate` limpo
- [x] 7.2 `PluggyItemIngestionLeaseRep`: `tryAcquire(itemId, trigger, ttlMs)` (incrementa
      `fencing_token`, mesmo idioma de `UPDATE ... WHERE` de
      `PluggyWebhookEventRep.claimNextPending`/`markSucceeded` — linhas afetadas prova posse),
      `renew(itemId, fencingToken, ttlMs)` e `release(itemId, fencingToken)`; verificar com teste
      concorrente representativo (dois `tryAcquire` para o mesmo item disparados antes de aguardar
      qualquer um — só um consegue, tokens distintos), teste de que um lease vencido é reivindicável
      por outro trigger com um `fencing_token` maior, e teste de que `renew`/`release` com
      `fencing_token` errado (perdido) devolve `false`/não afeta linha nenhuma
- [x] 7.3 `infra/worker/pluggy-item-ingestion.ts` (novo — substitui a orquestração ad hoc de
      `load-pluggy-item-in-background.ts` do PR #12): adquire o lease do item; se falhar, loga e
      retorna sem executar nada; se conseguir, inicia heartbeat (`renew` a cada `ttlMs / 3`), executa
      `syncPluggyPositionInteractor.execute` e `loadPluggyHistoryInteractor.execute` de forma
      independente (D15 — nenhum é condicionado ao resultado do outro), captura os dois resultados,
      para o heartbeat e libera o lease sempre (`finally`-equivalente, mesmo em exceção não tratada),
      e só então decide sucesso/falha da unidade de trabalho; verificar com os cenários da spec
      `pluggy-ingestion-coordination` (falha de posição não impede histórico, falha de histórico não
      impede posição, carga longa renova o lease antes de expirar, exceção inesperada ainda libera o
      lease e para a renovação)
- [x] 7.4 `webhook-drainer.ts`: assinatura passa a `drainPluggyWebhookEvents(container, trigger)` —
      **sem** `runWithCallContext` fixo internamente; troca o encadeamento bloqueante
      (`if (position.error) throw`) e o subquery `busyItemIds` interno de `claimNextPending` pelo
      lease compartilhado de 7.2 (adquirido com o `trigger` recebido, antes de marcar o evento
      `PROCESSING`; falha de aquisição mantém o evento `PENDING` e segue para o próximo candidato de
      item diferente) + a execução independente de 7.3, só para eventos `FULL_INGESTION` (ver seção
      6 para as outras categorias); verificar com os cenários de `pluggy-ingestion-coordination` e
      com a suíte de regressão existente de `webhook-drainer.test.ts`
- [x] 7.5 `RegisterPluggyCredentialInteractor`/handler: trocar a chamada a
      `loadPluggyItemInBackground` (PR #12) por um disparo de `pluggy-item-ingestion.ts` com
      `trigger = 'CREDENTIAL_REGISTRATION_PRELOAD'`; requisito funcional do PR #12 preservado; PR #12
      é rebaseado sobre esta versão ou fechado em favor dela
- [x] 7.6 `load-pluggy-history.handler.ts` (rota manual): todo o corpo do handler (aquisição do lease,
      chamada síncrona a `LoadPluggyHistoryInteractor`, resposta HTTP, disparo de
      `syncPluggyPositionInBackground`) roda dentro de um único `runWithCallContext({trigger:
      'MANUAL_HISTORY_LOAD', requestCorrelationId}, async () => {...})` (D30) — o disparo de Position
      é síncrono dentro dessa função (ainda que sua promise não seja aguardada), herdando o contexto;
      o `fencingToken` do lease é capturado por closure e usado tanto para o `renew` durante History
      quanto para o `release` só depois que Position conclui; falha de aquisição do lease responde
      `{errorType: 'PLUGGY_ITEM_INGESTION_IN_PROGRESS'}` sem tentar History nem Position; verificar
      com teste que a rota recusa quando o lease já está ocupado, que o `trigger`/
      `requestCorrelationId` aparecem corretos em `radar_pluggy_calls` tanto para a chamada de
      History quanto para a de Position, e que o lease só é liberado depois que Position conclui
- [x] 7.7 `index.ts` (boot): chama `drainPluggyWebhookEvents(container, 'BOOT_RECOVERY')`
      explicitamente (nunca um `trigger` implícito) — continua reclamando leases de evento vencidos
      (`reclaimExpiredLeases`) e leases de item vencidos (7.2); handler HTTP do webhook chama
      `drainInBackground(container, 'WEBHOOK', onError)` (ou equivalente, repassando `trigger`
      explicitamente); verificar com teste que consulta `radar_pluggy_calls` e prova a diferença
      (mesma passada de drenagem, uma chamada com `trigger = BOOT_RECOVERY` quando disparada pelo
      boot, outra com `trigger = WEBHOOK` quando disparada pela rota HTTP)

## 8. Histórico append-only de chamadas: recorder singleton, schema completo, PLATFORM_CONFIG (D1, D2, D3, D22, D23, D24, D25, D31)

- [x] 8.1 Migrations: `radar_pluggy_item_observations` com schema completo (D33 — `id`, `item_id`
      único, `status`, `execution_status`, `status_detail` JSON nullable, `item_products` JSON
      nullable, `last_updated_at` nullable, `next_auto_sync_at` nullable, `connector_id` nullable,
      `observation_started_at`, `created_at`, `updated_at`) e `radar_pluggy_calls` com schema
      completo (D24 — `id`, `item_id` nullable, `connector_id` nullable, `operation`, `http_method`
      nullable, `route_template` nullable, `call_scope`, `trigger` — vocabulário fechado de D23 —,
      `resource_type` nullable, `resource_id` nullable, `request_correlation_id`, `webhook_event_id`
      nullable, `page_ordinal` nullable, `page_size` nullable, `started_at`, `completed_at`,
      `duration_ms`, `http_status` nullable, `outcome` — `SUCCEEDED`/`FAILED` —, `failure_kind`
      nullable — `CLIENT_ERROR`/`UPSTREAM_ERROR`/`TIMEOUT`/`UNAVAILABLE`/`UNKNOWN` —, `error_code`
      nullable, `created_at`; índices `(item_id, started_at)`, `(item_id, operation, started_at)`,
      `(connector_id, operation, started_at)`, `(trigger, started_at)`, `(request_correlation_id)`,
      `(webhook_event_id)`); verificar com `npm run migrate` limpo
- [x] 8.2 Entities `PluggyItemObservation` (não-regressão de `observationStartedAt`, condição `>`
      estrita — D9.1) e `PluggyCall` (obrigatórios + enums de `operation`/`call_scope`/`trigger`/
      `outcome`/`failure_kind`)
- [x] 8.3 `PluggyCallRecorder` (D31): serviço singleton (registrado no container raiz, mesmo padrão
      de `PluggyClientGateway`), `record(event: PluggyCallEvent): void` — grava sem a transação do
      chamador (autocommit), nunca `await`ado por quem chama (D25); falha cai em `logger.warn`;
      verificar com teste de contrato, teste de que a escrita sobrevive a um rollback do chamador,
      teste de que uma falha ao persistir gera log de aviso sem lançar para o chamador, e teste de
      que o resultado da chamada real é devolvido sem esperar a tentativa de persistência concluir
- [x] 8.4 `infra/tools/call-context.ts` (`AsyncLocalStorage`, `runWithCallContext`/
      `currentCallContext`) — carrega só `trigger`/`webhookEventId`/`requestCorrelationId`/um
      contador de `page_ordinal` particionado por `operation + resource_id`; **nunca** DB,
      repositório ou o próprio `PluggyCallRecorder`; verificar com teste que o contexto setado numa
      chamada não vaza para uma chamada concorrente não relacionada
- [x] 8.5 `PluggyClientGateway`: recebe `PluggyCallRecorder` via DI e repassa para cada
      `PluggyConnectorClient` que constrói; `PluggyConnectorClient.getApiKey` override chama
      `recorder.record(...)` diretamente para `AUTH`, lendo contexto de `currentCallContext()`;
      verificar com teste que client novo gera uma linha `AUTH` e que uma segunda chamada com token
      em cache não gera nenhuma
- [x] 8.6 `adapters/gateways/pluggy-call-instrumentation.ts`:
      `instrumentPluggyClient(client, {itemId, connectorId}, recorder)` — `recorder` como parâmetro
      explícito, nunca resolvido via `AsyncLocalStorage`; tabela estática `operação →
      {callScope, resourceType, argIndex}` cobrindo os métodos reais usados pelos 8 gateways de
      borda **e** `fetchWebhook`/`createWebhook`/`updateWebhook` (D22); classifica `outcome`/
      `failure_kind` reaproveitando `pluggySdkError` (já existente em `pluggy-client.gateway.ts`);
      preenche `page_ordinal` do contador em `CallContext` para chamadas cursor-based, e o argumento
      de página real para paginação numérica; nunca grava corpo de requisição/resposta, segredo ou
      cursor opaco; verificar com teste que cada operação gera exatamente uma linha, com
      `outcome`/`failure_kind` corretos nos casos de sucesso e falha, teste que nenhum campo
      proibido aparece persistido, e teste que `page_ordinal` incrementa corretamente numa
      varredura cursor-based
- [x] 8.7 Aplicar `instrumentPluggyClient` (com o `pluggyCallRecorder` resolvido do próprio escopo)
      em `PluggyItemCredentialResolver.clientFor` (client cacheado), em
      `RegisterPluggyCredentialImpl.validateItemAccess` (`freshClient`) e em
      `PluggyWebhookProvisioner.provisionFor` (client de `PluggyClientGateway.clientFor`, D22);
      verificar que as três chamadas geram linha em `radar_pluggy_calls` (as duas primeiras com
      `item_id` preenchido, a terceira com `item_id`/`connector_id` nulos e `call_scope =
      PLATFORM_CONFIG`), e que `validateItemAccess` nunca cria nem atualiza linha em
      `radar_pluggy_item_observations`
- [x] 8.8 `runWithCallContext` nos pontos de entrada, sempre com `trigger` recebido explicitamente do
      chamador (nunca fixo internamente, D23): `webhook-drainer.ts` (`trigger` recebido por
      parâmetro — seção 7.4/7.7), `pluggy-item-ingestion.ts` (`trigger` recebido do chamador, reaproveita
      contexto já aberto pelo drenador em vez de sobrepor `webhookEventId`), `RegisterPluggyCredentialImpl`
      em volta de `validateItemAccess` (`trigger=CREDENTIAL_REGISTRATION_VALIDATION`) e em volta do
      provisionamento de webhook (`trigger=CREDENTIAL_REGISTRATION_PROVISIONING`),
      `ReconcilePluggyWebhookImpl` (`trigger=WEBHOOK_RECONCILIATION`) — no gateway impl de cada caso de
      uso, nunca no interactor (arquitetura-camadas: interactor não importa `infra/`). Ampliado nesta
      rodada, fora do escopo original desta task, para cobrir também `load-pluggy-history.handler.ts`
      (D30, `trigger=MANUAL_HISTORY_LOAD` + `requestCorrelationId` do request, cobrindo History síncrono
      e a continuação de Position em background) — lacuna do checklist original que design.md D30 já
      documentava mas esta task não listava; ver design.md D30 para o ajuste de ordem (lease adquirido
      antes de abrir o contexto, para não acoplar a garantia de liberação do lease a `resolve('requestId')`).
      Verificado com teste que cada trigger aparece correto no `CallContext` para cada fluxo, incluindo
      o teste de 7.7 (`BOOT_RECOVERY` distinto de `WEBHOOK` na mesma função de drenagem)

## 9. Estado observado e identidade do connector (D8, D9, D9.1, D18, D19, D26, D33)

- [x] 9.1 `PluggyItemsGateway.parseItem`: extrair `connector: {id, name, imageUrl, primaryColor,
      products}` do payload (produtos suportados pela instituição, D19); verificar com teste que
      `PluggyItemSnapshot.connector` é preenchido a partir de um payload real de `Item`
- [x] 9.2 `PluggyItemStateResolver` (novo, `.scoped()`, cache por escopo de trabalho, usado só por
      consumidores de item já vinculado — nunca por `validateItemAccess`): `read(itemId)` captura
      `observationStartedAt = new Date()` **antes** de chamar `fetchItem` (D9.1), busca via
      `PluggyItemCredentialResolver` + `PluggyItemsGateway`, e tenta uma **única escrita atômica**
      (D18) que decide aceitar a observação (`incoming.observationStartedAt >
      stored.observationStartedAt` — estritamente maior) e, só se aceita, grava `status_detail`,
      `item_products` (2.4), `last_updated_at`, `next_auto_sync_at` e atualiza o connector do vínculo
      (incluindo `connector_products`, D19) na mesma transação; segunda chamada no mesmo escopo não
      bate na rede; verificar com teste contando chamadas ao client mockado, teste de que uma
      observação com `observationStartedAt` menor não sobrescreve, teste de empate, e teste de que
      uma observação recusada não atualiza o connector
- [x] 9.3 Trocar `SyncPluggyPositionImpl.readCurrentItemState` e
      `LoadPluggyHistoryImpl.readCurrentItemState` para usar `PluggyItemStateResolver.read`;
      verificar que a suíte de regressão dos dois interactors continua verde
- [x] 9.4 Migration: colunas de connector em `radar_pluggy_credential_items` (`connector_id`,
      `connector_name`, `connector_image_url`, `connector_primary_color`, `connector_products` JSON,
      todas nullable — já inclui `inactive_at` da seção 6.2); verificar com `npm run migrate` limpo
- [x] 9.5 `RegisterPluggyCredentialInteractor`/`Impl`: `saveCredentialWithItemLink` passa a receber e
      persistir os campos de connector (incluindo `connector_products`) lidos por
      `validateItemAccess`; verificar com teste que o vínculo criado já nasce com a identidade e os
      produtos do connector
- [x] 9.6 Tradução `(status, executionStatus) → connectionStatus` (seção 6.4 já cobre `inactive_at`
      → `DISCONNECTED`): `CONNECTING`, `CONNECTED`, `PARTIAL`, `NEEDS_RECONNECT`,
      `AWAITING_USER_INPUT`, `STALE`, `DISCONNECTED`, `UNKNOWN`, incluindo `WAITING_USER_ACTION`/
      `MERGING`; verificar com teste de tabela cobrindo os cenários da spec
      `pluggy-connection-observability`

## 10. `GET /credentials/status` com items[] e estado por fonte (D10, D19, D20, D26)

- [x] 10.1 `CheckPluggyCredentialGateway`: novo método lendo `radar_pluggy_item_observations` +
      `radar_pluggy_credential_items` (connector + `connector_products` + `inactive_at`) por item
      vinculado à pessoa; tradução de `sources` (D20): para cada fonte do catálogo (1.1),
      `supportedByConnector` (de `connector_products`), `enabledForItem` (de `item_products` —
      `true`/`false`/omitido quando `UNKNOWN`), e só quando `enabledForItem === true`,
      `isUpdated`/`lastUpdatedAt` (de `status_detail` quando `PARTIAL_SUCCESS`, ou
      `{true, last_updated_at}` quando `SUCCESS`, sem exigir `status_detail`)
- [x] 10.2 `CheckPluggyCredentialInteractor`/handler: novo shape
      `{hasCredential, items: [{itemId, connectorId, connectorName, connectorImageUrl,
      connectorPrimaryColor, connectionStatus, lastUpdatedAt, nextAutoSyncAt, sources: {accounts,
      accountTransactions, investments, investmentTransactions, loans}}]}`, cada fonte com
      `{supportedByConnector, enabledForItem?, isUpdated?, lastUpdatedAt?}`; verificar com os
      cenários da spec `pluggy-credentials` (pessoa com itens em estados diferentes, fonte não
      contamina outra, fonte suportada mas não habilitada nunca aparece elegível, fonte não
      suportada aparece marcada, habilitação desconhecida nunca vira habilitado, `SUCCESS` não exige
      `statusDetail`, pessoa sem credencial, item removido aparece `DISCONNECTED` e some do
      portfolio)
- [x] 10.3 Teste ponta a ponta do cadastro: depois de `POST /credentials`, aguardar a ingestão
      (seção 7) e confirmar observação gravada, linhas em `radar_pluggy_calls` com
      `CREDENTIAL_REGISTRATION_VALIDATION`, `CREDENTIAL_REGISTRATION_PROVISIONING` e
      `CREDENTIAL_REGISTRATION_PRELOAD`, e `GET /credentials/status` refletindo o estado correto
      (incluindo `sources`)

## 11. `oplab-radar-front`

- [x] 11.1 `pluggy-credentials.api.ts`: `PluggyCredentialStatusResponseDto` ganha `items[]` (com
      `sources`, cada uma com `supportedByConnector`/`enabledForItem`/`isUpdated`/`lastUpdatedAt`);
      `checkStatus()` devolve o objeto inteiro
- [x] 11.2 `pluggy-credentials.store.ts`: `items` como novo estado; `register()` chama
      `checkStatus()` ao final, antes de devolver sucesso
- [x] 11.3 `pluggy-portfolio.store.ts` e `pluggy-card-statement.store.ts`: `fetchList()`/`fetch()`
      disparam `usePluggyCredentialsStore().checkStatus()` em paralelo (`Promise.all`) — o método do
      segundo store é `fetch()`, não `fetchList()` como o texto original desta task dizia; corrigido
      aqui, comportamento idêntico
- [x] 11.4 Componente/composable `PluggyConnectionBanner`: prioridade `DISCONNECTED` >
      `NEEDS_RECONNECT`/`AWAITING_USER_INPUT` > `CONNECTING`/`UNKNOWN` > `PARTIAL`/`STALE` > nada,
      usando `sources` para nomear qual produto especificamente está pendente — uma fonte com
      `enabledForItem === false` nunca aparece como pendência; usa `connectorName`/
      `connectorImageUrl`; verificado com teste de tabela de casos
      (`use-pluggy-connection-banner.test.ts`)
- [x] 11.5 `PluggyPortfolioView.vue` e `PluggyCardStatementView.vue`: usam o banner; lista vazia só
      mostra "Nenhuma posição encontrada"/"Nenhum lançamento nesta fatura" quando a fonte relevante
      está `enabledForItem`/`isUpdated` e genuinamente vazia, e o item não está `DISCONNECTED` —
      nunca quando pendente, recusada, ou não habilitada (`PluggyCardStatementTable` ganhou a prop
      `confirmedEmpty` para isso); verificado com teste de view (`PluggyPortfolioView.test.ts`)

## 12. `ADR-radar-pluggy-open-finance-consumo-sincronizacao.md`

- [x] 12.1 Banner de status já adicionado nesta rodada de planejamento (ver topo do arquivo) —
      conferido: a implementação usa watermark por `(item, consumer, source)`
      (`radar_pluggy_sync_progress`, nunca o watermark global das seções 16/19-20 do ADR),
      `PARTIAL_SUCCESS` de posição tratado via `isUsable`/`statusDetail` (D6/D12/D26, nunca a seção 20
      "ponto em aberto"), e `radar_pluggy_calls` implementado com schema/instrumentação completos
      (D24, nunca só "auditar chamadas" como item futuro) — nenhuma seção normativa superada do ADR
      foi seguida em vez das specs deste change

## 13. Verificação final

- [x] 13.1 `radar-pluggy`: `npm run lint`, `npm run type-check` e `npm test` verdes em Docker
      (108/108 arquivos, 798/798 testes)
- [x] 13.2 `oplab-radar-front`: `npm run lint`, `npm run type-check`, `npm test` verdes (43/43
      arquivos, 260/260 testes)
- [x] 13.3 `openspec validate arquitetura-observabilidade-sync-pluggy --strict` sem erros — só avisos
      RFC 2119 ("should contain SHALL or MUST"), a mesma classe de aviso que toda spec já adotada
      neste projeto tem (prosa em português, nunca reescrita em modais ingleses; confirmado contra
      `openspec/specs/pluggy-item/spec.md`, já mergeada)
- [ ] 13.4 PR #12 (`feat/pluggy-precarga-cadastro-credencial`): rebaseado sobre a versão final deste
      change ou fechado em favor dela (D11) — decisão registrada no PR que implementa a seção 7
- [x] 13.5 Varredura de consistência: nenhuma menção vigente (fora de "alternativa descartada") a
      `limitedByRateLimit`, `investmentsTransactions`, watermark global de item para posição/
      histórico, `statusDetail` sempre presente, `Connector.products` tratado como produtos do Item,
      "sem chamada nova à Pluggy" (sem a ressalva do `fetchItem` de gate), ou `item/created`/
      `item/updated` como únicos eventos relevantes — varrido `src/`, `tests/`, `openspec/changes/
      arquitetura-observabilidade-sync-pluggy/*.md` e `.claude/skills/`: toda ocorrência restante é
      comentário explicando "não X, e sim Y" (D7/D12/D19/D26/D28), teste de regressão provando que a
      grafia antiga é rejeitada, ou o ADR já com seu próprio banner de SUPERSEDED — nenhuma reafirma a
      decisão descartada como válida
