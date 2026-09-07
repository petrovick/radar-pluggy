## MODIFIED Requirements

### Requirement: Sincronização só ocorre quando o portão de marca d'água do item libera
Antes de buscar investimentos ou empréstimos, o serviço lê o estado fresco do item
(`executionStatus`, `lastUpdatedAt`, estado por fonte). A busca de cada fonte (`investments`,
`loans`) só acontece quando `executionStatus` é `SUCCESS` ou `PARTIAL_SUCCESS` **e** a marca d'água
daquela fonte especificamente está desatualizada em relação à versão da execução disponível para ela
(`Item.lastUpdatedAt` em `SUCCESS`; `statusDetail.<fonte>.lastUpdatedAt` em `PARTIAL_SUCCESS`, só
quando `isUpdated === true`). Uma fonte recusada numa execução não impede a outra de ser processada.

#### Scenario: Item sem mudança não gera nenhuma chamada de investimentos
- **WHEN** a marca d'água de `investments` e a de `loans` já estão em dia com a versão de execução
  disponível para o item
- **THEN** nenhuma chamada a `GET /investments` nem a `GET /loans` acontece, e a sincronização
  termina sem erro

#### Scenario: Item com executionStatus diferente de SUCCESS não sincroniza
- **WHEN** o item fresco vem com `executionStatus` diferente de `SUCCESS` e de `PARTIAL_SUCCESS`
- **THEN** nenhuma chamada a `GET /investments` nem a `GET /loans` acontece

#### Scenario: Uma fonte recusada não impede a outra
- **WHEN** o item vem em `PARTIAL_SUCCESS` com `investments` não coletado nesta execução (`isUpdated`
  diferente de `true`) e `loans` coletado (`isUpdated === true`)
- **THEN** `GET /loans` é chamado e a fotografia de empréstimos é atualizada; `GET /investments` não
  é chamado nesta execução

### Requirement: Leitura autoritativa reconcilia a fotografia atual, inclusive quando devolve lista vazia
Quando o portão de marca d'água de `investments` (ou de `loans`) libera a sincronização e a fonte é
utilizável nesta execução (`isUpdated === true` em `PARTIAL_SUCCESS`, ou qualquer execução `SUCCESS`),
a resposta da Pluggy é autoritativa — inclusive quando devolve lista vazia. Uma lista vazia
autoritativa nunca é recusa nomeada: é reconciliada como "portfólio/dívida vazia" e a fotografia
local passa a refletir isso — todo registro local daquele Item, na fonte correspondente, cujo
identificador não veio na leitura, deixa de pertencer à fotografia atual. Snapshot e raw history não
são afetados — continuam auditoria append-only. Quando `investments` (ou `loans`) não foi tentado
por estar recusado nesta execução, nenhuma reconciliação ocorre e a fotografia existente permanece
intocada.

#### Scenario: Lista vazia autoritativa reconcilia como portfólio vazio
- **WHEN** o portão de `investments` libera a sincronização, a fonte é utilizável nesta execução, e
  `GET /investments` devolve uma lista vazia para o item
- **THEN** toda posição local existente daquele item é removida da fotografia atual, e a
  sincronização termina sem erro

#### Scenario: Investimento que sumiu da leitura deixa de pertencer à fotografia atual
- **WHEN** uma leitura autoritativa de `investments` traz um subconjunto dos investimentos que a
  fotografia local já tinha para aquele item
- **THEN** os investimentos ausentes da leitura atual deixam de pertencer à fotografia atual
  (removidos ou marcados como não-corrente), e os presentes são atualizados normalmente

#### Scenario: Fonte recusada não reconcilia nem apaga dado existente
- **WHEN** `investments` está recusado nesta execução por não ter sido coletado pela Pluggy
  (`isUpdated` diferente de `true` em `PARTIAL_SUCCESS`)
- **THEN** `GET /investments` nunca é chamado, nenhuma reconciliação ocorre, e a fotografia de
  posição existente permanece intocada

#### Scenario: Primeira carga com lista vazia não é erro
- **WHEN** um item nunca teve fotografia de investimentos e a primeira leitura autoritativa devolve
  lista vazia
- **THEN** a sincronização termina sem erro, com a fotografia local permanecendo vazia para aquele
  item

## ADDED Requirements

### Requirement: Item inativo (removido pela Pluggy) não contribui fotografia para o portfolio corrente
Um item cujo vínculo credencial↔item está marcado inativo (`item/deleted`,
`pluggy-connection-observability`) MUST deixar de ser incluído na leitura de posições de uma pessoa
(`GET /portfolio`) — mesmo que a fotografia local ainda tenha registros daquele item. Snapshot/raw
histórico permanecem preservados; só a leitura da fotografia corrente exclui o item.

#### Scenario: Portfolio não mostra mais posição de item removido
- **WHEN** um item com posições sincronizadas é marcado inativo por uma notificação `item/deleted`
- **THEN** `GET /portfolio` para a pessoa dona daquele item deixa de incluir as posições desse item,
  mesmo que a fotografia local ainda tenha os registros

### Requirement: Marca d'água de ingestão completa avança só em sucesso pleno
A marca d'água que representa "última ingestão completa e bem-sucedida do item" avança se e somente
se `executionStatus` for `SUCCESS`. Ela nunca avança quando `executionStatus` é `PARTIAL_SUCCESS`,
mesmo que uma ou mais fontes tenham sido processadas com sucesso nessa execução.

#### Scenario: Execução parcial não avança a marca d'água de ingestão completa
- **WHEN** uma sincronização processa `loans` com sucesso, mas o item veio em `PARTIAL_SUCCESS`
- **THEN** a marca d'água de ingestão completa do item não avança, mesmo com `loans` processado

#### Scenario: Execução plena avança a marca d'água de ingestão completa
- **WHEN** uma sincronização processa `investments` e `loans` com sucesso e o item veio em `SUCCESS`
- **THEN** a marca d'água de ingestão completa do item avança
