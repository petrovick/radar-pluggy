## Context

Ver `proposal.md` (Why) para a motivação. Este documento assume como pano de fundo:

- O `radar-pluggy` usa MySQL/Sequelize, Awilix como DI, e `pluggy-sdk@^0.90.0` (o SDK instalado, não
  a documentação textual, foi a fonte usada para decisões de shape de payload — ver Decisões).
- Toda chamada de borda à Pluggy passa por `pluggy-sdk`'s `PluggyClient`/`BaseApi`. Um único ponto
  cacheia instâncias de client por `clientId` (`PluggyClientGateway`, singleton) e um único ponto
  resolve "qual client uso pra este item" (`PluggyItemCredentialResolver`, scoped por unidade de
  trabalho — request HTTP, evento de webhook, disparo manual). `PluggyWebhookProvisioner` **não**
  passa por esse resolver: pega o client direto de `PluggyClientGateway.clientFor` para
  `fetchWebhook`/`createWebhook`/`updateWebhook` — achado desta revisão, ver D23.
- Hoje existem **três** pontos de entrada que disparam `SyncPluggyPositionInteractor` +
  `LoadPluggyHistoryInteractor` para o mesmo Item, e só um deles serializa por item:
  - `webhook-drainer.ts` (em `staging`): reivindica evento com lease (`PluggyWebhookEventRep`,
    `claimNextPending`/`markSucceeded`/`releaseToPending`, serializado por `item_id` via subquery de
    `busyItemIds`), chama Position e, **só se `position.error` for falso**, chama History.
  - `infra/worker/load-pluggy-item-in-background.ts` (PR #12, aberto, não mergeado): mesmo
    encadeamento Position→History bloqueante, escopo próprio, **sem tocar o lease do webhook**.
  - `POST /items/:itemId/history/load` (`load-pluggy-history.handler.ts`, em `staging`): roda History
    de forma síncrona no escopo da própria requisição HTTP (responde com o resultado), e dispara
    Position depois, em background, via `sync-pluggy-position-in-background.ts` — **também sem lease
    nenhum**.
  Isto é: o mecanismo de lease existe e funciona, mas só protege o caminho de webhook. Os outros dois
  já podem colidir com ele e entre si, em `staging`, hoje.
- Os repositórios que escrevem marca d'água (`PluggyItemRep.save`, `PluggyHistorySyncStateRep.save`,
  `PluggyHistoryCoverageRep.save`) seguem todos o mesmo formato: `findOrCreate` (lê ou cria) seguido
  de `row.update(...)` incondicional — sem `WHERE` que compare a versão sendo escrita com a versão já
  persistida. É uma leitura-decide-escreve em três passos, não uma escrita atômica.
- `node_modules/pluggy-sdk/dist/types/item.d.ts` documenta, no próprio comentário do campo:
  `/** If status is 'PARTIAL_SUCCESS', this field will provide more detailed info... */
  statusDetail: ItemProductsStatusDetail | null` — confirmado também pela documentação oficial da
  Pluggy consultada nesta revisão: `statusDetail` é `null` quando `executionStatus` é `SUCCESS`.
- `node_modules/pluggy-sdk/dist/types/connector.d.ts` mostra `Connector.products: ProductType[]` —
  já embutido no mesmo payload de `Item.connector`, sem chamada extra.
- `SyncPluggyPositionInteractor.execute` (já em `staging`) trata `allInvestments.length === 0` como
  erro incondicional (`PLUGGY_INVESTMENTS_EMPTY_WITH_SUCCESS_STATUS`) — **depois** de já ter
  confirmado `consentStatus.kind === 'ACTIVE'` alguns passos antes. `PluggyPositionRep`/
  `PluggyPositionSnapshotRep`/`PluggyLoanRep` só fazem upsert por chave natural — nenhum passo remove
  da fotografia atual um investimento/empréstimo que não veio mais numa leitura completa.
- Os bancos de desenvolvimento consultados neste change não têm nenhuma linha real em
  `radar_pluggy_item_raw`, `radar_pluggy_items` nem `radar_pluggy_history_sync_states` — as decisões
  de schema abaixo partem dessa ausência de dado real a migrar.

## Goals / Non-Goals

**Goals:**
- Tornar observável, sem inventar mecanismo de quota, o estado de conexão de cada Item e todo
  esforço que o serviço faz contra a Pluggy.
- Corrigir a marca d'água de sincronização para não perder fontes recusadas por limite operacional,
  sem reinterpretar o significado já fixado de `radar_pluggy_items`, e sem depender de uma premissa
  falsa sobre `statusDetail`.
- Garantir que Position e History nunca se bloqueiem, e que no máximo uma ingestão por Item rode por
  vez, qualquer que seja o trigger.
- Tornar toda escrita de marca d'água/observação atômica no banco, não dependente de leitura prévia
  em memória.
- Corrigir a semântica de lista vazia (reconexão vs. genuinamente vazio) e reconciliar a fotografia
  atual contra a última leitura autoritativa.
- Fechar, nesta mesma decisão, divergências reais entre o código e o SDK instalado que afetam
  diretamente a correção do que está sendo desenhado aqui.

**Non-Goals:**
- Não reintroduz controle de quota Open Finance, Admission Control, scheduler ou budget por página —
  decisões já revogadas em `ADR-radar-pluggy-open-finance-consumo-sincronizacao.md` continuam
  revogadas.
- Não adiciona Redis, cron, nem retry customizado.
- Não estrutura `radar_pluggy_calls` como fonte de quota restante — é auditoria, não contador.
- Não decide a UI final do `oplab-radar-front` além do contrato de dados e das regras de qual
  mensagem aparece em qual estado — o desenho visual fica com quem implementa a view.
- Não redesenha o contrato de resposta síncrona de `POST /items/:itemId/history/load` além de
  acrescentar a recusa por lease ocupado — continua respondendo o resultado de History.

## Decisions

### D1 — Autenticação é observada via override de `getApiKey`, nunca via Proxy de método
`node_modules/pluggy-sdk/dist/baseApi.js` mostra que `createGetRequest`/`createMutationRequest`
chamam `this.getApiKey()` internamente, no `this` do objeto real — nunca no de um wrapper externo.
Um `Proxy` em volta do client intercepta `client.fetchItem(...)` de fora, mas o corpo real de
`fetchItem` roda com `this` apontando pro objeto cru, e a chamada interna a `getApiKey()` nunca passa
pelo `get` trap desse Proxy. `getApiKey`/`apiKey`/`isJwtExpired` são `protected` no `.d.ts` do SDK —
acessíveis por subclasse. `PluggyConnectorClient` (que já estende `PluggyClient` para
`fetchAccountsPage`) ganha um override de `getApiKey()`: se o token em cache ainda é válido, delega
sem registrar nada; senão, mede o `POST /auth` real que `super.getApiKey()` dispara e grava o
registro de `AUTH`.

**Alternativa descartada**: manter só o Proxy de método e contar uma chamada AUTH a cada `fetchItem`
sem cache — rejeitado porque simularia autenticação que não aconteceu, indo contra o requisito
explícito de "não simular AUTH a partir de outra chamada".

### D2 — `AsyncLocalStorage` carrega `trigger`/`webhookEventId`/`requestCorrelationId` até dentro do client
`PluggyConnectorClient` é construído fora do container Awilix (`new PluggyConnectorClient(...)`,
cacheado num `Map` dentro de `PluggyClientGateway`, singleton) e sobrevive a muitos escopos de
trabalho diferentes — não há como injetar por DI um dado que muda por unidade de trabalho dentro de
um objeto que atravessa unidades de trabalho. Um pequeno módulo (`call-context.ts`) expõe
`runWithCallContext(ctx, fn)`/`currentCallContext()` sobre `AsyncLocalStorage`, chamado nos pontos
que já criam escopo de trabalho hoje (`webhook-drainer.ts`, `index.ts` no boot,
`load-pluggy-item-in-background.ts`, `sync-pluggy-position-in-background.ts`, o handler da rota
manual) mais dois novos (`RegisterPluggyCredentialInteractor`, em volta da chamada de validação, e
`PluggyWebhookProvisioner.provisionFor`, D23).

**Alternativa descartada**: threading explícito de `trigger` por parâmetro em cada método de gateway
— rejeitado por exigir mudar a assinatura de cada um dos 8 gateways de borda, o que o pedido original
("sem duplicar lógica") já descartava.

### D3 — Instrumentação de chamadas por item é uma função só, usada em três pontos, não um Proxy fixo no client
`instrumentPluggyClient(client, {itemId, connectorId})` embrulha o client recebido (cacheado ou
`freshClient`) num Proxy de método, resolvendo `item_id`/`connector_id`/`resource_type`/`resource_id`
por uma tabela estática `operação → metadado`, porque o primeiro argumento de cada método do SDK não
é uniformemente `itemId` (`fetchInvestmentTransactions` recebe `investmentId`,
`fetchTransactionsCursor` recebe `accountId`, `fetchWebhook` recebe `webhookId` — confirmado lendo os
8 gateways de borda). É chamada em **três** lugares: `PluggyItemCredentialResolver.clientFor` (client
cacheado, pós-persistência), `RegisterPluggyCredentialImpl.validateItemAccess` (client descartável,
pré-persistência) e `PluggyWebhookProvisioner.provisionFor` (client obtido direto de
`PluggyClientGateway`, sem `itemId` — D23) — mesma função, `itemId`/`connectorId` ausentes no
terceiro caso (`item_id = null`, aceitável para `PLATFORM_CONFIG`).

**Alternativa descartada**: envolver o client uma vez só, no momento em que
`PluggyClientGateway.createClient` o constrói — rejeitada porque nesse momento o `itemId` da chamada
ainda não é conhecido (um `clientId` pode ter vários itens vinculados), e a garantia pedida
("100% das chamadas com `item_id` correto, sem depender de join posterior") exige o `itemId` no ponto
de uso, não no de construção.

### D4 — Marca d'água é por fonte real da Pluggy e por consumidor, nunca por agrupamento de negócio (`CASH`/`CUSTODY`)
`CASH` e `CUSTODY` são agrupamentos deste domínio, não conceitos com `lastUpdatedAt` próprio na
Pluggy. `Item.statusDetail` (`ItemProductsStatusDetail`) reporta, para cada chave — `accounts`,
`transactions`, `investments`, `investmentTransactions`, `loans`, entre outras — um
`ItemProductState` próprio (`isUpdated`, `lastUpdatedAt`), **mas só quando `executionStatus` é
`PARTIAL_SUCCESS`** (D12). O código hoje já combina duas dessas chaves por agrupamento sem nunca ter
resolvido isso em watermark: `load-pluggy-history.impl.ts` monta `cashProduct` de
`[item.products.accounts, item.products.transactions]` e `custodyProduct` de
`[item.products.investments, item.products.investmentsTransactions]`, só para extrair
`limitedByRateLimit` — a única marca d'água real hoje é `item.lastUpdatedAt`, no nível do Item
inteiro (`radar_pluggy_history_sync_states`).

A marca d'água nova é por (`itemId`, `consumer`, `source`) — **três** dimensões, não duas. `source` é
o recurso real: `ACCOUNTS`, `ACCOUNT_TRANSACTIONS` (mapeada da chave `transactions` do SDK —
renomeada aqui para não colidir com o nome genérico da chave), `INVESTMENTS`,
`INVESTMENT_TRANSACTIONS` (chave `investmentTransactions`, já corrigida por D7), `LOANS`. `consumer`
é o pipeline que processa aquela fonte: `POSITION_SYNC` (`SyncPluggyPositionInteractor`) ou
`HISTORY_LOAD` (`LoadPluggyHistoryInteractor`) — nomeados pelo próprio interactor consumidor, para
não inventar um terceiro vocabulário.

**Por que `consumer` é obrigatório, não opcional**: marca d'água não representa "qual versão desta
fonte existe na Pluggy" — representa "até qual versão desta fonte *este consumidor* processou com
sucesso" (D12 formaliza "versão" com precisão). `INVESTMENTS` é acompanhada pelos dois interactors,
mas cada um processa algo diferente a partir dela: `POSITION_SYNC` grava a fotografia de posição;
`HISTORY_LOAD` usa a lista de investimentos só para descobrir quais IDs escanear em busca de
transações de custódia (D13). Sem a dimensão `consumer`, uma chave só (`itemId`, `INVESTMENTS`)
seria compartilhada pelos dois: se `POSITION_SYNC` roda primeiro e avança essa marca d'água,
`HISTORY_LOAD` no mesmo ciclo veria `INVESTMENTS` "já em dia" e pularia sua própria descoberta —
mesmo nunca tendo processado nada para custódia. Isso contradiria a própria regra de
`pluggy-transaction-history` de que mudança em `INVESTMENTS` **ou** `INVESTMENT_TRANSACTIONS` torna
`CUSTODY` elegível. Com `consumer` na chave, `(POSITION_SYNC, INVESTMENTS)` e `(HISTORY_LOAD,
INVESTMENTS)` são linhas independentes: o avanço de uma nunca move a outra.

Tabela `radar_pluggy_sync_progress` (sucede `radar_pluggy_history_sync_states`), colunas `item_id`,
`consumer`, `source`, `last_completed_version_at` (chave composta `item_id + consumer + source`) —
ver D12 para o nome e a semântica exata da coluna. Entity `PluggySyncProgress`; repositório
`PluggySyncProgressRep`, com `read(itemId, consumer, source)`/`advance(itemId, consumer, source,
versionAt)`, escrita atômica (D17). A capability é `pluggy-sync-progress`.

- `SyncPluggyPositionInteractor` lê/avança `(POSITION_SYNC, INVESTMENTS)` e `(POSITION_SYNC, LOANS)`.
- `LoadPluggyHistoryInteractor` lê/avança `(HISTORY_LOAD, ACCOUNTS)`, `(HISTORY_LOAD,
  ACCOUNT_TRANSACTIONS)` (fontes de `CASH`) e `(HISTORY_LOAD, INVESTMENTS)`, `(HISTORY_LOAD,
  INVESTMENT_TRANSACTIONS)` (fontes de `CUSTODY`), respeitando a dependência de D13. `CASH` é
  elegível quando `ACCOUNTS` **ou** `ACCOUNT_TRANSACTIONS` estiver desatualizada; `CUSTODY`, quando
  `INVESTMENTS` **ou** `INVESTMENT_TRANSACTIONS` estiver desatualizada.

Isso fecha, para o histórico também, a mesma classe de risco que motivou o pedido original: o portão
de item-level do histórico já sofria do mesmo problema, só mascarado por `PluggyHistoryCoverage`
reprocessar qualquer fonte sem observação assim que o portão de item reabre.

**Alternativas descartadas**:
- Criar uma tabela nova só para posição, deixando a de histórico como estava — rejeitada por deixar
  duas semânticas de watermark concorrentes no mesmo código, e por deixar sem correção um risco que
  já existia no histórico.
- Manter `CASH`/`CUSTODY` como o próprio vocabulário de produto da marca d'água (primeira revisão) —
  rejeitada porque nenhuma das duas tem um único `lastUpdatedAt` real na Pluggy.
- Chave só (`itemId`, `source`), com `INVESTMENTS` compartilhada entre os dois interactors (segunda
  revisão) — rejeitada porque um consumidor avançar a marca d'água libera incorretamente o outro de
  processar sua própria parte.
- Assumir que `statusDetail.<fonte>.lastUpdatedAt` está sempre disponível para as cinco fontes
  (segunda revisão) — rejeitada nesta revisão: falso para `executionStatus === 'SUCCESS'`, onde
  `statusDetail` é `null` (D12).

### D5 — `radar_pluggy_items` preserva, sem reinterpretação, "última ingestão completa e bem-sucedida"
A marca d'água de item (`radar_pluggy_items.last_updated_at`) só avança quando
`executionStatus === 'SUCCESS'` — nunca em `PARTIAL_SUCCESS`, mesmo que uma ou mais fontes tenham
sido processadas. O portão de entrada do interactor (decidir se vale a pena tentar o ciclo) passa a
ser a união de "watermark de item está velha" OU "alguma marca d'água de `(consumer, source)` daquele
interactor está velha" — nunca só a de item. O que decide se uma fonte específica é retentada é
sempre a marca d'água daquele `(consumer, source)`, nunca a de item.

**Alternativa descartada**: avançar a marca d'água de item também em execuções parciais — revertida
porque mudava silenciosamente o significado já fixado do campo.

### D6 — "Fonte utilizável" é decidida por `isUpdated`, com vocabulário de domínio próprio (`isUsable`), nunca `limitedByRateLimit`
`node_modules/pluggy-sdk/dist/types/item.d.ts` declara `ITEM_PRODUCT_STEP_WARNING_CODES = ["001"]` —
não existe `"423"` nem `"RATE_LIMIT"` em nenhum lugar do pacote instalado. `"423"` **é** um warning
real documentado pela Pluggy (confirmado na documentação oficial), mas nenhum código de warning —
`"423"` incluído — governa a decisão de negócio: o campo estruturado e suficiente é
`ItemProductState.isUpdated: boolean`. Se `false` (ou ausente) num item `PARTIAL_SUCCESS`, a fonte
não foi coletada nesta execução, seja qual for o motivo (rate limit, erro transitório, produto não
solicitado). `warnings[].code/message` continuam capturados e logados para auditoria, mas saem da
decisão de negócio.

O nome de domínio deixa de ser `limitedByRateLimit` (código hoje em `load-pluggy-history.impl.ts`,
função `toProductState`): esse nome afirma uma causa (limite de taxa) que o campo não distingue —
`isUpdated === false` pode ser qualquer motivo. O vocabulário correto é **`isUsable`** (a fonte pode
ser processada nesta execução) — `wasCollected` seria equivalente, mas `isUsable` já carrega a
decisão que os dois interactors consultam (`isProductUsable`, tasks.md 1.3), então um nome só evita
sinônimo redundante. Módulo compartilhado (`adapters/gateways/pluggy-product-state.ts`),
`toSourceState`/`isUsable`, usado por `SyncPluggyPositionInteractor` e por
`LoadPluggyHistoryInteractor`.

**Alternativa descartada** (revertida com nova evidência em rodada anterior): manter um conjunto de
códigos conhecidos (`'423'` + os três antigos) e logar código desconhecido — descartada porque o
campo booleano já resolve o problema sem depender de acertar uma string, e porque nomear o campo de
domínio pela causa (`limitedByRateLimit`) contradiz o próprio motivo de usar `isUpdated` em vez de
`warning.code`: se a causa não importa para a decisão, o nome do campo não deveria afirmar uma causa.

### D7 — Três correções de shape, fechadas nesta mesma decisão porque bloqueiam D4/D6
Lendo `item.d.ts` do SDK instalado: (a) a chave de `statusDetail` é `investmentTransactions`
(singular), o código lê `investmentsTransactions` (plural) e nunca bate — corrigido; (b)
`PRODUCT_KEYS` em `PluggyItemsGateway` não inclui `'loans'`, então `statusDetail.loans` é descartado
antes de qualquer decisão — corrigido; (c) `ItemStatus` real tem sete valores
(`WAITING_USER_ACTION`, `MERGING` além dos cinco já aceitos) — `PluggyItem.VALID_STATUSES` ganha os
dois que faltavam.

### D8 — `connectorId` é capturado no cadastro e atualizado em toda observação aceita do Item
`Item.connector: Connector` já vem embutido em todo `GET /items/{id}` (`id`, `name`, `imageUrl`,
`primaryColor`, `products`, entre outros) — sem chamada extra a `GET /connectors/{id}`. É capturado
no momento em que `RegisterPluggyCredentialImpl.validateItemAccess` já lê o item pela primeira vez
(pré-persistência) e persistido em `radar_pluggy_credential_items` na mesma operação que cria o
vínculo — nunca inferido por nome de instituição.

Isso não é a única escrita: sempre que uma observação de Item é **aceita** (D9.1 — pelo critério de
ordenação, não qualquer leitura) e o payload traz `connector`, os campos de connector (D19: incluindo
`connector_products`) são regravados no vínculo credencial↔item, **na mesma decisão atômica que
aceita a observação** (D18) — nunca separadamente. Mesmo connector já conhecido regrava o mesmo valor
(idempotente); connector diferente do último conhecido substitui. Dois efeitos, pela mesma escrita:
vínculos legados com `connector_id = null` são preenchidos na próxima observação aceita sem script de
backfill, e uma mudança futura de metadata do connector na Pluggy (nome, imagem, cor, produtos)
chega ao vínculo sem depender de re-cadastro. Continua sem chamada extra a `GET /connectors/{id}`.
`radar_pluggy_item_observations` e `radar_pluggy_calls` guardam só `connector_id` (numérico,
denormalizado para consulta), não repetem nome/imagem/produtos — evita duplicar dado que pode
desatualizar se a Pluggy renomear ou reclassificar um connector.

**Alternativa descartada**: capturar o connector uma única vez, no cadastro, e nunca mais relê-lo —
descartada porque deixava vínculos legados (`connector_id = null`, sem observação anterior) sem
caminho de preenchimento além de um script manual, e deixava o vínculo cego a uma mudança real de
metadata que a Pluggy já relata a cada leitura.

### D9 — Terceira leitura do Item, dentro do mesmo ciclo, é eliminada por cache de escopo — não por acoplar os dois interactors
`SyncPluggyPositionImpl` e `LoadPluggyHistoryImpl` são resolvidos do mesmo escopo Awilix dentro de um
único ciclo de ingestão (D15/D16). `PluggyItemStateResolver` (novo, `.scoped()`, mesmo padrão de
memoização por escopo que `PluggyItemCredentialResolver` já usa) expõe `read(itemId)`: primeira
chamada busca e tenta persistir a observação; qualquer chamada seguinte, no mesmo escopo, devolve o
mesmo snapshot sem nova rede. Os dois interactors continuam chamando `read(itemId)` sem saber um do
outro — zero acoplamento de contrato entre eles.

`PluggyItemStateResolver.read` só é chamado por consumidores que já assumem o vínculo
credencial↔item existente (`SyncPluggyPositionImpl`, `LoadPluggyHistoryImpl` — ambos recebem um
`itemId` que só existe neste serviço depois de `assertItemAccess` confirmar o vínculo). A leitura de
validação pré-vínculo (`RegisterPluggyCredentialImpl.validateItemAccess`, D3) usa um `freshClient`
próprio, fora deste resolver, e por isso nunca escreve em `radar_pluggy_item_observations` — só em
`radar_pluggy_calls`. Não existe credencial↔item persistida ainda para associar a observação a essa
leitura; ver `pluggy-connection-observability`.

**Alternativa descartada**: `SyncPluggyPositionOutput` carregar o snapshot para
`LoadPluggyHistoryInput` consumir — rejeitada por acoplar dois interactors independentes ao mesmo
formato de dado bruto da Pluggy, violando "gateway do próprio caso de uso, não conhece outro caso de
uso".

#### D9.1 — Ordenação da observação usa `observationStartedAt`, capturado antes do `fetchItem`, nunca o instante do save
`observedAt = hora em que salvou` não resolve "observação nunca retrocede no tempo": duas leituras
concorrentes do mesmo item podem terminar (e portanto salvar) fora da ordem em que começaram —
request A começa às 10:00, request B começa às 10:01, B termina e salva às 10:02, A termina e salva
às 10:03. Se o token de ordenação for o instante do save, o registro de A (mais antigo, mas salvo por
último) sobrescreveria o de B (mais novo), porque 10:03 > 10:02 — exatamente a regressão que a spec
proíbe. `Item.lastUpdatedAt` da Pluggy também não serve: o `status`/`executionStatus` pode mudar
(`UPDATING` → `LOGIN_ERROR`, por exemplo) sem que `lastUpdatedAt` avance.

`PluggyItemStateResolver.read(itemId)` captura `observationStartedAt = new Date()` **antes** de
chamar `fetchItem` — não depois. O fluxo é: captura `observationStartedAt` → `fetchItem` →
parse/validação → tenta a escrita atômica descrita em D17/D18 (aceita ou recusa a observação; se
aceita, o connector do vínculo é atualizado na mesma escrita — D18). No exemplo acima, A carrega
`observationStartedAt = 10:00`, B carrega `10:01`; não importa que A termine depois — sua escrita
perde para a de B (10:01 > 10:00) porque a comparação é entre os dois `observationStartedAt`, não
entre os instantes de término.

**Empate exato (`incoming.observationStartedAt === stored.observationStartedAt`)**: `Date` em Node
tem resolução de milissegundos — duas leituras concorrentes podem capturar o mesmo instante. A
condição é estritamente `>` (não `>=`): em caso de empate, a escrita que chega depois encontra a
condição falsa (igual não é maior) e é recusada — a que já está gravada permanece, ou seja, **a
primeira gravação a comitar vence o empate**, não necessariamente a primeira a ter começado. É uma
garantia mais fraca que "a leitura que começou primeiro sempre vence" nesse caso específico de
empate exato, mas nunca há dupla gravação nem estado indeterminado.

**Alternativa descartada**: `observedAt` = instante do save — descartada porque não resolve o
cenário de corrida acima.
**Alternativa descartada**: condição `>=` — descartada porque em caso de empate exato permitiria a
segunda escrita a chegar sobrescrever a primeira sem necessidade real de avanço.

### D10 — `/credentials/status` expõe conexão e estado por fonte, porque a granularidade certa é por item e por produto, não só por pessoa
Uma pessoa pode ter mais de um Item vinculado (`PluggyCredentialItem` já modela isso), e um Item em
`PARTIAL_SUCCESS` pode ter uma fonte saudável e outra não — expor só um `connectionStatus` agregado
por item (a versão original desta proposta) esconderia isso: um titular com `accounts` falhando e
`investments` saudável veria a Carteira inteira marcada como problema, quando só o Cartão deveria
alertar. A resposta passa a ser `{hasCredential, items: [...]}`, cada item com seu
`connectionStatus` traduzido (`pluggy-connection-observability`), identidade de connector (incluindo
produtos suportados, D19) e um mapa `sources` por fonte suportada pelo connector: `supported`,
`isUpdated`, `lastUpdatedAt`. Uma fonte não suportada pelo connector aparece só com
`supported: false` — sem forçar o front a inferir isso de outro lugar.

Em `executionStatus === 'SUCCESS'` (`statusDetail === null`, D12), a tradução sabe, sem exigir
`statusDetail`, que toda fonte suportada pelo connector está `isUpdated: true` com
`lastUpdatedAt = Item.lastUpdatedAt` — não precisa de um valor por fonte que a Pluggy não relata
nesse caso.

**Alternativa descartada**: manter só `connectionStatus` agregado por item, sem detalhe por fonte
(primeira e segunda revisão) — descartada porque não representa `PARTIAL_SUCCESS` de forma útil ao
titular: uma fonte saudável não deveria herdar o alerta de outra que falhou no mesmo item.

### D11 — Este change assume o requisito funcional do PR #12, mas reescreve sua implementação
O PR #12 (`feat/pluggy-precarga-cadastro-credencial`, aberto, não mergeado) resolve um problema real:
sem ele, o titular só vê dado depois do primeiro `item/updated` chegar por webhook, o que pode
demorar minutos ou nunca chegar se o webhook ainda não estava provisionado. Esse requisito
("cadastro dispara pré-carga, sem bloquear o `201`") continua.

O arquivo que o PR #12 introduz, `infra/worker/load-pluggy-item-in-background.ts`, encadeia
`syncPluggyPositionInteractor.execute` → (só se sucesso) `loadPluggyHistoryInteractor.execute`, num
`scope` próprio, sem qualquer lease. Isso replica, num terceiro lugar, exatamente os dois problemas
que esta revisão corrige (D15, D16). Mergear o PR #12 como está e corrigi-lo depois duplicaria
trabalho e criaria uma janela em que o bug de bloqueio mútuo e de corrida está em `staging`. Por
isso: o requisito funcional do PR #12 é preservado, mas `load-pluggy-item-in-background.ts` nasce, na
implementação deste change, já usando `pluggy-ingestion-coordination` (D16) — o PR #12 é rebaseado
ou fechado em favor da versão que nasce aqui, decisão operacional de quem aplica o `/opsx:apply`.

**Alternativa descartada**: mergear o PR #12 primeiro, corrigir depois — descartada porque o pedido
explícito desta rodada é não introduzir o bug para corrigi-lo num PR seguinte.

### D12 — `statusDetail` só existe em `PARTIAL_SUCCESS`; a marca d'água guarda "versão da execução processada", não "o `lastUpdatedAt` do produto"
A premissa da revisão anterior — de que as cinco fontes sempre têm `lastUpdatedAt` disponível em
`Item.statusDetail` — é falsa. O próprio `.d.ts` do SDK documenta `statusDetail` como
`ItemProductsStatusDetail | null`, com o comentário "Only available when item.status is
'PARTIAL_SUCCESS'"; a documentação oficial da Pluggy confirma: em `executionStatus === 'SUCCESS'`,
`statusDetail` é `null`.

A regra de negócio fecha assim:
- `SUCCESS` → toda fonte que o connector suporta é utilizável; a versão da execução disponível é
  `Item.lastUpdatedAt` (sempre presente em `SUCCESS`, ver `SyncPluggyPositionInteractor`, que já
  recusa nomeando quando não vier).
- `PARTIAL_SUCCESS` → `statusDetail` decide, fonte a fonte, quais são utilizáveis
  (`isUpdated === true`, D6); só essas têm uma versão de execução própria
  (`statusDetail.<fonte>.lastUpdatedAt`). Fonte com `isUpdated !== true` não avança progresso — nem
  com `Item.lastUpdatedAt` nem com o `lastUpdatedAt` antigo que `statusDetail` pode trazer (o `.d.ts`
  documenta: se não coletado, `lastUpdatedAt` é `null` ou a data anterior — nunca a data desta
  execução).

`radar_pluggy_sync_progress.last_completed_version_at` renomeia `last_completed_source_updated_at`
(nome da revisão anterior) porque esse nome afirmava, incorretamente, que a coluna sempre guarda "o
`lastUpdatedAt` daquela fonte" — falso em `SUCCESS`, onde o valor gravado é `Item.lastUpdatedAt`, uma
grandeza de escopo diferente (o Item inteiro, não a fonte). "Versão da execução que este consumidor
concluiu para esta fonte" é o que a coluna representa nos dois casos.

**Alternativa descartada**: manter a premissa de que `statusDetail` está sempre presente — impossível
de sustentar contra o `.d.ts` instalado e a documentação oficial; teria deixado todo o portão de
`pluggy-sync-progress` quebrado em toda execução `SUCCESS` (a maioria).

### D13 — `ACCOUNT_TRANSACTIONS` depende de `ACCOUNTS`; `INVESTMENT_TRANSACTIONS` depende de `INVESTMENTS`
Escanear transações de conta exige primeiro conhecer a lista atual de contas
(`readCashSources`/`fetchAccountPages`, já no código); escanear transações de investimento exige a
lista atual de investimentos (`readCustodySources`/`fetchInvestmentPages`). Em `PARTIAL_SUCCESS`,
`transactions.isUpdated === true` com `accounts.isUpdated !== true` não permite declarar
`ACCOUNT_TRANSACTIONS` completamente processada: pode existir uma conta nova que a coleta desta
execução não descobriu, porque a listagem de contas (`accounts`) não foi coletada. Mesma relação
entre `investmentTransactions` e `investments`.

Regra: `ACCOUNT_TRANSACTIONS` só avança (`PluggySyncProgressRep.advance(itemId, HISTORY_LOAD,
ACCOUNT_TRANSACTIONS, ...)`) quando **tanto** a própria coleta de transações **quanto** `ACCOUNTS`
estiverem utilizáveis nesta execução; `ACCOUNTS`, por sua vez, avança sozinha, independente de
`ACCOUNT_TRANSACTIONS` (a fonte-base nunca depende da dependente). Mesma regra para
`INVESTMENT_TRANSACTIONS`/`INVESTMENTS`. Em `SUCCESS`, ambas as fontes de cada par são utilizáveis
por definição (D12), então a dependência nunca bloqueia nesse caso — só importa em
`PARTIAL_SUCCESS`.

**Alternativa descartada**: avançar `ACCOUNT_TRANSACTIONS` sempre que sua própria coleta tiver
`isUpdated === true`, ignorando o estado de `ACCOUNTS` — descartada porque permite marcar como
"processada" uma execução que pode ter perdido uma conta nova, silenciosamente.

### D14 — `Account.updatedAt`/`Investment.updatedAt` são otimização, nunca gate de correção
Não há, nem na documentação oficial nem no `.d.ts` instalado, garantia de que uma nova transação de
conta obrigatoriamente avança `Account.updatedAt`, nem que uma nova transação de investimento avança
`Investment.updatedAt` — o único campo com esse contrato documentado é o `lastUpdatedAt` por produto
em `Item.statusDetail` (D12), não o `updatedAt` de um recurso individual. O código hoje
(`LoadPluggyHistoryInteractor.sourceChanged`) usa `Account.providerUpdatedAt`/`Investment.updatedAt`
para decidir se pula o escaneamento de transações daquele recurso específico — isso deixa de ser
condição necessária.

Quando `ACCOUNT_TRANSACTIONS` está elegível (D13), o comportamento seguro é varrer as transações de
**todas** as contas atuais que a listagem trouxe nesta execução — não só as que mudaram de
`updatedAt`. Mesma regra para `INVESTMENT_TRANSACTIONS`/investimentos atuais. `updatedAt` do recurso
pode continuar existindo como *otimização* (por exemplo, para reduzir o escopo de paginação de um
recurso específico), mas só se uma garantia documentada da Pluggy justificar isso no futuro — hoje,
nenhuma existe, então a implementação não usa `updatedAt` de recurso para decidir se escaneia ou não.

**Alternativa descartada**: manter `sourceChanged` como está (comportamento já em `staging`) —
descartada porque não há garantia documentada que sustente pular um recurso com base em
`updatedAt` não ter mudado; o risco é perder transação nova silenciosamente.

### D15 — Position e History rodam de forma independente dentro de uma ingestão; falha de um nunca impede o outro
Hoje, nos três pontos de entrada (D11, Context), a falha de `SyncPluggyPositionInteractor` impede
`LoadPluggyHistoryInteractor` de sequer ser chamado. Isso é incorreto para o domínio: um problema em
`investments` (posição) não pode impedir o Cartão (`accounts`/`transactions`, histórico de caixa) de
atualizar, e vice-versa. A unidade de ingestão passa a ser:

```
resultado_position = tenta executar Position (captura sucesso/erro, nunca propaga como exceção)
resultado_history  = tenta executar History  (captura sucesso/erro, nunca propaga como exceção)
sucesso_da_unidade  = resultado_position.ok && resultado_history.ok
```

Se só um falhar, a unidade de trabalho é marcada como falha (para efeito de retry do trigger que a
originou — D16), mas o que teve sucesso já está persistido e não é refeito à toa: a próxima
tentativa relê o Item, e as marcas d'água próprias de cada `(consumer, source)` (D4) fazem o lado que
já concluiu fechar o portão rapidamente, enquanto o lado que falhou tenta de novo. Não existe
dependência de ordem entre os dois — cada um lê o Item via `PluggyItemStateResolver` (D9), que
memoiza por escopo, então não há custo de rede duplicado mesmo rodando "em paralelo lógico" (podem
ser sequenciais na implementação, contanto que nenhum dependa do resultado do outro).

**Alternativa descartada**: manter Position bloqueando History (comportamento atual) — é exatamente o
que este ponto corrige; documentado aqui só para registrar a rejeição explícita.

### D16 — Lease de ingestão por Item, compartilhado por todo trigger, generaliza o padrão de lease do webhook — não uma fila de ingestão unificada
Property final exigida: no máximo uma ingestão (Position+History) por Item executando por vez,
independente de vir de `WEBHOOK`, `CREDENTIAL_REGISTRATION_PRELOAD`, `BOOT_RECOVERY` ou
`MANUAL_HISTORY_LOAD`. Duas soluções foram avaliadas:

1. **Generalizar `pluggy_connector_webhook_events` numa fila de ingestão única**, com `trigger`/
   `origin`, todo disparo (inclusive pré-carga e rota manual) virando um enqueue + claim.
2. **Extrair um lease de item, independente da fila de evento**, que todo disparador (o drenador de
   webhook incluído) precisa adquirir antes de chamar Position/History.

Escolhida a opção 2. Razão: `POST /items/:itemId/history/load` responde **de forma síncrona** com o
resultado de History (contrato HTTP já em uso pelo front) — forçar esse caminho para dentro de uma
fila assíncrona exigiria trocar essa rota por um modelo de "enfileirado, consulte depois", mudança de
contrato para o front que ninguém pediu nesta revisão. Um lease de item, adquirido de forma síncrona
e rápida (mesmo idioma de claim atômico de `PluggyWebhookEventRep`), preserva o contrato síncrono
dessa rota e ainda garante exclusão mútua real.

Nova tabela `radar_pluggy_item_ingestion_leases` (`item_id` único, `trigger`, `lease_until`,
`fencing_token` BIGINT, `acquired_at`). **`fencing_token` é a prova de posse, não `acquired_at`**
(revisão desta rodada — ver "Correção: TTL sem renovação" abaixo): dois `tryAcquire` não podem
depender da resolução de milissegundo de um timestamp para se distinguir; um contador que só
incrementa, por item, cada vez que o lease é adquirido, nunca colide e nunca anda para trás.
Repositório `PluggyItemIngestionLeaseRep`:
- `tryAcquire(itemId, trigger, ttlMs)`: `findOrCreate` uma linha "livre" (`lease_until = epoch`,
  `fencing_token = 0`) se não existir, depois `UPDATE ... SET lease_until = :new, trigger = :trigger,
  fencing_token = fencing_token + 1, acquired_at = :now WHERE item_id = :id AND lease_until <= :now`
  — mesmo idioma de `claimNextPending`/`markSucceeded` (`UPDATE` com `WHERE` que decide o vencedor no
  banco, linhas afetadas prova posse). Devolve o `fencing_token` **pós-incremento** como token, ou
  `undefined` se não conseguiu.
- `renew(itemId, fencingToken, ttlMs)`: `UPDATE ... SET lease_until = :new WHERE item_id = :id AND
  fencing_token = :fencingToken` — devolve `true`/`false` (linhas afetadas). Chamado em heartbeat
  (ver abaixo), nunca muda `fencing_token`.
- `release(itemId, fencingToken)`: `UPDATE ... SET lease_until = :now WHERE item_id = :id AND
  fencing_token = :fencingToken` — só quem detém o `fencing_token` atual consegue liberar; um lease
  vencido e reivindicado por outro (com `fencing_token` maior) nunca é liberado pelo dono antigo por
  engano, porque o `WHERE` não casa mais.

`webhook-drainer.ts` passa a adquirir esse lease (com `trigger = 'WEBHOOK'`) para o `item_id` do
evento **antes** de marcá-lo `PROCESSING` — se a aquisição falhar (outro trigger já está ingerindo
aquele item), o evento permanece `PENDING` e a drenagem tenta o próximo evento de item diferente,
sem consumir uma tentativa. Isso **substitui** o subquery `busyItemIds` que hoje faz esse papel só
entre eventos de webhook — o lease compartilhado é a única fonte de verdade de exclusão, entre
qualquer trigger. `pluggy-item-ingestion.ts` (D11) e o handler da rota manual (D30) adquirem o
mesmo lease antes de chamar os dois interactors; falha de aquisição:
- pré-carga/webhook/boot: loga e não roda — outro trigger já está cobrindo aquele item, e o próprio
  evento (se vier de webhook) permanece `PENDING` para a próxima drenagem;
- rota manual: responde recusando nomeadamente (`{errorType: 'PLUGGY_ITEM_INGESTION_IN_PROGRESS'}`)
  — novo, mas mesma forma `{errorType, extras}` já usada em toda a API.

Release sempre acontece (sucesso ou falha) antes de a unidade de trabalho terminar — nunca some por
exceção não tratada (`finally` ou equivalente).

**Correção desta rodada: TTL sem renovação não sustenta a garantia prometida.** Um `lease_until` fixo
sem heartbeat quebra sob carga histórica longa: `worker A` adquire, a varredura de histórico demora
mais que o TTL, o lease expira, `worker B` adquire um lease novo para o mesmo item enquanto `worker A`
ainda está processando — duas ingestões simultâneas, exatamente o que a capability promete impedir.
Correção: quem detém o lease **renova periodicamente** enquanto o trabalho estiver em andamento — um
heartbeat (`setInterval`, período = `ttlMs / 3`) chamando `renew(itemId, fencingToken, ttlMs)`,
iniciado logo após `tryAcquire` e **sempre** parado (`clearInterval`) num `finally` antes de liberar o
lease, sucesso ou falha.

**Até onde vai a garantia formal**: com heartbeat, a janela de "TTL expira enquanto o dono original
ainda trabalha" fecha para o caso comum — um único processo Node.js executando a ingestão: heartbeat e
qualquer escrita de negócio competem pelo mesmo event loop single-threaded, então se o heartbeat para
de rodar (processo travado/morto), nenhuma escrita concorrente desse mesmo processo pode estar
acontecendo em paralelo — não há paralelismo real dentro de um processo Node para essas duas coisas
divergirem. A garantia é mais fraca só num cenário específico: duas instâncias/processos diferentes
(por exemplo, API escalada horizontalmente), onde uma pausa de GC longa poderia, em teoria, atrasar o
heartbeat e uma escrita pendente pelo mesmo tanto — reduzido pelo heartbeat, mas não formalmente
impossível sem propagar o `fencing_token` para dentro de cada escrita de `pluggy-sync-progress`/
reconciliação (o que exigiria acoplar os dois interactors ao lease, custo maior que o problema real
que motivou o pedido). Por isso: **o lease evita trabalho duplicado e chamadas desnecessárias — quem
garante que o dado nunca fica corrompido mesmo numa sobreposição residual é a escrita atômica de D17**,
que não depende do lease para estar correta. A promessa da capability é ajustada para refletir
exatamente isso (ver spec `pluggy-ingestion-coordination`).

**Alternativa descartada**: opção 1 (fila de ingestão única) — descartada porque exigiria mudar o
contrato síncrono da rota manual, mudança que ninguém pediu; documentada aqui porque foi cogitada e
rejeitada explicitamente, conforme pedido.
**Alternativa descartada**: usar `radar_pluggy_calls` como lock — nunca, é auditoria (não-goal já
fixado).
**Alternativa descartada**: Redis — não-goal já fixado; MySQL já resolve com o mesmo idioma existente.
**Alternativa descartada**: `acquired_at` (timestamp) como token de posse (rodada anterior) —
descartada porque duas aquisições podem cair no mesmo milissegundo (resolução do `Date` em Node);
`fencing_token` monotônico nunca colide.
**Alternativa descartada**: propagar `fencing_token` para dentro de cada escrita de
`pluggy-sync-progress`/`radar_pluggy_item_observations`/reconciliação (fencing completo, no sentido
clássico de Kleppmann) — cogitada e adiada: fecharia o gap residual entre processos diferentes, mas
acopla dois interactors independentes ao mecanismo de lease só para um cenário que já é mitigado pelo
heartbeat e coberto, para integridade de dado, por D17; revisitar se o serviço passar a escalar
horizontalmente de um jeito que torne esse gap residual observável na prática.

### D17 — Toda marca d'água/observação é escrita com condição atômica no banco, nunca "ler, validar em memória, escrever"
`PluggyItemRep.save`, `PluggyHistorySyncStateRep.save` e `PluggyHistoryCoverageRep.save` (todos já em
`staging` ou nesta proposta) seguem `findOrCreate` + `row.update(...)` incondicional — o `update` não
tem `WHERE` comparando a versão que está sendo escrita com a persistida. Duas execuções concorrentes
podem ler a mesma linha, cada uma decidir "minha versão é mais nova" e escrever — a que escrever por
último vence, não a que tem a versão realmente mais nova.

Toda escrita de marca d'água passa a ser um `UPDATE` condicional:
```sql
UPDATE <tabela> SET <campos>, updated_at = :now
WHERE <chave> = :chave AND (<coluna_versao> IS NULL OR <coluna_versao> < :nova_versao)
```
seguido de `INSERT` (via `findOrCreate`/`INSERT IGNORE`) só quando a linha não existir. Zero linhas
afetadas no `UPDATE` é tratado como no-op esperado (uma versão igual ou mais nova já está lá), nunca
como erro. Aplica-se a:
- `radar_pluggy_items.last_updated_at` (condição: `executionStatus === 'SUCCESS'` **e** a condição
  atômica acima);
- `radar_pluggy_sync_progress.last_completed_version_at` (por `(item_id, consumer, source)`);
- `radar_pluggy_item_observations` via `observationStartedAt` (D9.1), já com a condição estritamente
  `>`;
- `radar_pluggy_history_coverage` (quando aplicável — a fonte que decide *se* varre uma conta/
  investimento específico deixou de depender de `updatedAt` do recurso, D14, mas a tabela continua
  registrando o que foi varrido; a escrita de conclusão também passa a ser condicional por
  `last_completed_scan_at`/`source_updated_at`, mesmo raciocínio).

Testes concorrentes representativos (não só sequenciais) são obrigatórios para cada uma dessas
escritas: duas chamadas "simultâneas" (mesmo padrão de teste que já existe para `PluggyWebhookEventRep`
— dois disparos assíncronos antes de aguardar qualquer um) devem terminar com a versão mais nova
persistida, independente da ordem de conclusão.

**Alternativa descartada**: lock explícito (`SELECT ... FOR UPDATE`) segurando a linha durante toda a
decisão — descartada porque exige manter a transação aberta mais tempo e ainda decide em memória; o
`UPDATE` condicional resolve com uma única viagem ao banco, sem lock de longa duração.

### D18 — Aceitar a observação e atualizar o connector são a mesma decisão atômica
O fluxo de `PluggyItemStateResolver.read` é: `fetchItem` → parse → **uma** escrita que decide, pela
condição de D9.1 (`observationStartedAt` estritamente maior), se a observação é aceita — e só se
aceita, atualiza também o connector do vínculo (D8), na mesma operação. Não pode existir o cenário
"observação antiga recusada, mas connector antigo ainda sobrescreve metadata mais nova" — se a
condição de D9.1 falha, nem a observação nem o connector são tocados; se passa, os dois são.
Implementação: uma única transação de banco (própria deste resolver, D9), com o `UPDATE` condicional
de `radar_pluggy_item_observations` e o `UPDATE` de `radar_pluggy_credential_items` na mesma
transação — a segunda escrita só roda se a primeira afetou uma linha (ou se foi um `INSERT` novo).

A exceção continua sendo o cadastro: `validateItemAccess` cria o vínculo já com connector (D8), sem
observação envolvida — não existe conflito porque não existe observação anterior para comparar.

**Alternativa descartada**: atualizar connector independente do resultado da observação (a versão
anterior desta proposta não deixava isso explícito) — descartada porque abre a janela exata que este
ponto fecha: uma leitura atrasada, mesmo recusada como observação, ainda sobrescreveria connector
mais novo.

### D19 — Connector captura também os produtos suportados pela instituição
`Connector.products: ProductType[]` (SDK: `ACCOUNTS`, `CREDIT_CARDS`, `TRANSACTIONS`, `PAYMENT_DATA`,
`INVESTMENTS`, `INVESTMENTS_TRANSACTIONS`, `IDENTITY`, `BROKERAGE_NOTE`, `MOVE_SECURITY`, `LOANS`,
`ACCOUNT_STATEMENTS`) já vem embutido no mesmo `connector` de `Item.connector` — sem chamada extra.
Nova coluna `connector_products` (JSON) em `radar_pluggy_credential_items`, capturada e atualizada
nos mesmos pontos que os demais campos de connector (cadastro + D8/D18). Persistido bruto/normalizado
(o array que a Pluggy devolve), sem reinterpretar em outro vocabulário — o contrato de domínio
exposto em `/credentials/status` (`sources[].supported`, D10) é derivado desse array no momento da
tradução, não gravado duas vezes.

**Alternativa descartada**: inferir produtos suportados a partir de `statusDetail` observado (o que
a fonte já reportou alguma vez) — descartada porque isso é "o que já vimos", não "o que a instituição
suporta"; `Connector.products` é a fonte correta e documentada.

### D20 — `/credentials/status` traduz `sources` a partir do estado observado, não de uma chamada nova
`GET /credentials/status` continua leitura pura (`pluggy-credentials`, regra 6 de fronteira-pluggy):
`sources` vem de `radar_pluggy_item_observations` (o `statusDetail`/`Item.lastUpdatedAt` da última
observação aceita) combinado com `connector_products` (D19) do vínculo — nunca dispara `fetchItem`
novo. Fonte não suportada pelo connector aparece como `{supported: false}`, sem `isUpdated`/
`lastUpdatedAt` (não haveria o que significar).

### D21 — Leitura autoritativa de uma fonte reconcilia a fotografia atual; lista vazia deixa de ser erro incondicional
`SyncPluggyPositionInteractor.execute` (já em `staging`) recusa qualquer lista vazia de investimentos
com portão aberto (`PLUGGY_INVESTMENTS_EMPTY_WITH_SUCCESS_STATUS`) — **depois** de já ter confirmado
`consentStatus.kind === 'ACTIVE'` alguns passos antes na mesma função. Ou seja: o motivo original
dessa recusa (comentário no código: "consentimento revogado/expirado devolve vazio, nunca zero
posições") já é coberto pela checagem de consentimento anterior — por isso a recusa incondicional de
lista vazia é redundante e impede representar "o titular vendeu tudo".

Regra final:
- Fonte **não utilizável** nesta execução (`isUsable === false`, D6) → nunca toca dado existente —
  nem upsert, nem remoção. Continua a mesma fotografia da última execução utilizável.
- Fonte **utilizável e coletada com sucesso** (inclusive lista vazia) → a resposta é autoritativa:
  upsert de cada item presente, e **reconciliação** — todo registro local daquele Item, na tabela de
  fotografia atual daquela fonte, cujo identificador natural não veio na leitura, deixa de pertencer
  à fotografia (remoção, ou coluna de estado equivalente coerente — decisão de implementação; o
  contrato observável é "não aparece mais na leitura de `GET /portfolio`/`GET /accounts`"). Aplica-se
  a `radar_pluggy_positions` (investimentos), `radar_pluggy_loans` (empréstimos) e
  `radar_pluggy_accounts` (contas, em `LoadPluggyHistoryImpl.readCashSources`). Snapshot/raw
  (`PluggyPositionSnapshotRep`, `PluggyPositionRawRep`, equivalentes de loan/account) nunca são
  reconciliados — são histórico/auditoria append-only por natureza.
- A reconciliação roda na mesma transação que os upserts daquela fonte (mesmo padrão
  `startProcess`/`terminateProcess`/`cancelProcess` já usado em `savePositionsWithSnapshots`/
  `saveLoansWithSnapshots`).

`PLUGGY_INVESTMENTS_EMPTY_WITH_SUCCESS_STATUS` deixa de existir como recusa incondicional; a
distinção "recusa nomeada" vs. "vazio real" passa a ser inteiramente governada por `isUsable`
(D6/D13), não pelo tamanho da lista.

**Alternativa descartada**: manter a recusa de lista vazia como está — descartada porque, com o
consentimento já verificado antes, a recusa não protege contra nada que já não esteja coberto, e
ativamente impede o caso legítimo de portfólio zerado.

### D22 — `radar_pluggy_calls` cobre também `PLATFORM_CONFIG` de verdade (`PluggyWebhookProvisioner`)
`PluggyWebhookProvisioner.provisionFor` pega o client direto de `PluggyClientGateway.clientFor`,
fora de `PluggyItemCredentialResolver` — as chamadas `fetchWebhook`/`createWebhook`/`updateWebhook`
não passavam por nenhum ponto de instrumentação planejado até esta revisão. `instrumentPluggyClient`
(D3) passa a ser aplicado também no client resolvido aqui — `item_id = null`, `connector_id = null`
(config de plataforma é por credencial/cliente, não por item), `call_scope = PLATFORM_CONFIG`.

### D23 — Vocabulário fechado de `trigger`, compartilhado entre `pluggy-call-history` e `pluggy-ingestion-coordination`
```
CREDENTIAL_REGISTRATION_VALIDATION    (call-history só — pré-vínculo, D9)
CREDENTIAL_REGISTRATION_PROVISIONING  (call-history só — D22)
CREDENTIAL_REGISTRATION_PRELOAD       (dispara ingestão — D16)
WEBHOOK                               (dispara ingestão — D16)
WEBHOOK_RECONCILIATION                (call-history só — POST /webhooks/pluggy/reconcile)
BOOT_RECOVERY                         (dispara ingestão — reclama leases/eventos vencidos no boot)
MANUAL_HISTORY_LOAD                   (dispara ingestão — D16)
USER_REFRESH                          (reservado — futuro botão de "atualizar agora")
REAL_TIME_BALANCE                     (reservado — futuro saldo em tempo real)
SYSTEM_INTERNAL                       (fallback — nunca deveria aparecer; existe para nunca faltar
                                        classificação)
```
Os quatro marcados "dispara ingestão" são os que adquirem o lease de D16; os demais só geram linha em
`radar_pluggy_calls`.

**Correção desta rodada: `BOOT_RECOVERY` não pode nascer dentro de `webhook-drainer.ts`.** O
`index.ts` do boot chama o mesmo `drainPluggyWebhookEvents` que o webhook HTTP chama — se o
`trigger` for decidido *dentro* do drenador (um `runWithCallContext({trigger: 'WEBHOOK'}, ...)`
fixo no início da função, como uma versão anterior desta proposta sugeria), o contexto do boot seria
sobrescrito pelo contexto interno, e toda chamada de recuperação no boot apareceria classificada como
`WEBHOOK` em `radar_pluggy_calls` — `BOOT_RECOVERY` nunca apareceria de fato. `drainPluggyWebhookEvents`
passa a receber `trigger` como **parâmetro explícito** (`drainPluggyWebhookEvents(container, trigger)`),
nunca um valor fixo internamente: o chamador HTTP passa `'WEBHOOK'`, o boot passa `'BOOT_RECOVERY'`.
O drenador usa esse `trigger` recebido para toda chamada Pluggy daquela passada — nunca cria um
`trigger` próprio que sobreponha o do chamador.

**Alternativa descartada**: `runWithCallContext({trigger: 'WEBHOOK'})` fixo dentro do drenador —
descartada porque é exatamente a causa da regressão descrita acima.

### D24 — Schema completo de `radar_pluggy_calls`, com ordinal de paginação e taxonomia de falha
Colunas: `id`, `item_id` (nullable), `connector_id` (nullable), `operation` (enum fechado, ver
abaixo), `http_method` (nullable — só para chamadas que são de fato HTTP; o SDK abstrai isso, mas o
gateway sabe o verbo de cada operação), `route_template` (nullable, ex.: `/items/{id}`, nunca a URL
com o `id` real interpolado), `call_scope`, `trigger`, `resource_type` (nullable), `resource_id`
(nullable), `request_correlation_id`, `webhook_event_id` (nullable), `page_ordinal` (nullable —
ver abaixo), `page_size` (nullable), `started_at`, `completed_at`, `duration_ms`, `http_status`
(nullable), `outcome` (enum: `SUCCEEDED`, `FAILED`), `failure_kind` (nullable — só preenchido quando
`outcome = FAILED`, enum: `CLIENT_ERROR`, `UPSTREAM_ERROR`, `TIMEOUT`, `UNAVAILABLE`, `UNKNOWN`),
`error_code` (nullable, o `errorType`/código nomeado, complementar a `failure_kind` — nunca
substituto), `created_at`.

**`page_ordinal`/`page_size` fecham a lacuna de rodada anterior**: a spec já exigia "paginação
reconstruível por `request_correlation_id` + ordinal seguro", mas a migration não tinha coluna para
esse ordinal. Para paginação numérica (`GET /investments?page=N`), `page_ordinal = N`, direto do
argumento já usado pelo gateway. Para paginação por cursor (`fetchTransactionsCursor`, sem número de
página nos argumentos do SDK), `page_ordinal` é um contador local — `1, 2, 3...` — mantido no
`CallContext` (D2), particionado por `operation + resource_id` (cada recurso escaneado tem sua
própria sequência, reiniciada a cada novo `runWithCallContext`); nunca o cursor opaco da Pluggy em
si.

**`outcome`/`failure_kind` restaura a taxonomia útil para IA/observabilidade** que uma revisão
anterior havia reduzido a um binário simples: `outcome` continua fechado e simples
(`SUCCEEDED`/`FAILED`), mas toda falha carrega também `failure_kind`, para que consultas de
frequência/anomalia não precisem interpretar dezenas de `error_code` distintos para saber se o
problema foi timeout, upstream indisponível, ou erro do próprio cliente. `pluggySdkError` (já
existente em `pluggy-client.gateway.ts`, usado por todos os gateways de borda para classificar
timeout/unavailable/upstream/4xx) já produz essa classificação — `instrumentPluggyClient` só precisa
reaproveitá-la, não reinventar.

**Nunca persistido**: corpo de requisição/resposta, saldo, valor monetário, descrição de transação,
`clientSecret`, `apiKey`, token, cursor opaco de paginação.

`operation` (enum fechado, cobre no mínimo): `AUTH`, `FETCH_ITEM`, `FETCH_INVESTMENTS`,
`FETCH_INVESTMENT_TRANSACTIONS`, `FETCH_LOANS`, `FETCH_ACCOUNTS`, `FETCH_ACCOUNT_TRANSACTIONS`,
`FETCH_CONSENTS`, `FETCH_WEBHOOKS`, `CREATE_WEBHOOK`, `UPDATE_WEBHOOK` — reservando desde já
`UPDATE_ITEM`, `REAL_TIME_BALANCE` para uso futuro sem migration nova.

Índices: `(item_id, started_at)`, `(item_id, operation, started_at)`, `(connector_id, operation,
started_at)`, `(trigger, started_at)`, `(request_correlation_id)`, `(webhook_event_id)`. Não existe
coluna `interval_since_last_call` — frequência entre chamadas continua calculada por `LAG()` em
consulta, nunca desnormalizada na escrita.

### D25 — Telemetria de `radar_pluggy_calls` nunca fica no caminho crítico da chamada de negócio
A implementação de "tentativa de persistência best-effort" (spec já fixada em rodada anterior) fecha
assim: depois que a chamada real ao SDK termina (sucesso ou falha), o resultado da chamada de negócio
é capturado primeiro; a gravação em `radar_pluggy_calls` é disparada **sem** `await` bloqueando o
retorno — o chamador original recebe seu resultado (ou a exceção original relançada) imediatamente
depois de a chamada real terminar, nunca depois de o `INSERT` terminar. Falha na gravação cai em
`logger.warn`, nunca altera o resultado nem o tipo de erro devolvido pela operação Pluggy original.

**Alternativa descartada**: `await` na gravação antes de devolver o resultado — descartada porque um
banco lento atrasaria toda chamada de negócio à Pluggy, contra o requisito explícito de "nunca
bloqueia".

### D26 — `Connector.products` (capability da instituição) e produtos habilitados do Item são conceitos diferentes, nunca um substituto do outro
`Connector.products: ProductType[]` (D19) é o que a instituição **suporta**. Mas um Item pode ser
criado/atualizado pedindo só um subconjunto (`POST /items {"products": ["ACCOUNTS", "TRANSACTIONS"]}`)
— confirmado na documentação oficial da Pluggy (`GET /items/{id}` devolve a lista de produtos
habilitados daquele Item) e no OpenAPI atual (campo `products` no schema de resposta de
`GET /items/{id}`, com o mesmo vocabulário de `ProductType`). `Connector.products` incluir
`INVESTMENTS` não significa que este Item específico pediu/coleta `INVESTMENTS`.

Dois conceitos, nunca fundidos:
- `connectorProducts` — capability da instituição, já capturado no vínculo (D19), muda raramente.
- `itemProducts` — produtos habilitados **deste Item**, pode mudar num `PATCH /items` futuro; por
  isso pertence ao **estado observado atual** (`radar_pluggy_item_observations.item_products`), não
  só ao cadastro.

**O SDK instalado não tipa `products` em `Item`** (`item.d.ts` não declara o campo, embora a
documentação e o OpenAPI atual o confirmem no payload real) — mais uma divergência SDK/documentação
como as três já corrigidas por D7. `PluggyItemsGateway.parseItem` já trata todo o payload como
`unknown` e valida campo a campo (`data = (await client.fetchItem(itemId)) as unknown as
PluggyItemResponse`, ver `pluggy-items.gateway.ts`) — `products` é parseado do **payload bruto**,
pelo mesmo padrão defensivo dos demais campos, nunca descartado só porque o `.d.ts` ficou para trás.

Se `data.products` estiver ausente ou não for um array de strings reconhecíveis, `itemProducts` fica
`undefined` — **estado `UNKNOWN`, nunca `[]`**. Um array vazio (`itemProducts: []`) e "não sabemos"
(`itemProducts: undefined`) são sinais diferentes: o primeiro afirma "nenhum produto habilitado", o
segundo afirma "não sabemos o que está habilitado". Essa distinção importa porque uma leitura tratada
como autoritativa (D21) sobre uma fonte que na verdade nunca foi solicitada apagaria dado local sem
necessidade — por isso `UNKNOWN` nunca vira "trate como se `Connector.products` decidisse":
`enabledForItem` só é `true`/`false` quando `itemProducts` foi de fato lido; quando `UNKNOWN`, a
fonte não é tratada como elegível nem como reconciliável, e a tradução de `/credentials/status`
expõe isso explicitamente (nunca infere de `connectorProducts`).

`/credentials/status.items[].sources.<fonte>` passa a expor `supportedByConnector`
(de `connectorProducts`) e `enabledForItem` (de `itemProducts`, podendo ser `true`/`false`/omitido
quando `UNKNOWN`) como campos distintos — `isUpdated`/`lastUpdatedAt` só aparecem quando
`enabledForItem === true`; uma fonte com `enabledForItem === false` nunca aparece com `isUpdated:
true`, e nenhum pipeline (`pluggy-sync-progress`, reconciliação D21) trata essa fonte como elegível.

**Alternativa descartada**: usar só `Connector.products` para decidir elegibilidade de fonte (o
desenho de todas as rodadas anteriores) — descartada por confundir capability da instituição com o
que o Item realmente pediu; o caso concreto que isso quebraria é um Item criado só com
`ACCOUNTS`/`TRANSACTIONS` cujo connector também suporta `INVESTMENTS` — o desenho anterior trataria
`INVESTMENTS` como elegível e uma leitura vazia (porque nunca foi solicitada) apagaria posição que
nunca existiu para apagar, ou pior, mascararia uma fonte genuinamente nunca coletada como "vazio
real".
**Alternativa descartada**: descartar `products` por não estar tipado no `.d.ts` do SDK instalado —
descartada pela mesma razão de D7: o `.d.ts` é promessa de compilação, não garantia de runtime; o
payload real e o OpenAPI atual confirmam o campo.

### D27 — `Item.lastUpdatedAt` é nullable mesmo em `SUCCESS`; fallback é `Item.updatedAt`, nunca um watermark inventado
O SDK declara `lastUpdatedAt: Date | null`, e a documentação oficial da Pluggy traz um exemplo
real com `{"executionStatus": "SUCCESS", "lastUpdatedAt": null, "statusDetail": null}` — a premissa
de rodadas anteriores (de que `SUCCESS` sempre traz `lastUpdatedAt`) é otimista demais.
`SyncPluggyPositionInteractor.execute` (já em `staging`) hoje recusa nomeando
(`PLUGGY_ITEM_SUCCESS_WITHOUT_LAST_UPDATED_AT`) quando isso acontece — o que, sob D12, deixaria o
Item nessa condição permanentemente inelegível para `pluggy-sync-progress` avançar, mesmo com dado
novo real disponível.

`Item.updatedAt: Date` (não-nullable no SDK, "data de última modificação do Item") é o fallback:
```
SUCCESS:
  versionAt = Item.lastUpdatedAt ?? Item.updatedAt
```
`last_completed_version_at`, nesse caminho de fallback, representa "quando o registro do Item mudou
pela última vez" — uma versão operacional da execução observada, **não necessariamente** "quando os
dados daquela fonte foram sincronizados" (a semântica que o valor normal, não-fallback, carrega).
Essa diferença é aceita porque a alternativa (nunca avançar, ou recusar para sempre) é pior: um Item
preso em `SUCCESS + lastUpdatedAt: null` nunca sairia do estado "sem watermark", e toda releitura
repetiria o mesmo resultado indefinidamente.

`PluggyItemsGateway.parseItem` passa a parsear `updatedAt` como campo obrigatório (mesmo padrão
defensivo dos demais — recusa nomeada, `PLUGGY_ITEMS_RESPONSE_INVALID`, se ausente ou malformado,
já que o SDK o documenta como sempre presente).

Para `PARTIAL_SUCCESS`, o fallback **não se aplica** — cada fonte tem sua própria versão
(`statusDetail.<fonte>.lastUpdatedAt`), e não faria sentido dar a duas fontes diferentes de uma
mesma execução parcial o mesmo valor de `Item.updatedAt`. A documentação do SDK garante: "se
coletado, `isUpdated` será `true` e `lastUpdatedAt` será a data" — ou seja, `isUpdated === true` sem
`lastUpdatedAt` é uma resposta que contradiz o próprio contrato documentado. Nesse caso:
```
PARTIAL_SUCCESS, isUpdated === true, lastUpdatedAt ausente:
  → não avança a marca d'água dessa fonte
  → erro nomeado (PLUGGY_ITEM_PRODUCT_UPDATED_WITHOUT_LAST_UPDATED_AT), logado
  → nunca inventa um valor (nem Item.updatedAt, nem Item.lastUpdatedAt)
```

**Alternativa descartada**: continuar recusando `SUCCESS + lastUpdatedAt: null` como erro permanente
— descartada porque deixa o Item preso, sem caminho de saída, para um caso que a própria Pluggy
documenta como possível.
**Alternativa descartada**: aplicar o fallback `Item.updatedAt` também a uma fonte de
`PARTIAL_SUCCESS` sem `lastUpdatedAt` — descartada porque contradiz a semântica por fonte que D12
estabelece, e porque um contrato documentado sendo violado merece recusa nomeada, não um valor
inventado que mascara a inconsistência.

### D28 — Eventos de webhook além de `item/created`/`item/updated` atualizam o estado observado; `item/deleted` é terminal
A inscrição de webhook já pede `event: 'all'` (`WEBHOOK_EVENT_ALL`, `pluggy-webhooks.gateway.ts`) —
a Pluggy manda todo evento (`item/error`, `item/waiting_user_input`, `item/waiting_user_action`,
`item/login_succeeded`, `item/deleted`, `connector/status_updated`, entre outros), mas
`PluggyWebhookEvent.isApplicable()` hoje só reconhece `item/created`/`item/updated` — todo o resto é
"reconhecido e concluído sem trabalho". Isso deixa `pluggy-connection-observability` mentindo: um
`item/error` (a Pluggy documenta como "o Item encontrou erro na execução", ex.: virou `LOGIN_ERROR`,
e a Pluggy **para** o auto-sync daquele Item) nunca atualiza `radar_pluggy_item_observations` — o
estado observado continua `CONNECTED` indefinidamente, porque nenhum evento seguinte vai disparar uma
releitura.

Três categorias, fechadas:
```
FULL_INGESTION     item/created, item/updated
                   → adquire lease (D16), roda Position e History (D15)

OBSERVATION_REFRESH  item/error, item/waiting_user_input, item/waiting_user_action,
                     item/login_succeeded
                   → PluggyItemStateResolver.read(itemId) (fetchItem + observação + connector,
                     D9/D18) — não precisa de lease nem roda Position/History: o objetivo é só
                     refletir o estado atual, e a escrita de observação já é atômica por si (D17)

TERMINAL           item/deleted
                   → NUNCA chama fetchItem (o recurso não existe mais na Pluggy, um fetch
                     devolveria 404) — marca radar_pluggy_credential_items.inactive_at = now() para
                     aquele item; connectionStatus passa a DISCONNECTED (novo valor no vocabulário
                     fechado de pluggy-connection-observability), decidido diretamente por
                     inactive_at estar presente, sem depender de nenhuma observação nova
```
`connector/status_updated` e webhooks de transação continuam deliberadamente ignorados (decisão já
existente, agora documentada explicitamente): não mudam o estado observado de nenhum Item
específico, e nenhuma decisão desta capability depende deles hoje.

Um Item `TERMINAL` deixa de contribuir fotografia para `/portfolio`/`/accounts`/extrato — ver D29.
Raw/snapshot histórico nunca são apagados; só a fotografia "atual" para de considerar aquele Item.

A Pluggy pode emitir `item/deleted` de forma automática (por exemplo, depreciação de connector) —
não é um caso hipotético a ignorar.

**Alternativa descartada**: tentar `fetchItem` mesmo em `item/deleted`, para "confirmar" — descartada
porque o recurso já não existe: a chamada devolveria erro, sem nenhuma informação nova, e geraria uma
linha de falha em `radar_pluggy_calls` sem propósito.
**Alternativa descartada**: ignorar `item/error`/os demais eventos de observação, como hoje —
descartada porque é exatamente a lacuna que motivou este ponto: o titular pode continuar vendo
`CONNECTED` depois de uma quebra real.

### D29 — Item terminal (`item/deleted`) para de contribuir fotografia atual, sem apagar histórico
`PluggyPersonItemResolver.itemIdsFor(personId)` é o único ponto que decide quais `itemId`s entram na
leitura de `/portfolio` (`ReadPluggyPositionInteractor`) e `/accounts` (`ReadPluggyAccountInteractor`)
— os dois interactors chamam `readItemIdsForPerson` que delega inteiramente a esse resolver. Um
único ajuste ali (filtrar `radar_pluggy_credential_items.inactive_at IS NULL`) já corrige os dois
endpoints e o extrato de cartão (que deriva de `accounts`), sem duplicar a regra.

`GET /credentials/status` reflete o mesmo marcador: um item com `inactive_at` presente aparece com
`connectionStatus: DISCONNECTED`, decidido antes de qualquer tradução `(status, executionStatus)` —
o estado bruto que a última observação guardou já não importa depois que o Item foi apagado do lado
da Pluggy.

**Alternativa descartada**: apagar fisicamente o vínculo ou a fotografia quando `item/deleted` chega
— descartada porque destruiria histórico/auditoria sem necessidade; `inactive_at` preserva tudo e
resolve o problema (fotografia atual para de considerar o Item) com uma escrita aditiva.

### D30 — Rota manual: um `runWithCallContext` só, cobrindo a chamada síncrona de History e a continuação assíncrona de Position
`POST /items/:itemId/history/load` (D16) precisa que `trigger=MANUAL_HISTORY_LOAD`,
`requestCorrelationId` e o `fencing_token` do lease adquirido atravessem corretamente a fronteira
entre "History síncrono, resposta HTTP já enviada" e "Position em background depois". A resolução:
todo o corpo do handler — a chamada síncrona a `LoadPluggyHistoryInteractor` **e** o disparo de
`syncPluggyPositionInBackground` — roda dentro de uma única chamada a `runWithCallContext(ctx, async
() => {...})`. Isso funciona porque `AsyncLocalStorage` propaga pela cadeia de causalidade
assíncrona, não pelo "a função externa já retornou": contanto que o disparo de Position seja feito
*de forma síncrona*, como parte da mesma função `async` passada a `runWithCallContext` (mesmo que a
promise de Position não seja aguardada ali), a continuação de Position — inclusive seu próprio
`.then()`/`.catch()` — ainda roda dentro do mesmo contexto. É o mesmo mecanismo que já sustenta o
padrão fire-and-forget do drenador de webhook e da pré-carga (D2) — aplicado aqui à rota manual, que
hoje não o usa.

Fluxo do handler:
```
runWithCallContext({trigger: 'MANUAL_HISTORY_LOAD', requestCorrelationId}, async () => {
  fencingToken = tryAcquire(itemId, 'MANUAL_HISTORY_LOAD', ttl)
  se não conseguiu: responde recusa nomeada, retorna
  inicia heartbeat (renew a cada ttl/3)
  history = await LoadPluggyHistoryInteractor.execute(...)
  responde HTTP com history (lease e heartbeat continuam vivos)
  syncPluggyPositionInBackground(...)      // síncrono aqui dentro — herda o contexto
    .then/.catch(...)
    .finally(() => { para heartbeat; release(itemId, fencingToken) })
})
```
O `fencingToken` é uma variável capturada por closure, compartilhada entre a chamada síncrona de
History e a continuação de Position — não precisa passar por `AsyncLocalStorage`, só o contexto de
observabilidade (`trigger`/`requestCorrelationId`) precisa.

**Alternativa descartada**: liberar o lease logo após History responder, antes de Position rodar —
descartada porque reabriria a janela de corrida que D16 fecha: um webhook para o mesmo item poderia
começar a processar enquanto Position ainda está em voo.

### D31 — `PluggyCallRecorder`: serviço singleton explícito, nunca DB dentro de `AsyncLocalStorage`
`AsyncLocalStorage` (D2) carrega só dados contextuais (`trigger`, `webhookEventId`,
`requestCorrelationId`, contador de página) — nunca um repositório, model ou conexão de banco: isso
seria service locator implícito, e quebraria o registro explícito por DI que o resto do código já
segue. A peça que falta é: quem, concretamente, grava a linha em `radar_pluggy_calls` a partir do
override de `getApiKey` (D1) e do Proxy de `instrumentPluggyClient` (D3), já que
`PluggyConnectorClient` é singleton cacheado fora de qualquer escopo Awilix e não tem acesso natural
a um repositório `.scoped()`.

`PluggyCallRecorder` é um serviço **singleton** (registrado no container raiz, resolvido uma vez,
como `PluggyClientGateway` já é):
```ts
interface PluggyCallRecorder {
  record(event: PluggyCallEvent): void   // nunca async do ponto de vista de quem chama — dispara e
                                          // não bloqueia (D25); grava sem a transação do chamador
}
```
Recebe o model/conexão do banco pelo mesmo padrão de construtor já usado em todo repositório
(`constructor(params: AppContainer) { this.model = params.db.models.pluggyCall; this.logger =
params.logger }`), mas nunca lê `getTransaction()` do escopo de quem chamou — sempre grava fora de
qualquer transação de negócio (autocommit), exatamente como D25 exige.

Wiring:
- `PluggyClientGateway` (já singleton) recebe `PluggyCallRecorder` via DI e o repassa para cada
  `PluggyConnectorClient` que constrói (parâmetro de construtor ou setter) — é isso que o override de
  `getApiKey` (D1) chama diretamente para gravar `AUTH`.
- `instrumentPluggyClient(client, {itemId, connectorId}, recorder)` passa a receber `recorder` como
  parâmetro explícito — os três pontos de chamada (D3: `PluggyItemCredentialResolver.clientFor`,
  `RegisterPluggyCredentialImpl.validateItemAccess`, `PluggyWebhookProvisioner.provisionFor`, D22)
  resolvem `pluggyCallRecorder` do próprio container Awilix (um singleton é resolvível de qualquer
  escopo) e o passam.
- O Proxy de `instrumentPluggyClient` e o override de `getApiKey` leem `currentCallContext()` (D2)
  **só** para os campos contextuais (`trigger`, `webhookEventId`, `requestCorrelationId`, ordinal de
  página) — nunca para obter o recorder em si.

**Alternativa descartada**: guardar o recorder ou o repositório dentro de `AsyncLocalStorage` —
descartada porque mistura dado contextual com dependência de infraestrutura, e reintroduz service
locator implícito, que o resto da arquitetura deste serviço evita deliberadamente.

### D32 — Tabela única de tradução `ProductType ↔ chave de statusDetail ↔ PluggySource`
Três vocabulários describem os mesmos cinco recursos, e não coincidem: `ProductType` do SDK
(`ACCOUNTS`, `TRANSACTIONS`, `INVESTMENTS`, `INVESTMENTS_TRANSACTIONS` — com "S" —, `LOANS`), a chave
de `Item.statusDetail` (`accounts`, `transactions`, `investments`, `investmentTransactions` — sem
"S" em Investments —, `loans`), e o vocabulário de domínio deste change (`ACCOUNTS`,
`ACCOUNT_TRANSACTIONS`, `INVESTMENTS`, `INVESTMENT_TRANSACTIONS`, `LOANS`). Espalhar essa tradução em
vários arquivos (como as rodadas anteriores já começaram a fazer, implicitamente, em
`PluggyItemsGateway`, no futuro `PluggySyncProgressRep`, e na tradução de `/credentials/status`) é
como o bug de D7 (`investmentsTransactions` vs `investmentTransactions`) aconteceu da primeira vez.

Módulo único, `adapters/gateways/pluggy-source-catalog.ts`, exportando a tabela completa e funções
derivadas (`sourceFromProductType`, `sourceFromStatusDetailKey`, `statusDetailKeyFromSource`,
`productTypeFromSource`) — toda tradução entre os três vocabulários passa por aqui, com teste de
tabela cobrindo as cinco linhas nos dois sentidos. Usado por: parsing de `itemProducts`/
`connectorProducts` (D26), parsing de `statusDetail` (D7, já existente — migra para usar o módulo),
`pluggy-sync-progress` (D4/D12), tradução de `/credentials/status` (D10/D20).

**Alternativa descartada**: manter a tradução implícita em cada arquivo que precisa dela (o estado
atual) — descartada porque já causou uma divergência real (D7) e continuaria causando outras à medida
que mais pontos do código precisarem cruzar os três vocabulários.

### D33 — Schema completo de `radar_pluggy_item_observations`
D20 depende desta tabela para responder `/credentials/status` **sem** chamar `fetchItem` de novo —
isso só é possível se o schema guardar tudo que a tradução precisa, não só o token de ordenação.
Colunas: `id`, `item_id` (único), `status`, `execution_status`, `status_detail` (JSON, nullable —
espelha `Item.statusDetail`, já `null` em `SUCCESS`, D12), `item_products` (JSON, nullable — D26,
`null` quando `UNKNOWN`), `last_updated_at` (nullable, D27), `next_auto_sync_at` (nullable),
`connector_id` (nullable, denormalizado — D8), `observation_started_at` (D9.1), `created_at`,
`updated_at`.

## Risks / Trade-offs

- **[Risco]** `radar_pluggy_credential_items` já tem linhas reais sem `connector_id` (2 linhas
  confirmadas nos bancos consultados) → **[Mitigação]** coluna nasce nullable; a próxima observação
  aceita (D18) já preenche retroativamente, sem script de backfill.
- **[Risco]** Mudar o portão de posição/histórico de item-level para por-`(consumer, source)` aumenta
  o número de vezes que o item é relido quando uma fonte específica está presa → **[Mitigação]** é o
  comportamento pedido explicitamente — tentar de novo é mais seguro que esquecer uma fonte, e o
  custo é só chamada técnica, não quota Open Finance (ver ADR já fechado).
- **[Risco]** `GET /credentials/status` ganha `items[]`/`sources`, mas o `oplab-radar-front` só passa
  a consumir esse campo num PR próprio, depois da publicação deste change → **[Mitigação]** risco
  baixo porque a mudança é aditiva (D10): `hasCredential` mantém shape e posição, o front atual
  continua funcionando sem alteração.
- **[Risco]** `AsyncLocalStorage` introduz um mecanismo de propagação de contexto que não existia
  neste código → **[Mitigação]** escopo estrito (`call-context.ts`), usado só para
  `trigger`/`webhookEventId`/`requestCorrelationId` de observabilidade — nunca para decisão de
  negócio.
- **[Risco]** `radar_pluggy_calls` é auditoria best-effort — processo morto entre a resposta da
  Pluggy e o `INSERT`, ou MySQL indisponível, produz uma chamada real sem registro correspondente →
  **[Mitigação]** aceito como limite conhecido (D25), não corrigido por outbox/lock/transação com a
  chamada de negócio. Falha de gravação é sempre logada.
- **[Risco]** O lease de ingestão por item (D16) introduz um novo mecanismo de exclusão mútua fora do
  já existente para eventos de webhook → **[Mitigação]** mesmo idioma de claim atômico já testado
  (`PluggyWebhookEventRep`), tabela nova e pequena, sem dependência de Redis; testes concorrentes
  representativos exigidos (D17) cobrem a mesma classe de risco.
- **[Risco]** Reescrever `load-pluggy-item-in-background.ts` em vez de mergear o PR #12 como está
  atrasa a entrega do requisito funcional dele → **[Mitigação]** o requisito funcional (pré-carga
  sem bloquear `201`) é preservado integralmente; só o mecanismo interno muda, e a implementação já
  nasce correta em vez de precisar de um PR de correção logo depois.
- **[Risco]** Reconciliar a fotografia atual (D21) numa leitura autoritativa remove localmente
  posições/contas que a Pluggy pode reportar de volta numa execução futura (ex.: instabilidade
  momentânea do lado da instituição) → **[Mitigação]** a reconciliação só roda quando a fonte é
  `isUsable` (coleta real bem-sucedida, D6) — nunca em execução recusada/parcial não coletada; o
  raw/snapshot preserva o histórico para qualquer auditoria posterior.
- **[Risco]** O lease de ingestão (D16), mesmo com fencing token e heartbeat, não fecha 100% a
  janela entre processos diferentes numa pausa de GC longa → **[Mitigação]** aceito e documentado
  explicitamente em D16: o lease evita trabalho duplicado, mas a integridade do dado nunca depende
  só dele — D17 (escrita atômica condicional) protege `radar_pluggy_sync_progress`/
  `radar_pluggy_item_observations` mesmo numa sobreposição residual.
- **[Risco]** Distinguir `connectorProducts`/`itemProducts` (D26) com um SDK que não tipa `products`
  em `Item` aumenta a superfície de parsing defensivo → **[Mitigação]** mesmo padrão já usado para
  todo o resto do payload (`unknown` + validação campo a campo, D7); ausência/formato inesperado vira
  `UNKNOWN` nomeado, nunca inferência silenciosa a partir de `connectorProducts`.
- **[Risco]** Categorizar eventos de webhook além de `item/created`/`item/updated` (D28) aumenta o
  volume de eventos que o drenador processa (incluindo `item/error`, que pode repetir enquanto a
  conexão estiver quebrada) → **[Mitigação]** `OBSERVATION_REFRESH` não roda Position/History nem
  adquire lease — é só uma releitura + escrita atômica de observação, barata e sem risco de
  concorrência com uma ingestão em andamento.

## Migration Plan

1. `pluggy-source-catalog.ts` (D32) primeiro — sem dependência de nada, e todo o resto (parsing de
   shape, `pluggy-sync-progress`, `/credentials/status`) passa a usá-lo em vez de repetir a tradução.
2. Migrations aditivas (`radar_pluggy_item_observations` com schema completo — D33 —,
   `radar_pluggy_calls` com schema completo — D24 —, `radar_pluggy_item_ingestion_leases` com
   `fencing_token` — D16 —, `radar_pluggy_credential_items` + colunas de connector,
   `connector_products` e `inactive_at` — D19, D29) — não quebram nada em produção porque nenhum
   código ainda as lê.
3. Migration de `radar_pluggy_sync_progress` (cria, com `consumer` + `source` +
   `last_completed_version_at`) + remoção de `radar_pluggy_history_sync_states` (drop) na mesma
   migration — seguro porque a tabela está vazia em todos os ambientes consultados.
4. Correções de shape (D6, D7, D26, D27) entram isoladas, antes de qualquer interactor passar a
   depender delas: chave `investmentTransactions`, `loans` em `PRODUCT_KEYS`, `itemProducts` parseado
   do payload bruto, `updatedAt` parseado como campo obrigatório.
5. Escrita atômica (D17) nos repositórios já existentes (`PluggyItemRep`, `PluggyHistoryCoverageRep`)
   entra antes da reescrita dos interactors — reduz o raio de um rollback, e corrige um problema que
   já existe em `staging` independente do resto deste change.
6. Reescrita dos dois interactors (D4, D5, D12, D13, D14, D21, D26, D27) depois das correções de
   shape e da escrita atômica.
7. Lease de ingestão com fencing token e heartbeat (D16) + `pluggy-item-ingestion.ts` (D11, D15) +
   reescrita de `webhook-drainer.ts` (D15, D16, D23 — `trigger` explícito) + rota manual (D30) —
   depende de D4/D5 (marca d'água por fonte) já existir para o "cada lado tenta de novo barato"
   funcionar.
8. Categorização de eventos de webhook (D28) + `inactive_at`/`DISCONNECTED` (D28, D29) — depende do
   lease (passo 7) só para a categoria `FULL_INGESTION`; `OBSERVATION_REFRESH`/`TERMINAL` não
   dependem dele.
9. `PluggyCallRecorder` (D31) + instrumentação (D1–D3, D22) — depende do passo 7/8 só na medida em
   que os pontos de chamada (`clientFor`, `validateItemAccess`, `provisionFor`) já existem; entra por
   último porque é a peça mais nova (`AsyncLocalStorage` + serviço singleton) e a que mais se
   beneficia de rodar sobre um portão e uma coordenação já corrigidos.
10. `/credentials/status` (D8–D10, D18–D20, D26) por último no backend — depende da observação (D9),
    do connector (D8/D19/D26) e da categorização de eventos (D28, para `DISCONNECTED`) já existirem.
    Mudança aditiva (`items[]`) — pode ir a produção sem o front estar pronto para consumi-lo.
11. `oplab-radar-front` consome `items[]`/`sources` num PR próprio, depois do passo 10 publicado.

Rollback: cada passo é uma migration aditiva ou uma troca de leitura sem mudança de escrita anterior
— reverter é possível parando no passo anterior, exceto o passo 3 (drop de
`radar_pluggy_history_sync_states`), que é irreversível sem recriar a tabela vazia — aceitável dado
que nenhum ambiente consultado tem dado nela.
