## 1. Correções de shape contra o SDK instalado (D6, D7 — bloqueiam os grupos 3, 5 e 6)

- [ ] 1.1 `PluggyItemsGateway`: corrigir a chave de `statusDetail` de `investmentsTransactions` para
      `investmentTransactions` e adicionar `'loans'` a `PRODUCT_KEYS`/`PluggyProductKey`; verificar
      com teste que um payload real de `statusDetail.investmentTransactions`/`statusDetail.loans` é
      parseado e aparece em `PluggyItemSnapshot.products`
- [ ] 1.2 `PluggyItem.VALID_STATUSES`: adicionar `WAITING_USER_ACTION` e `MERGING`; verificar com
      teste que `PluggyItem.create`/`reconstitute` aceitam os dois novos valores sem lançar
- [ ] 1.3 Extrair `toSourceState`/`isUsable` (baseado em `isUpdated`, não em código de `warning`,
      nome de domínio próprio — D6, nunca `limitedByRateLimit`) para um módulo compartilhado
      (`adapters/gateways/pluggy-source-state.ts`); verificar com teste de tabela que
      `isUpdated !== true` em `PARTIAL_SUCCESS` recusa a fonte e `isUpdated === true` a libera, sem
      depender de nenhum código de `warning`
- [ ] 1.4 `LoadPluggyHistoryImpl`: trocar a derivação local de `limitedByRateLimit` pela função
      compartilhada de 1.3 (renomear o campo de domínio para `isUsable` em todo o arquivo); verificar
      que a suíte de testes existente de `load-pluggy-history.interactor.test.ts` continua verde
      após ajustar os fixtures

## 2. Escrita atômica de marca d'água (D17 — corrige código já em `staging`, entra antes da reescrita dos interactors)

- [ ] 2.1 `PluggyItemRep.save`: trocar `row.update(...)` incondicional por `UPDATE ... WHERE item_id
      = ? AND (last_updated_at IS NULL OR last_updated_at < ?)`; zero linhas afetadas é no-op, nunca
      erro; verificar com teste concorrente representativo (dois `save` disparados antes de aguardar
      qualquer um, versões diferentes) que a versão mais nova sempre prevalece, independente da
      ordem de conclusão
- [ ] 2.2 `PluggyHistoryCoverageRep.save`: mesma troca, condição por `last_completed_scan_at`/
      `source_updated_at`; verificar com teste concorrente equivalente
- [ ] 2.3 Teste de regressão único cobrindo os dois repositórios com o mesmo padrão de teste
      concorrente usado em `pluggy-webhook-event.rep.test.ts` (se existir) ou equivalente novo

## 3. Marca d'água por consumidor e por fonte real, com dependência entre fontes (D4, D5, D12, D13)

- [ ] 3.1 Migration: criar `radar_pluggy_sync_progress` (`item_id`, `consumer` — valores
      `POSITION_SYNC`, `HISTORY_LOAD` —, `source` — valores `ACCOUNTS`, `ACCOUNT_TRANSACTIONS`,
      `INVESTMENTS`, `INVESTMENT_TRANSACTIONS`, `LOANS` —, `last_completed_version_at`, índice único
      `(item_id, consumer, source)`) e remover `radar_pluggy_history_sync_states` na mesma migration;
      verificar com `npm run migrate` limpo em banco vazio
- [ ] 3.2 Entity `PluggySyncProgress` (create/reconstitute, avanço sem regressão) e
      `PluggySyncProgressRep` (`read(itemId, consumer, source)`, `advance(itemId, consumer, source,
      versionAt)` com escrita atômica — mesmo padrão de 2.1); verificar com teste de contrato
      modelo↔migration, teste de recusa de regressão e teste concorrente
- [ ] 3.3 `toVersionAt(item)`: `Item.lastUpdatedAt` quando `executionStatus === 'SUCCESS'`;
      `statusDetail.<fonte>.lastUpdatedAt` quando `PARTIAL_SUCCESS` e `isUsable` (1.3); `undefined`
      (fonte não avança) quando não utilizável — módulo compartilhado por `SyncPluggyPositionImpl` e
      `LoadPluggyHistoryImpl`; verificar com teste de tabela cobrindo os três casos (spec
      `pluggy-sync-progress`, "Versão gravada depende de executionStatus")
- [ ] 3.4 `LoadPluggyHistoryImpl`/`Interactor`: portão passa de `radar_pluggy_history_sync_states`
      (item-level) para `PluggySyncProgressRep` com `consumer = HISTORY_LOAD` — `CASH` elegível
      quando `(HISTORY_LOAD, ACCOUNTS)` ou `(HISTORY_LOAD, ACCOUNT_TRANSACTIONS)` estiver
      desatualizada; `CUSTODY`, quando `(HISTORY_LOAD, INVESTMENTS)` ou `(HISTORY_LOAD,
      INVESTMENT_TRANSACTIONS)` estiver desatualizada; verificar com os cenários da spec
      `pluggy-transaction-history` (dia sem mudança, um agrupamento avança sem o outro, uma fonte do
      mesmo agrupamento avança sem a outra)
- [ ] 3.5 `LoadPluggyHistoryImpl`/`Interactor`: `ACCOUNT_TRANSACTIONS` só avança (D13) quando a
      coleta de transações **e** `ACCOUNTS` estiverem utilizáveis na mesma execução; mesma regra
      para `INVESTMENT_TRANSACTIONS`/`INVESTMENTS`; `ACCOUNTS`/`INVESTMENTS` avançam sozinhas,
      independente da fonte dependente; verificar com os cenários da spec `pluggy-transaction-history`
      ("Fonte de transação depende de sua fonte de descoberta")
- [ ] 3.6 `LoadPluggyHistoryImpl`: varredura de transações deixa de filtrar por
      `Account.providerUpdatedAt`/`Investment.updatedAt` (D14) — quando `ACCOUNT_TRANSACTIONS`/
      `INVESTMENT_TRANSACTIONS` está elegível, varre transações de todas as contas/investimentos que
      a listagem atual trouxe; `sourceChanged`/o gate por `updatedAt` de recurso individual é
      removido do caminho de decisão; verificar com teste que uma conta com `updatedAt` inalterado
      ainda tem suas transações varridas quando a fonte está elegível
- [ ] 3.7 `SyncPluggyPositionImpl`/`Interactor`: aceitar `executionStatus` `SUCCESS` ou
      `PARTIAL_SUCCESS`; processar `investments`/`loans` de forma independente usando 1.3,
      avançando `(POSITION_SYNC, INVESTMENTS)`/`(POSITION_SYNC, LOANS)` via `PluggySyncProgressRep`
      com a versão de 3.3 — linhas próprias deste consumidor, nunca as de `HISTORY_LOAD` para
      `INVESTMENTS`; verificar com os cenários da spec `pluggy-position-sync` e um teste específico
      de que `SyncPluggyPositionImpl` avançar `(POSITION_SYNC, INVESTMENTS)` não altera
      `(HISTORY_LOAD, INVESTMENTS)` (cenário da spec `pluggy-sync-progress`)
- [ ] 3.8 `radar_pluggy_items.last_updated_at`: confirmar (teste de regressão) que só avança quando
      `executionStatus === 'SUCCESS'`, nunca em `PARTIAL_SUCCESS`, mesmo com fonte processada

## 4. Reconciliação de fotografia e semântica de lista vazia (D21 — corrige código já em `staging`)

- [ ] 4.1 `SyncPluggyPositionInteractor.execute`: remover a recusa incondicional de lista vazia de
      investimentos (`PLUGGY_INVESTMENTS_EMPTY_WITH_SUCCESS_STATUS`) — consentimento já é verificado
      antes (`readConsentStatus`); lista vazia de uma fonte utilizável passa a ser autoritativa;
      verificar com o cenário "Lista vazia autoritativa reconcilia como portfólio vazio" da spec
      `pluggy-position-sync`
- [ ] 4.2 `savePositionsWithSnapshots`/`saveLoansWithSnapshots`
      (`sync-pluggy-position.impl.ts`): depois do upsert de cada item presente, remover (ou marcar
      como não-corrente) da fotografia atual (`PluggyPositionRep`/`PluggyLoanRep`) todo registro
      daquele Item cujo identificador natural não veio na leitura autoritativa desta execução — só
      quando a fonte for `isUsable`; nunca quando recusada; mesma transação dos upserts; verificar
      com os cenários da spec `pluggy-position-sync` (investimento que sumiu, fonte recusada não
      reconcilia, primeira carga vazia)
- [ ] 4.3 `LoadPluggyHistoryImpl.readCashSources`: mesma reconciliação para `PluggyAccountRep`,
      condicionada a `ACCOUNTS` ser `isUsable` nesta execução; verificar com os cenários da spec
      `pluggy-transaction-history` ("Leitura autoritativa de contas reconcilia a fotografia atual")
- [ ] 4.4 Confirmar que `PluggyPositionSnapshotRep`/`PluggyPositionRawRep`/equivalentes de
      loan/account **não** são tocados pela reconciliação — teste explícito de que o histórico/raw
      permanece intacto quando a fotografia atual é reconciliada

## 5. Coordenação de ingestão: lease por Item, Position/History independentes (D11, D15, D16 — supera o PR #12)

- [ ] 5.1 Migration: `radar_pluggy_item_ingestion_leases` (`item_id` único, `trigger`, `lease_until`,
      `acquired_at`); verificar com `npm run migrate` limpo
- [ ] 5.2 `PluggyItemIngestionLeaseRep`: `tryAcquire(itemId, trigger, ttlMs)` (mesmo idioma de
      `UPDATE ... WHERE` de `PluggyWebhookEventRep.claimNextPending`/`markSucceeded` — linhas
      afetadas prova posse) e `release(itemId, token)`; verificar com teste concorrente
      representativo (dois `tryAcquire` para o mesmo item disparados antes de aguardar qualquer um —
      só um consegue) e teste de que um lease vencido é reivindicável por outro trigger
- [ ] 5.3 `infra/worker/pluggy-item-ingestion.ts` (novo — substitui a orquestração ad hoc de
      `load-pluggy-item-in-background.ts` do PR #12): adquire o lease do item; se falhar, loga e
      retorna sem executar nada; se conseguir, executa `syncPluggyPositionInteractor.execute` e
      `loadPluggyHistoryInteractor.execute` de forma independente (D15 — nenhum é condicionado ao
      resultado do outro), captura os dois resultados, libera o lease sempre (`finally`-equivalente,
      mesmo em exceção não tratada), e só então decide sucesso/falha da unidade de trabalho;
      verificar com os cenários da spec `pluggy-ingestion-coordination` (falha de posição não impede
      histórico, falha de histórico não impede posição, exceção inesperada ainda libera o lease)
- [ ] 5.4 `webhook-drainer.ts`: trocar o encadeamento bloqueante (`if (position.error) throw`) e o
      subquery `busyItemIds` interno de `claimNextPending` pelo lease compartilhado de 5.2 (adquirido
      com `trigger = 'WEBHOOK'` antes de marcar o evento `PROCESSING`; falha de aquisição mantém o
      evento `PENDING` e segue para o próximo candidato de item diferente) + a execução independente
      de 5.3; verificar com os cenários de `pluggy-ingestion-coordination` e com a suíte de
      regressão existente de `webhook-drainer.test.ts`
- [ ] 5.5 `RegisterPluggyCredentialInteractor`/handler: trocar a chamada a
      `loadPluggyItemInBackground` (PR #12) por um disparo de `pluggy-item-ingestion.ts` com
      `trigger = 'CREDENTIAL_REGISTRATION_PRELOAD'`; requisito funcional do PR #12 preservado
      (dispara sem bloquear o `201`); verificar com teste que o cadastro dispara a ingestão em
      background e a resposta não espera por ela
- [ ] 5.6 `load-pluggy-history.handler.ts` (rota manual `POST /items/:itemId/history/load`): adquire
      o lease (`trigger = 'MANUAL_HISTORY_LOAD'`) antes de chamar `LoadPluggyHistoryInteractor`
      diretamente no escopo da requisição; falha de aquisição responde
      `{errorType: 'PLUGGY_ITEM_INGESTION_IN_PROGRESS'}` sem tentar History nem Position; sucesso
      mantém o contrato síncrono atual (responde com o resultado de History, dispara Position depois
      via `sync-pluggy-position-in-background.ts`, sob o mesmo lease até a posição concluir);
      verificar com teste que a rota recusa quando o lease já está ocupado, e que libera o lease ao
      final (posição incluída)
- [ ] 5.7 `index.ts` (boot): `BOOT_RECOVERY` continua reclamando leases de evento vencidos
      (`reclaimExpiredLeases`) e leases de item vencidos (5.2); verificar com teste que um lease de
      item preso por um worker morto é recuperável no boot

## 6. Histórico append-only de chamadas, com schema completo (D1, D2, D3, D22, D23, D24, D25)

- [ ] 6.1 Migrations: `radar_pluggy_item_observations` (`item_id` único, `observation_started_at`
      como token de ordenação — D9.1, nunca um `updated_at` de save, condição `>` estrita) e
      `radar_pluggy_calls` com o schema completo de D24 (`id`, `item_id` nullable, `connector_id`
      nullable, `operation`, `http_method` nullable, `route_template` nullable, `call_scope`,
      `trigger` — vocabulário fechado de D23 —, `resource_type` nullable, `resource_id` nullable,
      `request_correlation_id`, `webhook_event_id` nullable, `started_at`, `completed_at`,
      `duration_ms`, `http_status` nullable, `outcome`, `error_code` nullable, `created_at`; índices
      `(item_id, started_at)`, `(item_id, operation, started_at)`, `(connector_id, operation,
      started_at)`, `(trigger, started_at)`, `(request_correlation_id)`, `(webhook_event_id)`);
      verificar com `npm run migrate` limpo
- [ ] 6.2 Entities `PluggyItemObservation` (não-regressão de `observationStartedAt`, condição `>`
      estrita — D9.1) e `PluggyCall` (obrigatórios + enums de `operation`/`call_scope`/`trigger`/
      `outcome`) e seus repositórios, cada um com transação própria, independente da transação de
      negócio do chamador; verificar com teste de contrato, teste de que a escrita sobrevive a um
      rollback do chamador, teste de que uma falha ao persistir gera log de aviso nomeando o erro
      sem lançar para o chamador, e teste de que o resultado da chamada real é devolvido sem esperar
      a tentativa de persistência concluir (D25)
- [ ] 6.3 `infra/tools/call-context.ts` (`AsyncLocalStorage`, `runWithCallContext`/
      `currentCallContext`); verificar com teste que o contexto setado numa chamada não vaza para
      uma chamada concorrente não relacionada
- [ ] 6.4 `adapters/gateways/pluggy-call-instrumentation.ts` (`instrumentPluggyClient`), com tabela
      estática `operação → {callScope, resourceType, argIndex}` cobrindo os métodos reais usados
      pelos 8 gateways de borda **e** `fetchWebhook`/`createWebhook`/`updateWebhook`
      (`PluggyWebhookProvisioner`, D22); nunca grava corpo de requisição/resposta, segredo ou cursor
      opaco (D24) — paginação identificada por `request_correlation_id` + ordinal seguro; verificar
      com teste que cada operação gera exatamente uma linha, com `outcome` correto nos casos de
      sucesso e falha, e teste que nenhum campo proibido aparece persistido
- [ ] 6.5 `PluggyConnectorClient.getApiKey` override em `pluggy-client.gateway.ts`; verificar com
      teste que client novo gera uma linha `AUTH` e que uma segunda chamada com token em cache não
      gera nenhuma
- [ ] 6.6 Aplicar `instrumentPluggyClient` em `PluggyItemCredentialResolver.clientFor` (client
      cacheado), em `RegisterPluggyCredentialImpl.validateItemAccess` (`freshClient`) e em
      `PluggyWebhookProvisioner.provisionFor` (client de `PluggyClientGateway.clientFor`, D22);
      verificar que as três chamadas geram linha em `radar_pluggy_calls` (as duas primeiras com
      `item_id` preenchido, a terceira com `item_id`/`connector_id` nulos e `call_scope =
      PLATFORM_CONFIG`), e que `validateItemAccess` nunca cria nem atualiza linha em
      `radar_pluggy_item_observations` (cenário da spec `pluggy-connection-observability`)
- [ ] 6.7 `runWithCallContext` nos pontos de entrada: `webhook-drainer.ts` (`trigger=WEBHOOK` +
      `webhookEventId`), `index.ts` no boot (`trigger=BOOT_RECOVERY`), `pluggy-item-ingestion.ts`
      (`trigger` recebido do chamador — `CREDENTIAL_REGISTRATION_PRELOAD`, `MANUAL_HISTORY_LOAD` ou
      `WEBHOOK`), `RegisterPluggyCredentialInteractor` em volta de `validateItemAccess`
      (`trigger=CREDENTIAL_REGISTRATION_VALIDATION`) e em volta do provisionamento de webhook
      (`trigger=CREDENTIAL_REGISTRATION_PROVISIONING`), `ReconcilePluggyWebhookImpl`
      (`trigger=WEBHOOK_RECONCILIATION`); verificar com teste que cada trigger aparece correto em
      `radar_pluggy_calls` para cada fluxo

## 7. Estado observado e identidade do connector (D8, D9, D9.1, D18, D19)

- [ ] 7.1 `PluggyItemsGateway.parseItem`: extrair `connector: {id, name, imageUrl, primaryColor,
      products}` do payload (produtos suportados, D19), hoje descartado; verificar com teste que
      `PluggyItemSnapshot.connector` é preenchido a partir de um payload real de `Item`
- [ ] 7.2 `PluggyItemStateResolver` (novo, `.scoped()`, cache por escopo de trabalho, usado só por
      consumidores de item já vinculado — nunca por `validateItemAccess`): `read(itemId)` captura
      `observationStartedAt = new Date()` **antes** de chamar `fetchItem` (D9.1), busca via
      `PluggyItemCredentialResolver` + `PluggyItemsGateway`, e tenta uma **única escrita atômica**
      (D18) que decide aceitar a observação (`incoming.observationStartedAt >
      stored.observationStartedAt` — estritamente maior, empate nunca sobrescreve) e, só se aceita,
      atualiza o connector do vínculo (`connector_id`/`connector_name`/`connector_image_url`/
      `connector_primary_color`/`connector_products`) na mesma transação; segunda chamada no mesmo
      escopo não bate na rede; verificar com teste contando chamadas ao client mockado, teste de que
      uma observação com `observationStartedAt` menor não sobrescreve, teste de que duas observações
      com `observationStartedAt` idêntico não se sobrescrevem mutuamente, e teste de que uma
      observação recusada não atualiza o connector mesmo quando o payload recusado traz connector
      diferente (cenários da spec `pluggy-connection-observability`)
- [ ] 7.3 Trocar `SyncPluggyPositionImpl.readCurrentItemState` e
      `LoadPluggyHistoryImpl.readCurrentItemState` para usar `PluggyItemStateResolver.read`;
      verificar que a suíte de regressão dos dois interactors continua verde sem nenhuma mudança de
      comportamento observável
- [ ] 7.4 Migration: colunas de connector em `radar_pluggy_credential_items` (`connector_id`,
      `connector_name`, `connector_image_url`, `connector_primary_color`, `connector_products` JSON,
      todas nullable); verificar com `npm run migrate` limpo
- [ ] 7.5 `RegisterPluggyCredentialInteractor`/`Impl`: `saveCredentialWithItemLink` passa a receber e
      persistir os campos de connector (incluindo `connector_products`) lidos por
      `validateItemAccess`; verificar com teste que o vínculo criado já nasce com a identidade e os
      produtos do connector
- [ ] 7.6 Tradução `(status, executionStatus) → connectionStatus` (`CONNECTING`, `CONNECTED`,
      `PARTIAL`, `NEEDS_RECONNECT`, `AWAITING_USER_INPUT`, `STALE`, `UNKNOWN`), incluindo
      `WAITING_USER_ACTION`/`MERGING`; verificar com teste de tabela cobrindo os cenários da spec
      `pluggy-connection-observability`

## 8. `GET /credentials/status` com items[] e estado por fonte (D10, D19, D20)

- [ ] 8.1 `CheckPluggyCredentialGateway`: novo método lendo `radar_pluggy_item_observations` +
      `radar_pluggy_credential_items` (connector + `connector_products`) por item vinculado à
      pessoa; tradução de `sources` (D20): `Item.statusDetail` quando `PARTIAL_SUCCESS`, ou
      `{isUpdated: true, lastUpdatedAt: Item.lastUpdatedAt}` para toda fonte suportada quando
      `SUCCESS` (nunca exige `statusDetail`); fonte não suportada pelo connector vira
      `{supported: false}`
- [ ] 8.2 `CheckPluggyCredentialInteractor`/handler: novo shape
      `{hasCredential, items: [{itemId, connectorId, connectorName, connectorImageUrl,
      connectorPrimaryColor, connectionStatus, lastUpdatedAt, nextAutoSyncAt, sources: {accounts,
      transactions, investments, investmentTransactions, loans}}]}`; verificar com os cenários da
      spec `pluggy-credentials` (pessoa com itens em estados diferentes, fonte não contamina outra
      no mesmo item, fonte não suportada aparece marcada, `SUCCESS` não exige `statusDetail`, pessoa
      sem credencial)
- [ ] 8.3 Teste ponta a ponta do cadastro: depois de `POST /credentials`, aguardar a ingestão (seção
      5) e confirmar observação gravada, linhas em `radar_pluggy_calls` com
      `CREDENTIAL_REGISTRATION_VALIDATION`, `CREDENTIAL_REGISTRATION_PROVISIONING` e
      `CREDENTIAL_REGISTRATION_PRELOAD`, e `GET /credentials/status` refletindo o estado correto
      (incluindo `sources`)

## 9. `oplab-radar-front`

- [ ] 9.1 `pluggy-credentials.api.ts`: `PluggyCredentialStatusResponseDto` ganha `items[]` (com
      `sources`); `checkStatus()` devolve o objeto inteiro
- [ ] 9.2 `pluggy-credentials.store.ts`: `items` como novo estado; `register()` chama `checkStatus()`
      ao final, antes de devolver sucesso; verificar com teste de store que, depois de `register()`
      resolver, `items` já reflete a resposta mais recente
- [ ] 9.3 `pluggy-portfolio.store.ts` e `pluggy-card-statement.store.ts`: `fetchList()` dispara
      `usePluggyCredentialsStore().checkStatus()` em paralelo
- [ ] 9.4 Componente/composable `PluggyConnectionBanner`: prioridade
      `NEEDS_RECONNECT`/`AWAITING_USER_INPUT` > `CONNECTING`/`UNKNOWN` > `PARTIAL`/`STALE` > nada,
      usando `sources` para nomear qual produto especificamente está pendente (não só o item
      inteiro); usa `connectorName`/`connectorImageUrl`; verificar com teste de tabela de casos,
      incluindo múltiplos items em estados diferentes e item parcial com fonte específica pendente
- [ ] 9.5 `PluggyPortfolioView.vue` e `PluggyCardStatementView.vue`: usar o banner; lista vazia só
      mostra "Nenhuma posição encontrada" quando a fonte relevante (`investments`/`accounts`) está
      `isUpdated`/suportada e genuinamente vazia — nunca quando a fonte está pendente/recusada;
      verificar com teste de view cobrindo vazio-real vs. vazio-por-sincronização-pendente

## 10. Verificação final

- [ ] 10.1 `radar-pluggy`: `npm run lint` (inclui `tsc --noEmit`) e `npm test` verdes em Docker
- [ ] 10.2 `oplab-radar-front`: `npm run lint`, `npm run type-check`, `npm test` verdes
- [ ] 10.3 `openspec validate arquitetura-observabilidade-sync-pluggy --strict` sem erros
- [ ] 10.4 PR #12 (`feat/pluggy-precarga-cadastro-credencial`): rebaseado sobre a versão final deste
      change ou fechado em favor dela (D11) — decisão registrada no PR que implementa a seção 5
