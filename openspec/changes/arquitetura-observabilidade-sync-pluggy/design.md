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

### D4 — Marca d'água por produto generaliza `PluggyHistorySyncState`, não cria mecanismo paralelo
`radar_pluggy_history_sync_states` está vazia em todos os bancos consultados — dá pra evoluir sem
backfill. A tabela é renomeada para `radar_pluggy_product_sync_states`, ganha a coluna `product`
(chave composta `item_id + product`), e passa a ser usada tanto por
`SyncPluggyPositionInteractor` (`INVESTMENTS`, `LOANS`) quanto por `LoadPluggyHistoryInteractor`
(`CASH`, `CUSTODY`) — mesma tabela, mesmo repositório, vocabulário de produto próprio de cada
consumidor. Isso fecha, para o histórico também, a mesma classe de risco que motivou o pedido
original: o portão de item-level do histórico já sofria do mesmo problema, só mascarado por
`PluggyHistoryCoverage` reprocessar qualquer fonte sem observação assim que o portão de item reabre.

**Alternativa descartada**: criar uma tabela nova só para posição, deixando a de histórico como
estava — rejeitada por deixar duas semânticas de watermark concorrentes no mesmo código, e por
deixar sem correção um risco que já existia no histórico.

### D5 — `radar_pluggy_items` preserva, sem reinterpretação, "última ingestão completa e bem-sucedida"
A marca d'água de item (`radar_pluggy_items.last_updated_at`) só avança quando
`executionStatus === 'SUCCESS'` — nunca em `PARTIAL_SUCCESS`, mesmo que um ou mais produtos tenham
sido processados. O portão de entrada do interactor (decidir se vale a pena tentar o ciclo) passa a
ser a união de "watermark de item está velha" OU "algum watermark de produto está velha" — nunca só
a de item. O que decide se um produto específico é retentado é sempre a marca d'água daquele
produto, nunca a de item.

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

### D8 — `connectorId` é capturado uma vez, no vínculo, não relido depois
`Item.connector: Connector` já vem embutido em todo `GET /items/{id}` (`id`, `name`, `imageUrl`,
`primaryColor`, entre outros) — sem chamada extra a `GET /connectors/{id}`. É capturado no momento em
que `RegisterPluggyCredentialImpl.validateItemAccess` já lê o item pela primeira vez (pré-persistência)
e persistido em `radar_pluggy_credential_items` na mesma operação que cria o vínculo — nunca inferido
por nome de instituição. `radar_pluggy_item_observations` e `radar_pluggy_calls` guardam só
`connector_id` (numérico, denormalizado para consulta), não repetem nome/imagem — evita duplicar
texto que pode desatualizar se a Pluggy renomear um connector.

### D9 — Terceira leitura do Item, dentro do mesmo ciclo, é eliminada por cache de escopo — não por acoplar os dois interactors
`SyncPluggyPositionImpl` e `LoadPluggyHistoryImpl` são resolvidos do mesmo escopo Awilix dentro de um
único ciclo de webhook/preload. `PluggyItemStateResolver` (novo, `.scoped()`, mesmo padrão de
memoização por escopo que `PluggyItemCredentialResolver` já usa) expõe `read(itemId)`: primeira
chamada busca e persiste a observação; qualquer chamada seguinte, no mesmo escopo, devolve o mesmo
snapshot sem nova rede. Os dois interactors continuam chamando `read(itemId)` sem saber um do outro —
zero acoplamento de contrato entre eles.

**Alternativa descartada**: `SyncPluggyPositionOutput` carregar o snapshot para
`LoadPluggyHistoryInput` consumir — rejeitada por acoplar dois interactors independentes ao mesmo
formato de dado bruto da Pluggy, violando "gateway do próprio caso de uso, não conhece outro caso de
uso".

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
- **[Risco]** Mudar o portão de posição/histórico de item-level para por-produto aumenta o número de
  vezes que o item é relido quando um produto específico está preso (o item-level watermark deixa de
  bloquear sozinho) → **[Mitigação]** é o comportamento pedido explicitamente — tentar de novo é
  mais seguro que esquecer um produto, e o custo é só chamada técnica, não quota Open Finance (ver
  ADR já fechado).
- **[Risco]** `GET /credentials/status` muda de shape de forma incompatível com o consumidor atual
  do `oplab-radar-front` → **[Mitigação]** os dois lados avançam juntos: a store do front já é
  reescrita neste mesmo change (ver tasks.md), não há janela de deploy em que um lado espera o outro.
- **[Risco]** `AsyncLocalStorage` introduz um mecanismo de propagação de contexto que não existia
  neste código → **[Mitigação]** escopo estrito (`call-context.ts`), usado só para
  `trigger`/`webhookEventId`/`requestCorrelationId` de observabilidade — nunca para decisão de
  negócio, então uma falha de propagação no pior caso perde um campo de auditoria, nunca corrompe
  uma sincronização.

## Migration Plan

1. Migrations aditivas primeiro (`radar_pluggy_item_observations`, `radar_pluggy_calls`,
   `radar_pluggy_credential_items` + colunas de connector) — não quebram nada em produção porque
   nenhum código ainda as lê.
2. Migration de `radar_pluggy_product_sync_states` (cria) + remoção de
   `radar_pluggy_history_sync_states` (drop) na mesma migration — seguro porque a tabela está vazia
   em todos os ambientes consultados; se algum ambiente tiver dado real não capturado aqui, a
   migration deve ser revisada antes de rodar lá.
3. Correções de shape (D6, D7) entram isoladas, antes de qualquer interactor passar a depender delas
   — reduz o raio de um rollback se algo estiver errado.
4. Reescrita dos dois interactors (D4, D5) depois das correções de shape.
5. Instrumentação (D1–D3) depois disso — não depende de D4–D7, mas entra por último porque é a peça
   mais nova (AsyncLocalStorage) e a que mais se beneficia de rodar sobre um portão já corrigido.
6. `/credentials/status` (D8, D10) por último no backend — depende de D4 (observação) e D8
   (connector) já existirem.
7. `oplab-radar-front` consome o novo shape só depois do passo 6 estar publicado no `radar-pluggy`.

Rollback: cada passo é uma migration aditiva ou uma troca de leitura sem mudança de escrita anterior
— reverter é possível parando no passo anterior, exceto o passo 2 (drop de
`radar_pluggy_history_sync_states`), que é irreversível sem recriar a tabela vazia — aceitável dado
que nenhum ambiente consultado tem dado nela.
