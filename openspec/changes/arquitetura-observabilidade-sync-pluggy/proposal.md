## Why

Hoje o `radar-pluggy` sabe, por dentro, tudo que a Pluggy relata sobre um Item — `status`,
`executionStatus`, `statusDetail` por produto, `lastUpdatedAt`, `nextAutoSyncAt`, `connector` — mas
descarta a maior parte disso antes de qualquer decisão de negócio. `radar_pluggy_items` só grava
depois de um ciclo de sincronização inteiro e bem-sucedido, então quando a conexão de um titular
quebra (`LOGIN_ERROR`, `WAITING_USER_INPUT`) nenhuma linha é atualizada e `GET /credentials/status`
continua respondendo o mesmo booleano de sempre. O titular cadastra a credencial, o pré-carregamento
já existente tenta sincronizar, e se a Pluggy ainda não terminou (ou nunca vai terminar sem ação do
titular), a Carteira e o Cartão mostram "nenhuma posição encontrada" — indistinguível de uma conta
genuinamente vazia.

Ao mesmo tempo, não existe nenhum registro de quais chamadas o `radar-pluggy` realmente fez à
Pluggy — nem para auditoria, nem para detectar frequência anômala, nem para saber se uma falha foi
isolada ou sistemática. E o portão de sincronização de posição/histórico é uma marca d'água única
por Item: quando um produto é recusado por limite (rate limit) e outro não, não existe hoje um jeito
de re-tentar só o produto recusado sem depender de o Item inteiro mudar de novo.

## What Changes

- Passa a existir um **estado observado** por Item (`radar_pluggy_item_observations`), atualizado em
  todo `fetchItem` válido, independente de a sincronização ter tido sucesso.
- `GET /credentials/status` deixa de responder só `hasCredential` — passa a devolver, por item
  vinculado, um `connectionStatus` (`CONNECTING`, `CONNECTED`, `PARTIAL`, `NEEDS_RECONNECT`,
  `AWAITING_USER_INPUT`, `STALE`, `UNKNOWN`) mais `lastUpdatedAt`, `nextAutoSyncAt` e a identidade do
  connector (`connectorId`, `connectorName`, `connectorImageUrl`, `connectorPrimaryColor`).
  **BREAKING** para quem depende do shape anterior de `PluggyCredentialStatusResponseDto`.
- Passa a existir um **histórico append-only de chamadas** à Pluggy (`radar_pluggy_calls`),
  classificado por `call_scope` (`AUTH`, `SNAPSHOT_READ`, `PLATFORM_CONFIG`, `ITEM_SYNC_TRIGGER`,
  `DIRECT_INSTITUTION`, `UNKNOWN`) e por `trigger` de origem, incluindo o evento real de autenticação
  (`POST /auth`), interceptado no ponto exato onde o SDK o dispara — não simulado a partir de outra
  chamada.
- A marca d'água de sincronização deixa de ser só por Item — passa a existir também por
  **produto dentro do Item** (`radar_pluggy_product_sync_states`), usada tanto pela sincronização de
  posição (`INVESTMENTS`, `LOANS`) quanto pela carga de histórico (`CASH`, `CUSTODY`). Um produto
  recusado por limite operacional é re-tentado assim que o `lastUpdatedAt` daquele produto
  especificamente avançar — não fica pendurado esperando o Item inteiro mudar.
- `radar_pluggy_items` mantém, sem reinterpretação, o significado já fixado: avança se e somente se
  `executionStatus === 'SUCCESS'`. Nunca avança em `PARTIAL_SUCCESS`.
- A sincronização de posição passa a aceitar `PARTIAL_SUCCESS` e processar `investments`/`loans`
  independentemente, usando `isUpdated` (não mais o código do `warning`) para decidir se um produto
  foi de fato coletado nesta execução — mesma decisão aplicada à carga de histórico, sem duas
  semânticas concorrentes.
- Corrige três divergências encontradas entre o código e o SDK realmente instalado
  (`pluggy-sdk@^0.90.0`): a chave `statusDetail.investmentTransactions` (o código lia
  `investmentsTransactions`, no plural, e nunca batia), os status de Item `WAITING_USER_ACTION` e
  `MERGING` (ausentes do conjunto validado) e a lista de produtos reconhecida em `statusDetail`
  (faltava `loans`).
- O `connector` (identidade da instituição) embutido em todo `GET /items/{id}` passa a ser capturado
  e persistido no vínculo credencial↔item, no momento do cadastro — hoje é lido e descartado.
- A carga inicial que já dispara após `POST /credentials` (sem mudar de pipeline) passa a alimentar o
  estado observado e o histórico de chamadas, e a validação de credencial nova
  (pré-persistência) passa a ser registrada no histórico de chamadas com `trigger` próprio.
- `oplab-radar-front`: a store de credenciais consome o novo shape de `/credentials/status`
  (re-consultado imediatamente após o `201` do cadastro); Carteira e Cartão passam a distinguir
  "ainda sincronizando" / "conexão precisa de ação" de "genuinamente vazio", usando a identidade da
  instituição para nomear qual conexão precisa de atenção.

## Capabilities

### New Capabilities
- `pluggy-product-sync-state`: marca d'água de sincronização por Item **e por produto**, usada pela
  sincronização de posição e pela carga de histórico — cada produto avança e é re-tentado de forma
  independente.
- `pluggy-connection-observability`: último estado observado da conexão de um Item (status bruto da
  Pluggy, produto a produto, e a tradução para o vocabulário de conexão que o produto consome), capturado
  em toda leitura válida do Item, independente de sincronização ter ocorrido.
- `pluggy-call-history`: registro append-only de toda chamada que o `radar-pluggy` faz à Pluggy —
  autenticação, leitura de snapshot, configuração de plataforma — com classificação, origem e
  resultado, sem funcionar como lock, lease ou contador de quota.

### Modified Capabilities
- `pluggy-item`: `status` passa a aceitar o conjunto completo documentado pelo SDK instalado
  (inclui `WAITING_USER_ACTION` e `MERGING`); o registro ganha identidade de connector
  (`connectorId`, `connectorName`, `connectorImageUrl`, `connectorPrimaryColor`).
- `pluggy-position-sync`: a sincronização passa a poder avançar com `executionStatus` `PARTIAL_SUCCESS`,
  processando `investments`/`loans` de forma independente por produto; o portão de entrada some do
  nível de Item para o nível de produto; a recusa de lista vazia com portão aberto só se aplica ao
  produto que foi de fato tentado.
- `pluggy-transaction-history`: o portão de "atualização diária reativa" passa do nível de Item para
  o nível de produto (`CASH`/`CUSTODY`); "produto limitado não é vazio" passa a se basear em
  `isUpdated`, não no código do `warning`.
- `pluggy-credentials`: `GET /credentials/status` passa a expor conexão por item vinculado (não só
  um booleano); o cadastro passa a capturar e persistir a identidade do connector do item; a
  validação de credencial nova (antes do vínculo existir) passa a ser registrada no histórico de
  chamadas.

## Impact

- **Código afetado, `radar-pluggy`**: `PluggyItemsGateway` (parse de `connector`, correção de chave
  `investmentTransactions`, adição de `loans`), `PluggyItem` (enum de status), `PluggyClientGateway`/
  `PluggyConnectorClient` (override de `getApiKey`), `PluggyItemCredentialResolver` (instrumentação de
  chamadas), `RegisterPluggyCredentialImpl`/`Interactor` (captura de connector, instrumentação da
  validação), `SyncPluggyPositionInteractor`/`Impl` (PARTIAL_SUCCESS por produto), `LoadPluggyHistoryInteractor`/
  `Impl` (portão por produto), `CheckPluggyCredentialInteractor`/handler (novo shape),
  três migrations novas e uma remoção (`radar_pluggy_history_sync_states` dá lugar a
  `radar_pluggy_product_sync_states`, sem dado real a migrar — tabela vazia em produção/dev hoje).
- **Contrato HTTP**: `GET /credentials/status` muda de shape (breaking para o consumidor atual).
  `POST /credentials`, `GET /portfolio`, `GET /accounts` e demais rotas não mudam de contrato.
- **`oplab-radar-front`**: `pluggy-credentials.api.ts`/`.store.ts` (novo DTO), novo componente/composable
  de banner de conexão, `PluggyPortfolioView.vue` e `PluggyCardStatementView.vue` (regra de vazio real
  vs. sincronizando). PR próprio, coordenado por contrato — não faz parte deste change do
  `radar-pluggy`.
- **Sem novas dependências de infraestrutura**: continua MySQL/Sequelize, sem Redis, sem scheduler,
  sem retry customizado — nenhuma decisão revogada em `ADR-radar-pluggy-open-finance-consumo-sincronizacao.md`
  é reaberta por este change.
