## Purpose

Manter o último estado observado de cada conexão Pluggy (`Item`) **já vinculada a uma credencial**,
atualizado em toda leitura válida desse item — independente de uma sincronização de posição ou
histórico ter ocorrido, e independente de o evento que motivou a releitura ser `item/created`/
`item/updated` ou outro evento de observação (`item/error`, `item/waiting_user_input`,
`item/waiting_user_action`, `item/login_succeeded`) — e traduzir esse estado bruto para o
vocabulário de conexão que o produto expõe ao titular. Quando a Pluggy notifica que o Item foi
removido (`item/deleted`), o vínculo é marcado inativo e o `connectionStatus` vira `DISCONNECTED`
sem nenhuma nova leitura. A leitura de validação de credencial nova, antes de o vínculo existir, fica
fora desta capability — ela só alimenta o histórico de chamadas (`pluggy-call-history`).

## ADDED Requirements

### Requirement: Toda leitura válida de um item já vinculado tenta atualizar o estado observado
Sempre que este serviço lê com sucesso o estado de um item **já vinculado a uma credencial** na
Pluggy, este serviço **tenta** atualizar o estado observado (`status`, `executionStatus`, detalhe
por produto, `lastUpdatedAt`, `nextAutoSyncAt`, identidade do connector) — mesmo quando esse estado
não permite iniciar nenhuma sincronização. Só uma observação cujo `observationStartedAt` for
estritamente maior que o já armazenado prevalece (ver "Observação nunca retrocede no tempo" abaixo);
esta regra descreve *quando a tentativa acontece*, não uma garantia de que toda tentativa muda o
estado gravado. A leitura que valida uma credencial nova, antes de o vínculo credencial↔item ser
criado, nunca tenta atualizar o estado observado — não existe vínculo ainda para associar a
observação.

#### Scenario: Item em erro de login ainda assim atualiza a observação
- **WHEN** o item lido vem com `status` `LOGIN_ERROR` e a leitura tem `observationStartedAt` mais
  novo que o já armazenado
- **THEN** o estado observado passa a refletir `LOGIN_ERROR`, mesmo que nenhuma sincronização de
  posição ou histórico seja iniciada

#### Scenario: Leitura que falha não atualiza a observação
- **WHEN** a chamada que leria o item falha antes de obter uma resposta válida
- **THEN** o estado observado permanece o que já estava registrado

#### Scenario: Validação de credencial nova não escreve estado observado
- **WHEN** a validação de uma credencial nova lê o Item antes de o vínculo entre credencial e item
  ser criado
- **THEN** um registro correspondente aparece no histórico de chamadas (`pluggy-call-history`), e
  nenhuma linha é criada ou atualizada em `radar_pluggy_item_observations` para esse item

### Requirement: Observação nunca retrocede no tempo
Cada leitura do item carrega um `observationStartedAt`, capturado no instante em que a leitura
começou — antes de chamar a Pluggy — não no instante em que termina nem no instante em que é salva.
Uma gravação só substitui a observação já registrada quando o `observationStartedAt` que ela carrega
for estritamente maior que o `observationStartedAt` já armazenado. `lastUpdatedAt` reportado pela
Pluggy nunca é usado como token de ordenação: o `status`/`executionStatus` do item pode mudar sem que
`lastUpdatedAt` avance.

`observationStartedAt` tem resolução de milissegundo — duas leituras concorrentes podem capturá-lo
com o mesmo valor exato. Em caso de empate, a gravação que chega depois nunca substitui a que já está
registrada (empate não é "maior que"): prevalece a que conseguiu gravar primeiro, não necessariamente
a que começou a ler primeiro.

#### Scenario: Leitura atrasada não sobrescreve leitura mais recente
- **WHEN** duas leituras do mesmo item começam em instantes diferentes, a mais antiga demora mais
  para terminar, e as duas tentam gravar — a mais recente (por `observationStartedAt`) primeiro, a
  mais antiga depois
- **THEN** a gravação da leitura mais antiga é recusada por ter `observationStartedAt` menor que o já
  armazenado, e o estado observado permanece o da leitura mais recente

#### Scenario: Duas leituras com o mesmo observationStartedAt não se sobrescrevem indefinidamente
- **WHEN** duas leituras do mesmo item capturam o mesmo `observationStartedAt` (empate de
  milissegundo) e ambas tentam gravar
- **THEN** apenas a gravação que chega primeiro é aplicada; a segunda, com `observationStartedAt`
  igual ao já armazenado, é recusada

### Requirement: Estado bruto da Pluggy é traduzido para um vocabulário fechado de conexão
O par (`status`, `executionStatus`) do item é traduzido para exatamente um entre: `CONNECTING`,
`CONNECTED`, `PARTIAL`, `NEEDS_RECONNECT`, `AWAITING_USER_INPUT`, `STALE`, `DISCONNECTED`, `UNKNOWN`.
Todo valor de `status` que o item pode assumir tem uma tradução definida — nenhum cai em erro por
falta de mapeamento. `DISCONNECTED` nunca vem de `(status, executionStatus)` — vem exclusivamente de
o vínculo credencial↔item estar marcado inativo (ver "Item removido pela Pluggy" abaixo), e essa
verificação precede qualquer tradução do par `(status, executionStatus)`.

#### Scenario: Conexão saudável
- **WHEN** o item observado tem `status` `UPDATED` e `executionStatus` `SUCCESS`
- **THEN** o estado de conexão traduzido é `CONNECTED`

#### Scenario: Sincronização parcial
- **WHEN** o item observado tem `status` `UPDATED` e `executionStatus` `PARTIAL_SUCCESS`
- **THEN** o estado de conexão traduzido é `PARTIAL`

#### Scenario: Conexão quebrada precisa de reconexão
- **WHEN** o item observado tem `status` `LOGIN_ERROR`
- **THEN** o estado de conexão traduzido é `NEEDS_RECONNECT`

#### Scenario: Conexão espera ação do titular
- **WHEN** o item observado tem `status` `WAITING_USER_INPUT` ou `WAITING_USER_ACTION`
- **THEN** o estado de conexão traduzido é `AWAITING_USER_INPUT`

#### Scenario: Conexão em andamento
- **WHEN** o item observado tem `status` `UPDATING` ou `MERGING`
- **THEN** o estado de conexão traduzido é `CONNECTING`

#### Scenario: Conexão desatualizada
- **WHEN** o item observado tem `status` `OUTDATED`
- **THEN** o estado de conexão traduzido é `STALE`

### Requirement: Aceitar a observação e atualizar o connector do vínculo são a mesma decisão atômica
Quando uma observação de Item é aceita (pelo critério de ordenação de `observationStartedAt` acima) e
o payload traz `connector`, a identidade do connector do vínculo credencial↔item é atualizada na
mesma escrita que aceita a observação — nunca em uma escrita separada. Uma observação recusada
(porque chegou atrasada) nunca atualiza o connector, mesmo que o `connector` do payload recusado seja
diferente do já persistido — o payload de uma leitura mais antiga não é uma fonte confiável de
metadata mais nova.

#### Scenario: Observação aceita atualiza o connector na mesma escrita
- **WHEN** uma observação é aceita e o payload traz um `connector` diferente do já persistido no
  vínculo
- **THEN** a identidade do connector do vínculo é atualizada, na mesma operação que aceita a
  observação

#### Scenario: Observação recusada não atualiza o connector
- **WHEN** uma observação é recusada por ter `observationStartedAt` menor ou igual ao já registrado
- **THEN** a identidade do connector do vínculo permanece a que já estava persistida, mesmo que o
  payload recusado trouxesse um `connector` diferente

### Requirement: Estado observado distingue produtos habilitados no Item de produtos suportados pelo connector
O estado observado de um Item MUST guardar os produtos habilitados **daquele Item**
(`itemProducts` — pode mudar se o Item for atualizado na Pluggy), separado dos produtos que o
connector suporta como instituição (`connectorProducts`, capturado junto da identidade do connector
— `pluggy-item`). Quando o payload do Item não trouxer essa lista de forma reconhecível,
`itemProducts` MUST ficar em um estado `UNKNOWN` explícito — nunca `[]`, e nunca derivado de
`connectorProducts`.

#### Scenario: Item com subconjunto de produtos habilitados
- **WHEN** um Item é observado e seu payload traz `products: ["ACCOUNTS", "TRANSACTIONS"]`, mesmo
  que o connector suporte também `INVESTMENTS`
- **THEN** o estado observado registra `itemProducts` como `["ACCOUNTS", "TRANSACTIONS"]` — sem
  incluir `INVESTMENTS`

#### Scenario: Produtos do Item não reconhecíveis no payload viram UNKNOWN, nunca vazio
- **WHEN** o payload de um Item não traz a lista de produtos habilitados em formato reconhecível
- **THEN** `itemProducts` fica em estado `UNKNOWN` — nunca é tratado como lista vazia, e nenhuma fonte
  é considerada habilitada ou desabilitada com base nisso

### Requirement: Item removido pela Pluggy (item/deleted) fica DISCONNECTED, sem nova tentativa de leitura
Quando a Pluggy notifica que um Item foi removido (`item/deleted`), este serviço MUST marcar o
vínculo credencial↔item correspondente como inativo, e nunca tenta ler esse Item na Pluggy de novo
(o recurso não existe mais). O `connectionStatus` traduzido para esse item passa a ser
`DISCONNECTED` imediatamente, a partir só do marcador de inatividade — sem depender de nenhuma nova
observação. Uma vez inativo, o item nunca mais é considerado elegível para releitura por nenhum
trigger.

#### Scenario: item/deleted marca o vínculo inativo sem tentar reler
- **WHEN** este serviço recebe uma notificação `item/deleted` para um item vinculado
- **THEN** o vínculo é marcado inativo, nenhuma chamada `fetchItem` é feita para esse item, e o
  `connectionStatus` traduzido passa a `DISCONNECTED`

#### Scenario: Item inativo nunca volta a CONNECTED sem novo cadastro
- **WHEN** um item já marcado inativo é consultado novamente (por exemplo, em `/credentials/status`)
- **THEN** o `connectionStatus` continua `DISCONNECTED`, independente do que a última observação
  antes da remoção tinha registrado

### Requirement: Item nunca observado responde estado desconhecido, nunca vazio silencioso
Quando um item está vinculado a uma credencial mas ainda não existe nenhuma observação registrada
para ele, o estado de conexão traduzido é `UNKNOWN` — nunca omitido e nunca tratado como `CONNECTED`.

#### Scenario: Item recém-vinculado, sem nenhuma leitura ainda
- **WHEN** um item está vinculado a uma credencial e nenhuma leitura do item na Pluggy foi concluída
  ainda
- **THEN** o estado de conexão traduzido para esse item é `UNKNOWN`
