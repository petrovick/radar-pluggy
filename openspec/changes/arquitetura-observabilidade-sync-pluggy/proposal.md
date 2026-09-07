## Why

Hoje o `radar-pluggy` sabe, por dentro, tudo que a Pluggy relata sobre um Item — `status`,
`executionStatus`, `statusDetail` por produto, `lastUpdatedAt`, `nextAutoSyncAt`, `connector` — mas
descarta a maior parte disso antes de qualquer decisão de negócio. `radar_pluggy_items` só grava
depois de um ciclo de sincronização inteiro e bem-sucedido, então quando a conexão de um titular
quebra (`LOGIN_ERROR`, `WAITING_USER_INPUT`) nenhuma linha é atualizada e `GET /credentials/status`
continua respondendo o mesmo booleano de sempre. O titular cadastra a credencial, o pré-carregamento
tenta sincronizar, e se a Pluggy ainda não terminou (ou nunca vai terminar sem ação do titular), a
Carteira e o Cartão mostram "nenhuma posição encontrada" — indistinguível de uma conta genuinamente
vazia.

Ao mesmo tempo, não existe nenhum registro de quais chamadas o `radar-pluggy` realmente fez à
Pluggy — nem para auditoria, nem para detectar frequência anômala, nem para saber se uma falha foi
isolada ou sistemática. O portão de sincronização de posição/histórico é uma marca d'água única por
Item: quando um produto é recusado por limite operacional e outro não, não existe hoje um jeito de
re-tentar só o produto recusado sem depender de o Item inteiro mudar de novo. E, revisando contra o
código real de `staging` — não só contra o desenho em texto —, apareceram mais cinco problemas que
esta revisão fecha juntos, porque todos afetam a mesma orquestração:

- **Position e History se bloqueiam um ao outro hoje**, tanto no drenador de webhook
  (`webhook-drainer.ts`) quanto no worker de pré-carga (PR #12): se a sincronização de posição falha,
  a carga de histórico nem começa — um problema em `investments` já impede o Cartão de atualizar,
  mesmo que `accounts`/`transactions` estejam saudáveis.
- **Três pontos de entrada disparam Position/History sem nenhuma serialização compartilhada**: o
  drenador de webhook usa lease por item; o pré-carregamento do cadastro (PR #12) e a rota manual
  `POST /items/:itemId/history/load` (já em `staging`) chamam os dois interactors direto, em escopo
  próprio, sem tocar o lease do webhook. Hoje é possível os três rodarem ao mesmo tempo para o mesmo
  Item.
- **As marcas d'água atuais (`radar_pluggy_items`, `radar_pluggy_history_sync_states`,
  `radar_pluggy_history_coverage`) são escritas sem condição atômica** — leem, validam em memória e
  gravam sem `WHERE` que proteja contra uma segunda execução concorrente lendo a mesma versão antiga.
- **A sincronização de posição trata lista vazia como erro incondicionalmente**
  (`PLUGGY_INVESTMENTS_EMPTY_WITH_SUCCESS_STATUS`), mesmo depois de já ter confirmado consentimento
  ativo — o que impede representar "o titular vendeu tudo" e não reconcilia a fotografia atual
  quando um investimento ou empréstimo deixa de existir na Pluggy.
- **A premissa original desta proposta sobre `Item.statusDetail` estava errada**: a documentação da
  Pluggy e o próprio `.d.ts` do SDK instalado mostram `statusDetail: null` quando `executionStatus`
  é `SUCCESS` — só existe quando é `PARTIAL_SUCCESS`. Um watermark por fonte não pode depender de um
  campo que não existe na maioria das execuções. `Item.lastUpdatedAt` também é nullable mesmo em
  `SUCCESS` — a documentação oficial traz esse exemplo real.
- **`Connector.products` (o que a instituição suporta) não é o mesmo que os produtos habilitados
  neste Item específico** (`Item.products`, confirmado no OpenAPI/documentação atual, embora ausente
  do `.d.ts` do SDK instalado): um Item pode ser criado só com `ACCOUNTS`/`TRANSACTIONS` mesmo que o
  connector suporte `INVESTMENTS`. Tratar os dois como a mesma coisa faria o serviço chamar
  `GET /investments` para itens que nunca pediram esse produto, e poderia mostrar "vazio real" para
  uma fonte que na verdade nunca foi solicitada.
- **O lease de ingestão (planejado na rodada anterior) tinha TTL sem renovação**: uma carga de
  histórico longa poderia ultrapassar o prazo do lease, permitindo duas ingestões simultâneas do
  mesmo Item — exatamente o que a capability promete impedir.
- **O drenador de webhook ignora todo evento exceto `item/created`/`item/updated`**, mas a inscrição
  já pede `event: 'all'`. Um `item/error` (a Pluggy documenta que ele para o auto-sync daquele Item)
  nunca atualiza o estado observado — o titular pode continuar vendo `CONNECTED` depois de uma
  quebra real, e um `item/deleted` (a Pluggy pode emitir automaticamente, por exemplo por
  depreciação de connector) não tem nenhum tratamento — o Item apagado continuaria contribuindo
  fotografia para Carteira/Cartão.

## Dependência: PR #12

Este change pressupõe o requisito funcional do PR #12 (`feat/pluggy-precarga-cadastro-credencial`,
aberto, não mergeado): cadastro de credencial dispara pré-carga de posição e histórico sem bloquear o
`201`. Esse requisito continua. **O arquivo que o PR #12 introduz
(`infra/worker/load-pluggy-item-in-background.ts`) não é definitivo** — ele encadeia Position→History
com a mesma falha estrutural do drenador de webhook (History só roda se Position tiver sucesso) e não
usa nenhum lease compartilhado. A implementação deste change reescreve esse arquivo para usar a
coordenação de ingestão descrita abaixo (`pluggy-ingestion-coordination`); não faz sentido mergear o
PR #12 como está e alterá-lo logo em seguida — `/opsx:apply` trata a versão final como a que nasce
aqui, e o PR #12 é rebaseado ou substituído no momento da implementação.

## What Changes

- Passa a existir um **estado observado** por Item (`radar_pluggy_item_observations`), atualizado em
  todo `fetchItem` válido de um Item **já vinculado** a uma credencial, independente de a
  sincronização ter tido sucesso. A leitura de validação pré-vínculo (`validateItemAccess`, antes de
  o cadastro persistir) não escreve aqui — só gera registro em `radar_pluggy_calls`; não existe
  credencial↔item ainda para associar a observação. Aceitar uma observação (por `observationStartedAt`,
  D9.1) e atualizar o connector do vínculo é a **mesma decisão atômica**: observação recusada nunca
  deixa o connector ser sobrescrito por um payload mais antigo.
- `GET /credentials/status` mantém `hasCredential` e passa a devolver, também, por item vinculado,
  um `connectionStatus` de Item (agora incluindo `DISCONNECTED`, para item removido pela Pluggy)
  **e o estado de cada fonte** (`sources`: `supportedByConnector` — capability da instituição —,
  `enabledForItem` — produto habilitado neste Item específico, distinto do anterior, podendo ser
  desconhecido — e, só quando habilitado, `isUpdated`/`lastUpdatedAt`) mais `lastUpdatedAt`,
  `nextAutoSyncAt` e a identidade do connector (incluindo os produtos que ele suporta), num novo
  campo `items[]`. **Aditivo, não breaking**: o `oplab-radar-front` hoje só lê
  `response.hasCredential` (`pluggy-credentials.api.ts`) e esse campo continua no mesmo lugar, com o
  mesmo tipo — o backend pode publicar antes do front, sem deploy coordenado. O front passa a
  consumir `items[]` depois, quando o PR próprio dele for feito.
- Passa a existir um **histórico append-only de chamadas** à Pluggy (`radar_pluggy_calls`), com
  schema completo (item, connector, operação, rota, escopo, origem, correlação, ordinal de página,
  tempos, resultado com taxonomia de falha — nunca corpo de requisição/resposta nem segredo nem
  cursor opaco), classificado por `call_scope` e por `trigger` de origem — incluindo o evento real de
  autenticação (`POST /auth`) e o provisionamento de webhook (`PluggyWebhookProvisioner`, hoje fora
  de qualquer instrumentação planejada), interceptados no ponto exato onde o SDK os dispara. Quem
  grava é um serviço singleton (`PluggyCallRecorder`), explícito por DI — nunca um repositório
  escondido dentro do contexto assíncrono que carrega só `trigger`/correlação/ordinal. A gravação é
  sempre uma tentativa best-effort **depois** de a chamada real terminar — nunca no caminho crítico
  da chamada de negócio.
- A marca d'água de sincronização deixa de ser só por Item — passa a existir por **consumidor e por
  fonte real dentro do Item** (`radar_pluggy_sync_progress`): `POSITION_SYNC` acompanha `INVESTMENTS`
  e `LOANS`; `HISTORY_LOAD` acompanha `ACCOUNTS`, `ACCOUNT_TRANSACTIONS`, `INVESTMENTS` e
  `INVESTMENT_TRANSACTIONS`. O campo armazenado (`last_completed_version_at`) representa "até qual
  versão da execução aquele consumidor concluiu aquela fonte" — `Item.lastUpdatedAt` quando
  `executionStatus` é `SUCCESS` (`statusDetail` é `null` neste caso; se `lastUpdatedAt` também for
  `null`, usa `Item.updatedAt`, não-nullable), ou `statusDetail.<fonte>.lastUpdatedAt` quando
  `PARTIAL_SUCCESS` e a fonte tiver `isUpdated === true` (uma fonte `isUpdated === true` sem
  `lastUpdatedAt` é resposta inconsistente — recusa nomeada, nunca inventa valor).
  `ACCOUNT_TRANSACTIONS` depende de `ACCOUNTS` estar utilizável na mesma execução (não dá pra
  declarar transações completas sem a lista atual de contas); mesma relação entre
  `INVESTMENT_TRANSACTIONS` e `INVESTMENTS`. Nenhuma fonte é elegível se não estiver habilitada para
  o Item (`enabledForItem`, distinto de o connector suportá-la). `CASH` (`ACCOUNTS` e
  `ACCOUNT_TRANSACTIONS`) e `CUSTODY` (`INVESTMENTS` e `INVESTMENT_TRANSACTIONS`), ambos do
  consumidor `HISTORY_LOAD`, continuam sendo só agrupamentos de elegibilidade, nunca marca d'água
  própria. `INVESTMENTS` é acompanhada pelos dois consumidores, cada um com sua própria linha — um
  avançar nunca avança o do outro.
- **Position e History passam a rodar de forma independente**: cada um executa, tem seu resultado
  capturado, e só depois a unidade de trabalho decide sucesso/falha. Falha de um nunca impede o outro
  de sequer tentar; a próxima tentativa é barata para quem já concluiu, porque a marca d'água própria
  fecha o portão sem repetir trabalho.
- **Nasce um lease de ingestão por Item**, compartilhado por todo trigger que dispara Position+History
  (`WEBHOOK`, `CREDENTIAL_REGISTRATION_PRELOAD`, `BOOT_RECOVERY`, `MANUAL_HISTORY_LOAD`) — MySQL, sem
  Redis, mesmo idioma de claim atômico já usado pelo lease de evento de webhook
  (`PluggyWebhookEventRep`), com token de posse monotônico (nunca timestamp) e renovação periódica
  (heartbeat) enquanto o trabalho estiver em andamento, para uma carga longa não deixar o lease
  expirar sozinho. O lease evita trabalho duplicado; a integridade do dado nunca depende só dele —
  a escrita atômica de marca d'água/observação é quem garante isso mesmo numa sobreposição residual.
- **Eventos de webhook além de `item/created`/`item/updated` passam a ser tratados**: `item/error`,
  `item/waiting_user_input`, `item/waiting_user_action` e `item/login_succeeded` atualizam o estado
  observado (sem rodar Position/History); `item/deleted` marca o vínculo credencial↔item inativo,
  sem tentar reler o Item — `connectionStatus` vira `DISCONNECTED`, e o Item para de contribuir
  fotografia para `/portfolio`/`/accounts`, preservando snapshot/raw histórico.
- **Produtos habilitados no Item (`itemProducts`) passam a ser distintos dos suportados pelo
  connector (`connectorProducts`)**: uma fonte que o connector suporta mas que este Item não pediu
  nunca é tratada como elegível por nenhum pipeline, nem aparece como "atualizada" em
  `/credentials/status`. Quando o payload não permitir saber os produtos do Item, o estado fica
  `UNKNOWN` — nunca inferido da capability do connector.
- Corrige três divergências encontradas entre o código e o SDK realmente instalado
  (`pluggy-sdk@^0.90.0`): a chave `statusDetail.investmentTransactions` (o código lia
  `investmentsTransactions`, no plural, e nunca batia), os status de Item `WAITING_USER_ACTION` e
  `MERGING` (ausentes do conjunto validado) e a lista de produtos reconhecida em `statusDetail`
  (faltava `loans`).
- O `connector` (identidade da instituição, **agora incluindo os produtos que ela suporta**)
  embutido em todo `GET /items/{id}` passa a ser capturado e persistido no vínculo credencial↔item —
  no cadastro, e também em toda observação subsequente do Item aceita (D9.1/D18): sempre que um Item
  válido trouxer connector, a identidade conhecida do vínculo é atualizada. Isso preenche vínculos
  legados com `connector_id = null` e reflete futura mudança de metadata na Pluggy — sem chamada
  extra a `GET /connectors/{id}`, sempre a partir do `connector` já embutido no payload do Item.
- Uma leitura de fonte **utilizável e completa** (investimentos, empréstimos, contas) volta a ser
  autoritativa mesmo quando devolve lista vazia: o titular pode legitimamente não ter mais nenhuma
  posição, e a fotografia local reconcilia — registros que não vieram mais na leitura atual deixam de
  pertencer à fotografia corrente. Fonte recusada (não utilizável) nunca toca dado existente.
  Snapshot/raw history continuam auditoria, nunca reconciliados.
- O vocabulário de domínio deixa de usar `limitedByRateLimit` para o que na verdade é
  `isUpdated === false` — pode ser rate limit ou outro motivo; o campo de domínio passa a se chamar
  `isUsable`/`wasCollected` (ver design). Warnings continuam observabilidade, nunca decisão de
  negócio.
- A carga inicial que já dispara após `POST /credentials` (sem mudar de pipeline) passa a alimentar o
  estado observado e o histórico de chamadas, e a validação de credencial nova (pré-persistência)
  passa a ser registrada no histórico de chamadas com `trigger` próprio.
- `oplab-radar-front`: a store de credenciais consome o novo shape de `/credentials/status`
  (re-consultado imediatamente após o `201` do cadastro); Carteira e Cartão passam a distinguir
  "ainda sincronizando" / "conexão precisa de ação" de "genuinamente vazio", usando a identidade da
  instituição e o estado por fonte para nomear qual conexão/produto precisa de atenção.

## Capabilities

### New Capabilities
- `pluggy-sync-progress`: marca d'água por Item, **por consumidor** (`POSITION_SYNC`,
  `HISTORY_LOAD`) **e por fonte real** (`ACCOUNTS`, `ACCOUNT_TRANSACTIONS`, `INVESTMENTS`,
  `INVESTMENT_TRANSACTIONS`, `LOANS`) — cada combinação avança e é re-tentada de forma independente,
  respeitando a dependência de `ACCOUNT_TRANSACTIONS`/`INVESTMENT_TRANSACTIONS` na fonte de
  descoberta correspondente; `CASH`/`CUSTODY` são só agrupamento de elegibilidade.
- `pluggy-connection-observability`: último estado observado da conexão de um Item já vinculado
  (status bruto da Pluggy, produto a produto, produtos habilitados no próprio Item — distintos dos
  suportados pelo connector —, e a tradução para o vocabulário de conexão, incluindo `DISCONNECTED`
  para item removido pela Pluggy), capturado em toda leitura válida do Item — inclusive eventos de
  webhook além de `item/created`/`item/updated` —, com aceitação de observação e atualização de
  connector decididas atomicamente.
- `pluggy-call-history`: registro append-only de toda chamada que o `radar-pluggy` faz à Pluggy —
  autenticação, leitura de snapshot, configuração de plataforma (incluindo provisionamento de
  webhook) — com classificação, origem, resultado com taxonomia de falha e schema completo (incluindo
  ordinal de página), sem funcionar como lock, lease ou contador de quota.
- `pluggy-ingestion-coordination`: garante no máximo uma ingestão (Position+History) por Item
  executando por vez, qualquer que seja o trigger (lease com token de posse monotônico e renovação
  periódica), e que Position e History dentro de uma mesma ingestão rodem de forma independente —
  falha de um nunca impede o outro de ser tentado.

### Modified Capabilities
- `pluggy-item`: `status` passa a aceitar o conjunto completo documentado pelo SDK instalado
  (inclui `WAITING_USER_ACTION` e `MERGING`); o registro ganha identidade de connector
  (`connectorId`, `connectorName`, `connectorImageUrl`, `connectorPrimaryColor`, `connectorProducts`
  — capability da instituição), capturada no cadastro e atualizada em toda observação subsequente
  aceita do Item; os produtos habilitados **deste Item** (`itemProducts`, distintos de
  `connectorProducts`) passam a ser observados e persistidos separadamente.
- `pluggy-position-sync`: a sincronização passa a poder avançar com `executionStatus`
  `PARTIAL_SUCCESS`, processando `investments`/`loans` de forma independente por fonte (usando
  `isUsable`, não `limitedByRateLimit`), nunca para uma fonte não habilitada para o Item; o portão de
  entrada some do nível de Item para o nível de fonte; lista vazia de uma fonte utilizável deixa de
  ser erro incondicional — passa a reconciliar a fotografia atual (remove o que não veio mais),
  preservando a recusa nomeada só quando a fonte não foi de fato tentada; item inativo
  (`item/deleted`) para de contribuir posição para `GET /portfolio`.
- `pluggy-transaction-history`: o portão de "atualização diária reativa" passa do nível de Item para
  o nível de fonte real, com a dependência formal de `ACCOUNT_TRANSACTIONS`/`INVESTMENT_TRANSACTIONS`
  na respectiva fonte de descoberta; `Account.updatedAt`/`Investment.updatedAt` deixam de ser
  condição necessária para decidir se uma fonte de transação é varrida — viram, no máximo, otimização
  documentada; "produto limitado não é vazio" passa a se basear em `isUsable`; leitura de contas
  reconcilia a fotografia atual do mesmo jeito que posição; item inativo (`item/deleted`) para de
  contribuir contas para `GET /accounts`.
- `pluggy-credentials`: `GET /credentials/status` passa a expor conexão (incluindo `DISCONNECTED`) e
  estado por fonte por item vinculado — distinguindo `supportedByConnector` de `enabledForItem` —
  não só um booleano e um status agregado; o cadastro passa a capturar e persistir a identidade e os
  produtos do connector do item; a validação de credencial nova (antes do vínculo existir) passa a
  ser registrada no histórico de chamadas.

## Impact

- **Código afetado, `radar-pluggy`**: novo `pluggy-source-catalog.ts` (tradução central
  `ProductType`↔`statusDetail`↔`PluggySource`), `PluggyItemsGateway` (parse de `connector`+produtos
  do connector e do Item, `updatedAt` obrigatório, correção de chave `investmentTransactions`,
  adição de `loans`), `PluggyItem` (enum de status), `PluggyClientGateway`/`PluggyConnectorClient`
  (override de `getApiKey`, recebe `PluggyCallRecorder`), novo `PluggyCallRecorder` (serviço
  singleton, DI explícito), `PluggyWebhookProvisioner` (instrumentação, hoje descoberta),
  `PluggyItemCredentialResolver` (instrumentação de chamadas), `RegisterPluggyCredentialImpl`/
  `Interactor` (captura de connector, instrumentação da validação), `PluggyWebhookEvent`
  (categorização de evento além de `isApplicable`), `SyncPluggyPositionInteractor`/`Impl`
  (`PARTIAL_SUCCESS` por fonte, gate por `itemProducts`, reconciliação de fotografia, escrita
  atômica), `LoadPluggyHistoryInteractor`/`Impl` (portão por fonte, dependência entre fontes, fim do
  gate por `updatedAt` de recurso, reconciliação de contas), `PluggyItemRep`/
  `PluggyHistorySyncStateRep`/`PluggyHistoryCoverageRep` (escrita condicional atômica), novo
  `PluggyItemIngestionLeaseRep` (lease com fencing token e renovação), `webhook-drainer.ts`
  (Position/History independentes, `trigger` explícito por parâmetro, lease de item compartilhado,
  substitui o `busyItemIds` ad hoc, categoriza eventos além de `FULL_INGESTION`), novo
  `infra/worker/pluggy-item-ingestion.ts` (substitui o desenho do PR #12),
  `load-pluggy-history.handler.ts`/rota manual (adquire o mesmo lease, contexto único cobrindo
  History síncrono e Position em background), `CheckPluggyCredentialInteractor`/handler (novo shape
  com `sources` distinguindo `supportedByConnector`/`enabledForItem`), `PluggyPersonItemResolver`
  (exclui item inativo), sete migrations novas e uma remoção (`radar_pluggy_history_sync_states` dá
  lugar a `radar_pluggy_sync_progress`, sem dado real a migrar — tabela vazia em produção/dev hoje).
- **Contrato HTTP**: `GET /credentials/status` ganha o campo `items[]`, aditivo — `hasCredential`
  mantém shape e posição, o consumidor atual continua funcionando sem alteração. Permite rollout
  backend-first, sem deploy coordenado obrigatório com o front. `POST /credentials`, `GET /portfolio`,
  `GET /accounts`, `POST /items/:itemId/history/load` e demais rotas não mudam de contrato externo
  (a rota manual passa a poder responder "sincronização já em andamento" quando o lease de item
  estiver ocupado — novo `errorType`, mesma forma `{errorType, extras}` já usada em toda a API).
- **`oplab-radar-front`**: `pluggy-credentials.api.ts`/`.store.ts` (passam a ler `items[]`, além de
  `hasCredential`), novo componente/composable de banner de conexão por fonte, `PluggyPortfolioView.vue`
  e `PluggyCardStatementView.vue` (regra de vazio real vs. sincronizando, por fonte). PR próprio,
  publicado depois do backend — não faz parte deste change do `radar-pluggy`.
- **PR #12**: superado por este change (ver seção "Dependência: PR #12" acima) — o requisito
  funcional permanece, a implementação nasce já na forma final.
- **Sem novas dependências de infraestrutura**: continua MySQL/Sequelize, sem Redis, sem scheduler,
  sem retry customizado — nenhuma decisão revogada em `ADR-radar-pluggy-open-finance-consumo-sincronizacao.md`
  é reaberta por este change. O lease de ingestão por Item é MySQL puro, mesmo idioma do lease de
  evento de webhook já existente.
