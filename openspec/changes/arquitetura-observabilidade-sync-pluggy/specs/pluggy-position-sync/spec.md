## MODIFIED Requirements

### Requirement: Sincronização só ocorre quando o portão de marca d'água do item libera
Antes de buscar investimentos ou empréstimos, o serviço lê o estado fresco do item
(`executionStatus`, `lastUpdatedAt`, estado por produto). A busca de cada produto (`investments`,
`loans`) só acontece quando `executionStatus` é `SUCCESS` ou `PARTIAL_SUCCESS` **e** a marca d'água
daquele produto especificamente está desatualizada em relação ao que a Pluggy reporta para ele. Um
produto recusado numa execução não impede o outro de ser processado.

#### Scenario: Item sem mudança não gera nenhuma chamada de investimentos
- **WHEN** a marca d'água de `investments` e a de `loans` já estão em dia com o que a Pluggy reporta
  para o item
- **THEN** nenhuma chamada a `GET /investments` nem a `GET /loans` acontece, e a sincronização
  termina sem erro

#### Scenario: Item com executionStatus diferente de SUCCESS não sincroniza
- **WHEN** o item fresco vem com `executionStatus` diferente de `SUCCESS` e de `PARTIAL_SUCCESS`
- **THEN** nenhuma chamada a `GET /investments` nem a `GET /loans` acontece

#### Scenario: Um produto recusado não impede o outro
- **WHEN** o item vem em `PARTIAL_SUCCESS` com `investments` não coletado nesta execução e `loans`
  coletado
- **THEN** `GET /loans` é chamado e a fotografia de empréstimos é atualizada; `GET /investments` não
  é chamado nesta execução

### Requirement: Lista de investimentos vazia com portão aberto é recusa nomeada
Quando o portão de marca d'água do produto `investments` libera a sincronização **e o produto foi de
fato tentado** mas a Pluggy devolve uma lista vazia de investimentos para o item, isso é tratado
como estado de reconexão — nunca como "portfólio ficou vazio". Nenhuma posição existente é apagada
ou sobrescrita nesse caso. Quando `investments` não foi tentado por estar recusado nesta execução,
esta regra não se aplica — não há lista vazia a avaliar.

#### Scenario: Lista vazia recusa nomeando o item, sem apagar posição existente
- **WHEN** o portão de `investments` libera a sincronização e `GET /investments` devolve uma lista
  vazia para o item
- **THEN** a sincronização é recusada nomeando o item, e nenhuma fotografia de posição existente é
  alterada

#### Scenario: Produto recusado não é tratado como lista vazia
- **WHEN** `investments` está recusado nesta execução por não ter sido coletado pela Pluggy
- **THEN** `GET /investments` nunca é chamado, e a ausência de dado novo não é tratada como lista
  vazia nem recusa a sincronização

## ADDED Requirements

### Requirement: Marca d'água de ingestão completa avança só em sucesso pleno
A marca d'água que representa "última ingestão completa e bem-sucedida do item" avança se e somente
se `executionStatus` for `SUCCESS`. Ela nunca avança quando `executionStatus` é `PARTIAL_SUCCESS`,
mesmo que um ou mais produtos tenham sido processados com sucesso nessa execução.

#### Scenario: Execução parcial não avança a marca d'água de ingestão completa
- **WHEN** uma sincronização processa `loans` com sucesso, mas o item veio em `PARTIAL_SUCCESS`
- **THEN** a marca d'água de ingestão completa do item não avança, mesmo com `loans` processado

#### Scenario: Execução plena avança a marca d'água de ingestão completa
- **WHEN** uma sincronização processa `investments` e `loans` com sucesso e o item veio em `SUCCESS`
- **THEN** a marca d'água de ingestão completa do item avança
