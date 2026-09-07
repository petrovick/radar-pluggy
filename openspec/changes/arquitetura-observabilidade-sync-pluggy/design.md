## Context

Ver `proposal.md` (Why) para a motivação. Este documento assume como pano de fundo:

- O `radar-pluggy` usa MySQL/Sequelize, Awilix como DI, e `pluggy-sdk@^0.90.0` (o SDK instalado, não
  a documentação textual, foi a fonte usada para decisões de shape de payload — ver Decisões).
- Toda chamada de borda à Pluggy passa por `pluggy-sdk`'s `PluggyClient`/`BaseApi`. Um único ponto
  cacheia instâncias de client por `clientId` (`PluggyClientGateway`, singleton) e um único ponto
  resolve "qual client uso pra este item" (`PluggyItemCredentialResolver`, scoped por unidade de
  trabalho — request HTTP, evento de webhook, disparo manual).
- Hoje existem dois interactors que releem o `Item` de forma independente dentro do mesmo ciclo de
  trabalho (`SyncPluggyPositionInteractor`, `LoadPluggyHistoryInteractor`), e uma pré-carga que já
  dispara após `POST /credentials` reutilizando os dois, sem pipeline próprio
  (`loadPluggyItemInBackground`).
- Os bancos de desenvolvimento consultados neste change não têm nenhuma linha real em
  `radar_pluggy_item_raw`, `radar_pluggy_items` nem `radar_pluggy_history_sync_states` — as decisões
  de schema abaixo partem dessa ausência de dado real a migrar.

## Goals / Non-Goals

**Goals:**
- Tornar observável, sem inventar mecanismo de quota, o estado de conexão de cada Item e todo
  esforço que o serviço faz contra a Pluggy.
- Corrigir a marca d'água de sincronização para não perder produtos recusados por limite
  operacional, sem reinterpretar o significado já fixado de `radar_pluggy_items`.
- Fechar, nesta mesma decisão, três divergências reais entre o código e o SDK instalado que afetam
  diretamente a correção do que está sendo desenhado aqui.

**Non-Goals:**
- Não reintroduz controle de quota Open Finance, Admission Control, scheduler ou budget por página —
  decisões já revogadas em `ADR-radar-pluggy-open-finance-consumo-sincronizacao.md` continuam
  revogadas.
- Não adiciona Redis, cron, nem retry customizado.
- Não estrutura `radar_pluggy_calls` como fonte de quota restante — é auditoria, não contador.
- Não decide a UI final do `oplab-radar-front` além do contrato de dados e das regras de qual
  mensagem aparece em qual estado — o desenho visual fica com quem implementa a view.

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
`load-pluggy-item-in-background.ts`, `sync-pluggy-position-in-background.ts`) mais um novo
(`RegisterPluggyCredentialInteractor`, em volta da chamada de validação).

**Alternativa descartada**: threading explícito de `trigger` por parâmetro em cada método de gateway
— rejeitado por exigir mudar a assinatura de cada um dos 8 gateways de borda, o que o pedido original
("sem duplicar lógica") já descartava.

### D3 — Instrumentação de chamadas por item é uma função só, usada em dois pontos, não um Proxy fixo no client
`instrumentPluggyClient(client, {itemId, connectorId})` embrulha o client recebido (cacheado ou
`freshClient`) num Proxy de método, resolvendo `item_id`/`connector_id`/`resource_type`/`resource_id`
por uma tabela estática `operação → metadado`, porque o primeiro argumento de cada método do SDK não
é uniformemente `itemId` (`fetchInvestmentTransactions` recebe `investmentId`,
`fetchTransactionsCursor` recebe `accountId`, `fetchWebhook` recebe `webhookId` — confirmado lendo os
8 gateways de borda). É chamada em exatamente dois lugares: `PluggyItemCredentialResolver.clientFor`
(client cacheado, pós-persistência) e `RegisterPluggyCredentialImpl.validateItemAccess` (client
descartável, pré-persistência) — mesma função, `itemId` diferente em cada chamada.

**Alternativa descartada**: envolver o client uma vez só, no momento em que
`PluggyClientGateway.createClient` o constrói — rejeitada porque nesse momento o `itemId` da chamada
ainda não é conhecido (um `clientId` pode ter vários itens vinculados), e a garantia pedida
("100% das chamadas com `item_id` correto, sem depender de join posterior") exige o `itemId` no ponto
de uso, não no de construção.

### D4 — Marca d'água é por fonte real da Pluggy, nunca por agrupamento de negócio (`CASH`/`CUSTODY`)
`CASH` e `CUSTODY` são agrupamentos deste domínio, não conceitos com `lastUpdatedAt` próprio na
Pluggy. `node_modules/pluggy-sdk/dist/types/item.d.ts` mostra que `Item.statusDetail`
(`ItemProductsStatusDetail`) já reporta, para cada chave — `accounts`, `transactions`, `investments`,
`investmentTransactions`, `loans`, entre outras — um `ItemProductState` próprio (`isUpdated`,
`lastUpdatedAt`). O código hoje já combina duas dessas chaves por agrupamento sem nunca ter
resolvido isso em watermark: `load-pluggy-history.impl.ts` monta `cashProduct` de
`[item.products.accounts, item.products.transactions]` e `custodyProduct` de
`[item.products.investments, item.products.investmentsTransactions]`, só para extrair
`limitedByRateLimit` — a única marca d'água real hoje é `item.lastUpdatedAt`, no nível do Item
inteiro (`radar_pluggy_history_sync_states`).

A marca d'água nova é por (`itemId`, `consumer`, `source`) — **três** dimensões, não duas. `source` é
o recurso real, não o agrupamento: `ACCOUNTS`, `ACCOUNT_TRANSACTIONS` (mapeada da chave
`transactions` do SDK — renomeada aqui para não colidir com o nome genérico da chave),
`INVESTMENTS`, `INVESTMENT_TRANSACTIONS` (chave `investmentTransactions`, já corrigida por D7),
`LOANS`. `consumer` é o pipeline que processa aquela fonte: `POSITION_SYNC`
(`SyncPluggyPositionInteractor`) ou `HISTORY_LOAD` (`LoadPluggyHistoryInteractor`) — nomeados pelo
próprio interactor consumidor, para não inventar um terceiro vocabulário.

**Por que `consumer` é obrigatório, não opcional**: marca d'água não representa "qual versão desta
fonte existe na Pluggy" — representa "até qual versão desta fonte *este consumidor* processou com
sucesso". `INVESTMENTS` é acompanhada pelos dois interactors, mas cada um processa algo diferente a
partir dela: `POSITION_SYNC` grava a fotografia de posição; `HISTORY_LOAD` usa a lista de
investimentos só para descobrir quais IDs escanear em busca de transações de custódia. Sem a
dimensão `consumer`, uma chave só (`itemId`, `INVESTMENTS`) seria compartilhada pelos dois: se
`POSITION_SYNC` roda primeiro (webhook processa posição antes de histórico) e avança essa marca
d'água para V2, `HISTORY_LOAD` no mesmo ciclo veria `INVESTMENTS` "já em dia" e pularia sua própria
descoberta de investimentos — mesmo nunca tendo processado nada para custódia. Isso contradiria a
própria regra de `pluggy-transaction-history` de que mudança em `INVESTMENTS` **ou**
`INVESTMENT_TRANSACTIONS` torna `CUSTODY` elegível. Com `consumer` na chave, `(POSITION_SYNC,
INVESTMENTS)` e `(HISTORY_LOAD, INVESTMENTS)` são linhas independentes: o avanço de uma nunca move a
outra.

**Nomes revistos para deixar as três dimensões explícitas** (a versão anterior deste documento tinha
só duas — `itemId` + `product` — e por isso escondia esse bug): `radar_pluggy_history_sync_states` é
renomeada para `radar_pluggy_sync_progress` (não mais "`_product_sync_states`" — a tabela não guarda
progresso de produto Pluggy, guarda progresso de *consumidor* por fonte), com colunas `item_id`,
`consumer`, `source` (chave composta `item_id + consumer + source`) e
`last_completed_source_updated_at`. A entity é `PluggySyncProgress`; o repositório,
`PluggySyncProgressRep`, com `read(itemId, consumer, source)`/`advance(itemId, consumer, source,
updatedAt)`. A capability correspondente é renomeada de `pluggy-product-sync-state` para
`pluggy-sync-progress` no mesmo espírito.

- `SyncPluggyPositionInteractor` lê/avança `(POSITION_SYNC, INVESTMENTS)` e `(POSITION_SYNC, LOANS)`.
- `LoadPluggyHistoryInteractor` lê/avança `(HISTORY_LOAD, ACCOUNTS)`, `(HISTORY_LOAD,
  ACCOUNT_TRANSACTIONS)` (fontes de `CASH`) e `(HISTORY_LOAD, INVESTMENTS)`, `(HISTORY_LOAD,
  INVESTMENT_TRANSACTIONS)` (fontes de `CUSTODY`). `CASH` é elegível para varredura quando
  `ACCOUNTS` **ou** `ACCOUNT_TRANSACTIONS` (sempre sob `HISTORY_LOAD`) estiver desatualizada (conta
  nova ou lançamento novo numa conta já conhecida, qualquer um dos dois justifica reler); `CUSTODY`,
  quando `INVESTMENTS` **ou** `INVESTMENT_TRANSACTIONS` (idem) estiver desatualizada. Depois de
  varrer, cada fonte realmente processada avança a própria marca d'água — nunca as duas juntas como
  um valor só, e nunca a marca d'água do outro consumidor.

Isso fecha, para o histórico também, a mesma classe de risco que motivou o pedido original: o portão
de item-level do histórico já sofria do mesmo problema, só mascarado por `PluggyHistoryCoverage`
reprocessar qualquer fonte sem observação assim que o portão de item reabre.

**Alternativas descartadas**:
- Criar uma tabela nova só para posição, deixando a de histórico como estava — rejeitada por deixar
  duas semânticas de watermark concorrentes no mesmo código, e por deixar sem correção um risco que
  já existia no histórico.
- Manter `CASH`/`CUSTODY` como o próprio vocabulário de produto da marca d'água (a primeira revisão
  deste documento) — rejeitada porque nenhuma das duas tem um único `lastUpdatedAt` real na Pluggy;
  a composição de duas chaves (`accounts`+`transactions`, `investments`+`investmentTransactions`) em
  um valor só exigiria escolher implicitamente `MAX`, `MIN` ou o `lastUpdatedAt` do Item, e qualquer
  uma dessas escolhas perde atualização (`MIN`) ou reprocessa fonte que não mudou (`MAX`,
  `Item.lastUpdatedAt`) sem necessidade.
- Chave só (`itemId`, `source`), com `INVESTMENTS` compartilhada entre os dois interactors (a
  segunda revisão deste documento) — rejeitada porque um consumidor avançar a marca d'água libera
  (incorretamente) o outro de processar sua própria parte, exatamente o cenário descrito acima; a
  marca d'água precisa representar progresso de um consumidor específico, não um fato só sobre a
  fonte.

### D5 — `radar_pluggy_items` preserva, sem reinterpretação, "última ingestão completa e bem-sucedida"
A marca d'água de item (`radar_pluggy_items.last_updated_at`) só avança quando
`executionStatus === 'SUCCESS'` — nunca em `PARTIAL_SUCCESS`, mesmo que uma ou mais fontes tenham
sido processadas. O portão de entrada do interactor (decidir se vale a pena tentar o ciclo) passa a
ser a união de "watermark de item está velha" OU "alguma marca d'água de `(consumer, source)` daquele
interactor está velha" — nunca só a de item. O que decide se uma fonte específica é retentada é
sempre a marca d'água daquele `(consumer, source)`, nunca a de item.

**Alternativa descartada**: avançar a marca d'água de item também em execuções parciais (a versão
originalmente proposta antes desta rodada) — revertida porque mudava silenciosamente o significado já
fixado do campo.

### D6 — "Produto limitado" é decidido por `isUpdated`, não pelo código do `warning`
`node_modules/pluggy-sdk/dist/types/item.d.ts` declara `ITEM_PRODUCT_STEP_WARNING_CODES = ["001"]` —
não existe `"423"` nem `"RATE_LIMIT"` em nenhum lugar do pacote instalado (busca no `dist` inteiro
não encontrou nenhuma ocorrência). O único código documentado não distingue motivo — a razão real só
existe em texto livre (`message`). O campo que já é estruturado e suficiente para a decisão de
negócio é `ItemProductState.isUpdated: boolean`: se `false` (ou ausente) num item `PARTIAL_SUCCESS`,
o produto não foi coletado nesta execução, seja qual for o motivo. `warnings[].code/message`
continuam capturados e logados para auditoria, mas saem da decisão de negócio — em
`SyncPluggyPositionInteractor` e em `LoadPluggyHistoryInteractor`, mesma função compartilhada.

**Alternativa descartada** (decisão de uma rodada anterior deste change, revertida aqui com nova
evidência): manter um conjunto de códigos conhecidos (`'423'` + os três antigos) e logar código
desconhecido — descartada porque a nova evidência do SDK instalado mostra que nenhum desses códigos
é o real, e que o campo booleano já resolve o problema sem depender de acertar uma string.

### D7 — Três correções de shape, fechadas nesta mesma decisão porque bloqueiam D4/D6
Lendo `item.d.ts` do SDK instalado: (a) a chave de `statusDetail` é `investmentTransactions`
(singular), o código lê `investmentsTransactions` (plural) e nunca bate — corrigido; (b)
`PRODUCT_KEYS` em `PluggyItemsGateway` não inclui `'loans'`, então `statusDetail.loans` é descartado
antes de qualquer decisão — corrigido; (c) `ItemStatus` real tem sete valores
(`WAITING_USER_ACTION`, `MERGING` além dos cinco já aceitos) — `PluggyItem.VALID_STATUSES` ganha os
dois que faltavam.

### D8 — `connectorId` é capturado no cadastro e atualizado em toda observação subsequente do Item
`Item.connector: Connector` já vem embutido em todo `GET /items/{id}` (`id`, `name`, `imageUrl`,
`primaryColor`, entre outros) — sem chamada extra a `GET /connectors/{id}`. É capturado no momento em
que `RegisterPluggyCredentialImpl.validateItemAccess` já lê o item pela primeira vez (pré-persistência)
e persistido em `radar_pluggy_credential_items` na mesma operação que cria o vínculo — nunca inferido
por nome de instituição.

Isso não é a única escrita: sempre que um Item válido é observado (`PluggyItemStateResolver.read`,
D9) e o payload traz `connector`, os quatro campos (`connector_id`, `connector_name`,
`connector_image_url`, `connector_primary_color`) são regravados no vínculo credencial↔item — mesmo
connector já conhecido regrava o mesmo valor (idempotente); connector diferente do último conhecido
substitui. Dois efeitos, pela mesma escrita: vínculos legados com `connector_id = null` são
preenchidos na próxima leitura válida sem script de backfill, e uma mudança futura de metadata do
connector na Pluggy (nome, imagem, cor) chega ao vínculo sem depender de re-cadastro. Continua sem
chamada extra a `GET /connectors/{id}` — sempre o `connector` já embutido no `GET /items/{id}` que o
resolver já faz. `radar_pluggy_item_observations` e `radar_pluggy_calls` guardam só `connector_id`
(numérico, denormalizado para consulta), não repetem nome/imagem — evita duplicar texto que pode
desatualizar se a Pluggy renomear um connector.

**Alternativa descartada**: capturar o connector uma única vez, no cadastro, e nunca mais relê-lo —
descartada porque deixava vínculos legados (`connector_id = null`, sem observação anterior) sem
caminho de preenchimento além de um script manual, e deixava o vínculo cego a uma mudança real de
metadata que a Pluggy já relata a cada leitura.

### D9 — Terceira leitura do Item, dentro do mesmo ciclo, é eliminada por cache de escopo — não por acoplar os dois interactors
`SyncPluggyPositionImpl` e `LoadPluggyHistoryImpl` são resolvidos do mesmo escopo Awilix dentro de um
único ciclo de webhook/preload. `PluggyItemStateResolver` (novo, `.scoped()`, mesmo padrão de
memoização por escopo que `PluggyItemCredentialResolver` já usa) expõe `read(itemId)`: primeira
chamada busca e persiste a observação; qualquer chamada seguinte, no mesmo escopo, devolve o mesmo
snapshot sem nova rede. Os dois interactors continuam chamando `read(itemId)` sem saber um do outro —
zero acoplamento de contrato entre eles.

`PluggyItemStateResolver.read` só é chamado por consumidores que já assumem o vínculo
credencial↔item existente (`SyncPluggyPositionImpl`, `LoadPluggyHistoryImpl` — ambos recebem um
`itemId` que só existe neste serviço depois de `assertItemAccess` confirmar o vínculo). A leitura de
validação pré-vínculo (`RegisterPluggyCredentialImpl.validateItemAccess`, D3) usa um `freshClient`
próprio, fora deste resolver, e por isso nunca escreve em `radar_pluggy_item_observations` — só em
`radar_pluggy_calls` (D2/D3). Não existe credencial↔item persistida ainda para associar a observação
a essa leitura; ver `pluggy-connection-observability`.

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
parse/validação → upsert condicional (`UPDATE radar_pluggy_item_observations SET ... WHERE item_id =
? AND observation_started_at < ?` seguido de `INSERT ... ON DUPLICATE KEY` equivalente quando a
linha não existe, ou a formulação Sequelize/MySQL equivalente — o ponto fixo é a condição
`incoming.observationStartedAt > stored.observationStartedAt` decidir a escrita, nunca o instante do
save). No exemplo acima, A carrega `observationStartedAt = 10:00`, B carrega `10:01`; não importa
que A termine depois — sua escrita perde para a de B (10:01 > 10:00) porque a comparação é entre os
dois `observationStartedAt`, não entre os instantes de término.

**Empate exato (`incoming.observationStartedAt === stored.observationStartedAt`)**: `Date` em Node
tem resolução de milissegundos — duas leituras concorrentes podem capturar o mesmo instante. A
condição é estritamente `>` (não `>=`): em caso de empate, a escrita que chega depois encontra a
condição falsa (igual não é maior) e é recusada — a que já está gravada permanece, ou seja, **a
primeira gravação a comitar vence o empate**, não necessariamente a primeira a ter começado. É uma
garantia mais fraca que "a leitura que começou primeiro sempre vence" nesse caso específico de
empate exato, mas nunca há dupla gravação nem estado indeterminado: exatamente uma das duas escritas
prevalece, de forma determinística no banco (a segunda `UPDATE` a rodar não casa a condição `<` e
afeta zero linhas).

**Alternativa descartada**: `observedAt` = instante do save — descartada porque não resolve o
cenário de corrida acima, e é exatamente o requisito que motivou esta revisão.
**Alternativa descartada**: condição `>=` (a versão anterior deste documento) — descartada porque em
caso de empate exato permitiria a segunda escrita a chegar sobrescrever a primeira sem necessidade
real de avanço, prometendo uma ordenação mais fina do que o token consegue distinguir em milissegundo
igual.

### D10 — `/credentials/status` muda de shape porque a granularidade certa é por item, não por pessoa
Uma pessoa pode ter mais de um Item vinculado (`PluggyCredentialItem` já modela isso). Um único
booleano ou um único status agregado esconderia qual conexão específica precisa de reconexão. A
resposta passa a ser `{hasCredential, items: [...]}`, cada item com seu `connectionStatus` traduzido
(`pluggy-connection-observability`) e identidade de connector.

## Risks / Trade-offs

- **[Risco]** `radar_pluggy_credential_items` já tem linhas reais sem `connector_id` (2 linhas
  confirmadas nos bancos consultados) → **[Mitigação]** coluna nasce nullable; `PluggyItemStateResolver`
  reescreve os campos de connector sempre que os lê de novo, então a próxima leitura bem-sucedida
  desses itens já preenche retroativamente, sem script de backfill.
- **[Risco]** Mudar o portão de posição/histórico de item-level para por-`(consumer, source)` aumenta
  o número de vezes que o item é relido quando uma fonte específica está presa (o item-level
  watermark deixa de bloquear sozinho) → **[Mitigação]** é o comportamento pedido explicitamente —
  tentar de novo é mais seguro que esquecer uma fonte, e o custo é só chamada técnica, não quota
  Open Finance (ver ADR já fechado).
- **[Risco]** `GET /credentials/status` ganha `items[]`, mas o `oplab-radar-front` só passa a
  consumir esse campo num PR próprio, depois da publicação deste change → **[Mitigação]** risco
  baixo porque a mudança é aditiva (D10): `hasCredential` mantém shape e posição, o front atual
  continua funcionando sem alteração enquanto o PR que lê `items[]` não for publicado — sem janela
  de deploy quebrado em nenhuma ordem de publicação.
- **[Risco]** `AsyncLocalStorage` introduz um mecanismo de propagação de contexto que não existia
  neste código → **[Mitigação]** escopo estrito (`call-context.ts`), usado só para
  `trigger`/`webhookEventId`/`requestCorrelationId` de observabilidade — nunca para decisão de
  negócio, então uma falha de propagação no pior caso perde um campo de auditoria, nunca corrompe
  uma sincronização.
- **[Risco]** `radar_pluggy_calls` é auditoria best-effort (spec `pluggy-call-history`: falha ao
  gravar nunca bloqueia a chamada de negócio) — logo processo morto entre a resposta da Pluggy e o
  `INSERT`, ou MySQL indisponível no momento da gravação, produz uma chamada real sem registro
  correspondente → **[Mitigação]** aceito como limite conhecido, não corrigido por outbox, lock ou
  acoplamento transacional com a chamada de negócio (não-goal explícito). A garantia realista é
  "toda chamada concluída gera uma *tentativa* de persistência de exatamente um registro", nunca
  "toda chamada gera um registro". A falha de gravação em si é sempre observável — logada como aviso
  com `outcome`/erro nomeado — para que perda de linha vire sinal de operação, não silêncio.

## Migration Plan

1. Migrations aditivas primeiro (`radar_pluggy_item_observations`, `radar_pluggy_calls`,
   `radar_pluggy_credential_items` + colunas de connector) — não quebram nada em produção porque
   nenhum código ainda as lê.
2. Migration de `radar_pluggy_sync_progress` (cria, com `consumer` + `source`) + remoção de
   `radar_pluggy_history_sync_states` (drop) na mesma migration — seguro porque a tabela está vazia
   em todos os ambientes consultados; se algum ambiente tiver dado real não capturado aqui, a
   migration deve ser revisada antes de rodar lá.
3. Correções de shape (D6, D7) entram isoladas, antes de qualquer interactor passar a depender delas
   — reduz o raio de um rollback se algo estiver errado.
4. Reescrita dos dois interactors (D4, D5) depois das correções de shape.
5. Instrumentação (D1–D3) depois disso — não depende de D4–D7, mas entra por último porque é a peça
   mais nova (AsyncLocalStorage) e a que mais se beneficia de rodar sobre um portão já corrigido.
6. `/credentials/status` (D8, D10) por último no backend — depende de D4 (observação) e D8
   (connector) já existirem. Mudança aditiva (`items[]`) — pode ir a produção sem o front estar
   pronto para consumi-lo.
7. `oplab-radar-front` consome `items[]` num PR próprio, depois do passo 6 publicado — não é deploy
   coordenado, é ordem de conveniência: não há `items[]` real para consumir antes disso.

Rollback: cada passo é uma migration aditiva ou uma troca de leitura sem mudança de escrita anterior
— reverter é possível parando no passo anterior, exceto o passo 2 (drop de
`radar_pluggy_history_sync_states`), que é irreversível sem recriar a tabela vazia — aceitável dado
que nenhum ambiente consultado tem dado nela.
