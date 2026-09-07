## 1. Correções de shape contra o SDK instalado (D6, D7 — bloqueiam os grupos 3 e 5)

- [ ] 1.1 `PluggyItemsGateway`: corrigir a chave de `statusDetail` de `investmentsTransactions` para
      `investmentTransactions` e adicionar `'loans'` a `PRODUCT_KEYS`/`PluggyProductKey`; verificar
      com teste que um payload real de `statusDetail.investmentTransactions`/`statusDetail.loans` é
      parseado e aparece em `PluggyItemSnapshot.products`
- [ ] 1.2 `PluggyItem.VALID_STATUSES`: adicionar `WAITING_USER_ACTION` e `MERGING`; verificar com
      teste que `PluggyItem.create`/`reconstitute` aceitam os dois novos valores sem lançar
- [ ] 1.3 Extrair `toProductState`/`isProductUsable` (baseado em `isUpdated`, não em código de
      `warning`) para um módulo compartilhado (`adapters/gateways/pluggy-product-state.ts`);
      verificar com teste de tabela que `isUpdated !== true` em `PARTIAL_SUCCESS` recusa o produto e
      `isUpdated === true` o libera, sem depender de nenhum código de `warning`
- [ ] 1.4 `LoadPluggyHistoryImpl`: trocar a derivação local de `limitedByRateLimit` pela função
      compartilhada de 1.3; verificar que a suíte de testes existente de
      `load-pluggy-history.interactor.test.ts` continua verde após ajustar os fixtures para
      `isUpdated`

## 2. Marca d'água por consumidor e por fonte real (D4, D5)

- [ ] 2.1 Migration: criar `radar_pluggy_sync_progress` (`item_id`, `consumer` — valores
      `POSITION_SYNC`, `HISTORY_LOAD` —, `source` — valores `ACCOUNTS`, `ACCOUNT_TRANSACTIONS`,
      `INVESTMENTS`, `INVESTMENT_TRANSACTIONS`, `LOANS` —, `last_completed_source_updated_at`,
      índice único `(item_id, consumer, source)`) e remover `radar_pluggy_history_sync_states` na
      mesma migration; verificar com `npm run migrate` limpo em banco vazio
- [ ] 2.2 Entity `PluggySyncProgress` (create/reconstitute, avanço sem regressão) e
      `PluggySyncProgressRep` (`read(itemId, consumer, source)`, `advance(itemId, consumer, source,
      updatedAt)`); verificar com teste de contrato modelo↔migration e teste de recusa de regressão
- [ ] 2.3 `LoadPluggyHistoryImpl`/`Interactor`: portão passa de `radar_pluggy_history_sync_states`
      (item-level) para `PluggySyncProgressRep` com `consumer = HISTORY_LOAD` — `CASH` elegível
      quando `(HISTORY_LOAD, ACCOUNTS)` ou `(HISTORY_LOAD, ACCOUNT_TRANSACTIONS)` estiver
      desatualizada; `CUSTODY`, quando `(HISTORY_LOAD, INVESTMENTS)` ou `(HISTORY_LOAD,
      INVESTMENT_TRANSACTIONS)` estiver desatualizada; cada fonte processada avança sua própria
      marca d'água sob `HISTORY_LOAD`, nunca as duas de um agrupamento como um valor só; verificar
      com os cenários da spec `pluggy-transaction-history` (dia sem mudança em nenhuma fonte vs. um
      agrupamento avança sem esperar o outro vs. uma fonte do mesmo agrupamento avança sem esperar a
      outra)
- [ ] 2.4 `SyncPluggyPositionImpl`/`Interactor`: aceitar `executionStatus` `SUCCESS` ou
      `PARTIAL_SUCCESS`; processar `investments`/`loans` de forma independente usando 1.3,
      avançando `(POSITION_SYNC, INVESTMENTS)`/`(POSITION_SYNC, LOANS)` em `PluggySyncProgressRep` —
      linhas próprias deste consumidor, nunca as de `HISTORY_LOAD` para `INVESTMENTS`; recusa de
      lista vazia só quando o produto foi de fato tentado; verificar com os cenários da spec
      `pluggy-position-sync` (produto recusado não impede o outro, produto recusado não é lista
      vazia) e um teste específico de que `SyncPluggyPositionImpl` avançar `(POSITION_SYNC,
      INVESTMENTS)` não altera `(HISTORY_LOAD, INVESTMENTS)` (cenário da spec `pluggy-sync-progress`)
- [ ] 2.5 `radar_pluggy_items.last_updated_at`: confirmar (teste de regressão) que só avança quando
      `executionStatus === 'SUCCESS'`, nunca em `PARTIAL_SUCCESS`, mesmo com produto processado

## 3. Histórico append-only de chamadas (D1, D2, D3)

- [ ] 3.1 Migrations: `radar_pluggy_item_observations` (`item_id` único, `observation_started_at`
      como token de ordenação — D9.1, nunca um `updated_at` de save) e `radar_pluggy_calls`
      (`item_id` nullable, `call_scope` com `PLATFORM_CONFIG`, `trigger` incluindo
      `CREDENTIAL_REGISTRATION_PRELOAD` e `CREDENTIAL_REGISTRATION_VALIDATION`); verificar com
      `npm run migrate` limpo
- [ ] 3.2 Entities `PluggyItemObservation` (não-regressão de `observationStartedAt`, D9.1) e
      `PluggyCall` (obrigatórios + enum) e seus repositórios, cada um com transação própria,
      independente da transação de negócio do chamador; verificar com teste de contrato, teste de
      que a escrita sobrevive a um rollback do chamador, e teste de que uma falha ao persistir
      (banco indisponível) gera log de aviso nomeando o erro e não lança para o chamador
      (`radar_pluggy_calls` é tentativa de persistência, nunca garantia de entrega — ver spec
      `pluggy-call-history`)
- [ ] 3.3 `infra/tools/call-context.ts` (`AsyncLocalStorage`, `runWithCallContext`/
      `currentCallContext`); verificar com teste que o contexto setado numa chamada não vaza para
      uma chamada concorrente não relacionada
- [ ] 3.4 `adapters/gateways/pluggy-call-instrumentation.ts` (`instrumentPluggyClient`), com tabela
      estática `operação → {callScope, resourceType, argIndex}` cobrindo os métodos reais usados
      pelos 8 gateways de borda; verificar com teste que cada operação gera exatamente uma linha,
      com `outcome` correto nos casos de sucesso e falha
- [ ] 3.5 `PluggyConnectorClient.getApiKey` override em `pluggy-client.gateway.ts`; verificar com
      teste que client novo gera uma linha `AUTH` e que uma segunda chamada com token em cache não
      gera nenhuma
- [ ] 3.6 Aplicar `instrumentPluggyClient` em `PluggyItemCredentialResolver.clientFor` (client
      cacheado) e em `RegisterPluggyCredentialImpl.validateItemAccess` (`freshClient`); verificar
      que as duas chamadas geram linha em `radar_pluggy_calls`, com `item_id` preenchido nas duas, e
      que `validateItemAccess` (leitura pré-vínculo, `freshClient`, fora de
      `PluggyItemStateResolver`) nunca cria nem atualiza linha em `radar_pluggy_item_observations`
      (cenário da spec `pluggy-connection-observability`)
- [ ] 3.7 `runWithCallContext` nos pontos de entrada: `webhook-drainer.ts` (`trigger=WEBHOOK` +
      `webhookEventId`), `index.ts` no boot (`trigger=BOOT_RECOVERY` — inclui passar um parâmetro
      novo para `drainPluggyWebhookEvents` distinguir os dois casos),
      `load-pluggy-item-in-background.ts` (`trigger=CREDENTIAL_REGISTRATION_PRELOAD`),
      `sync-pluggy-position-in-background.ts` (`trigger=MANUAL_HISTORY_LOAD`),
      `RegisterPluggyCredentialInteractor` em volta de `validateItemAccess`
      (`trigger=CREDENTIAL_REGISTRATION_VALIDATION`); verificar com teste que cada trigger aparece
      correto em `radar_pluggy_calls` para cada fluxo

## 4. Estado observado e identidade do connector (D8, D9, D9.1)

- [ ] 4.1 `PluggyItemsGateway.parseItem`: extrair `connector: {id, name, imageUrl, primaryColor}` do
      payload, hoje descartado; verificar com teste que `PluggyItemSnapshot.connector` é preenchido
      a partir de um payload real de `Item`
- [ ] 4.2 `PluggyItemStateResolver` (novo, `.scoped()`, cache por escopo de trabalho, usado só por
      consumidores de item já vinculado — nunca por `validateItemAccess`): `read(itemId)` captura
      `observationStartedAt = new Date()` **antes** de chamar `fetchItem` (D9.1), busca via
      `PluggyItemCredentialResolver` + `PluggyItemsGateway`, persiste `radar_pluggy_item_observations`
      por upsert condicional (`incoming.observationStartedAt > stored.observationStartedAt` —
      estritamente maior, empate nunca sobrescreve, transação própria) e devolve o snapshot; segunda
      chamada no mesmo escopo não bate na rede; verificar com teste contando chamadas ao client
      mockado, teste de que uma observação com `observationStartedAt` menor que a já registrada não
      sobrescreve, e teste de que duas observações com `observationStartedAt` idêntico não se
      sobrescrevem mutuamente (cenários da spec `pluggy-connection-observability`)
- [ ] 4.2.1 `PluggyItemStateResolver.read`: sempre que o snapshot trouxer `connector` válido,
      regravar `connector_id`/`connector_name`/`connector_image_url`/`connector_primary_color` no
      vínculo credencial↔item correspondente (`radar_pluggy_credential_items`) — mesmo valor já
      conhecido regrava sem erro; connector diferente do último conhecido substitui (D8); verificar
      com teste que um vínculo legado sem connector é preenchido na próxima observação, e teste que
      um vínculo com connector já persistido é atualizado quando o payload trouxer valores diferentes
- [ ] 4.3 Trocar `SyncPluggyPositionImpl.readCurrentItemState` e
      `LoadPluggyHistoryImpl.readCurrentItemState` para usar `PluggyItemStateResolver.read`;
      verificar que a suíte de regressão dos dois interactors continua verde sem nenhuma mudança de
      comportamento observável
- [ ] 4.4 Migration: colunas de connector em `radar_pluggy_credential_items`
      (`connector_id`, `connector_name`, `connector_image_url`, `connector_primary_color`, todas
      nullable); verificar com `npm run migrate` limpo
- [ ] 4.5 `RegisterPluggyCredentialInteractor`/`Impl`: `saveCredentialWithItemLink` passa a receber e
      persistir os campos de connector lidos por `validateItemAccess`; verificar com teste que o
      vínculo criado já nasce com a identidade do connector
- [ ] 4.6 Tradução `(status, executionStatus) → connectionStatus` (`CONNECTING`, `CONNECTED`,
      `PARTIAL`, `NEEDS_RECONNECT`, `AWAITING_USER_INPUT`, `STALE`, `UNKNOWN`), incluindo
      `WAITING_USER_ACTION`/`MERGING`; verificar com teste de tabela cobrindo os cenários da spec
      `pluggy-connection-observability`

## 5. `GET /credentials/status` com items[] (D10)

- [ ] 5.1 `CheckPluggyCredentialGateway`: novo método lendo `radar_pluggy_item_observations` +
      `radar_pluggy_credential_items` (connector) por item vinculado à pessoa
- [ ] 5.2 `CheckPluggyCredentialInteractor`/handler: novo shape
      `{hasCredential, items: [{itemId, connectorId, connectorName, connectorImageUrl,
      connectorPrimaryColor, connectionStatus, lastUpdatedAt, nextAutoSyncAt}]}`; verificar com os
      cenários da spec `pluggy-credentials` (pessoa com itens em estados diferentes, pessoa sem
      credencial)
- [ ] 5.3 Teste ponta a ponta do cadastro: depois de `POST /credentials`, aguardar o preload e
      confirmar observação gravada, linhas em `radar_pluggy_calls` com
      `CREDENTIAL_REGISTRATION_VALIDATION` e `CREDENTIAL_REGISTRATION_PRELOAD`, e
      `GET /credentials/status` refletindo o estado correto

## 6. `oplab-radar-front`

- [ ] 6.1 `pluggy-credentials.api.ts`: `PluggyCredentialStatusResponseDto` ganha `items[]`;
      `checkStatus()` devolve o objeto inteiro
- [ ] 6.2 `pluggy-credentials.store.ts`: `items` como novo estado; `register()` chama `checkStatus()`
      ao final, antes de devolver sucesso; verificar com teste de store que, depois de `register()`
      resolver, `items` já reflete a resposta mais recente
- [ ] 6.3 `pluggy-portfolio.store.ts` e `pluggy-card-statement.store.ts`: `fetchList()` dispara
      `usePluggyCredentialsStore().checkStatus()` em paralelo
- [ ] 6.4 Componente/composable `PluggyConnectionBanner`: prioridade
      `NEEDS_RECONNECT`/`AWAITING_USER_INPUT` > `CONNECTING`/`UNKNOWN` > `PARTIAL`/`STALE` > nada;
      usa `connectorName`/`connectorImageUrl`; verificar com teste de tabela de casos, incluindo
      múltiplos items em estados diferentes
- [ ] 6.5 `PluggyPortfolioView.vue` e `PluggyCardStatementView.vue`: usar o banner; lista vazia só
      mostra "Nenhuma posição encontrada" quando todo item relevante está
      `CONNECTED`/`PARTIAL`/`STALE`; verificar com teste de view cobrindo vazio-real vs.
      vazio-por-sincronização-pendente

## 7. Verificação final

- [ ] 7.1 `radar-pluggy`: `npm run lint` (inclui `tsc --noEmit`) e `npm test` verdes em Docker
- [ ] 7.2 `oplab-radar-front`: `npm run lint`, `npm run type-check`, `npm test` verdes
- [ ] 7.3 `openspec validate arquitetura-observabilidade-sync-pluggy --strict` sem erros
