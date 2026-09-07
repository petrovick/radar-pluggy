## Purpose

Manter o último estado observado de cada conexão Pluggy (`Item`), atualizado em toda leitura válida
do item — independente de uma sincronização de posição ou histórico ter ocorrido — e traduzir esse
estado bruto para o vocabulário de conexão que o produto expõe ao titular.

## ADDED Requirements

### Requirement: Toda leitura válida do item atualiza o estado observado
Sempre que este serviço lê com sucesso o estado de um item na Pluggy, o estado observado
(`status`, `executionStatus`, detalhe por produto, `lastUpdatedAt`, `nextAutoSyncAt`, identidade do
connector) é atualizado — mesmo quando esse estado não permite iniciar nenhuma sincronização.

#### Scenario: Item em erro de login ainda assim atualiza a observação
- **WHEN** o item lido vem com `status` `LOGIN_ERROR`
- **THEN** o estado observado passa a refletir `LOGIN_ERROR`, mesmo que nenhuma sincronização de
  posição ou histórico seja iniciada

#### Scenario: Leitura que falha não atualiza a observação
- **WHEN** a chamada que leria o item falha antes de obter uma resposta válida
- **THEN** o estado observado permanece o que já estava registrado

### Requirement: Observação nunca retrocede no tempo
Uma leitura mais antiga que a última observação já registrada nunca sobrescreve a observação mais
recente.

#### Scenario: Leitura atrasada não sobrescreve leitura mais recente
- **WHEN** duas leituras do mesmo item ocorrem fora de ordem e a mais antiga chega por último
- **THEN** o estado observado permanece o da leitura mais recente, não o da que chegou por último

### Requirement: Estado bruto da Pluggy é traduzido para um vocabulário fechado de conexão
O par (`status`, `executionStatus`) do item é traduzido para exatamente um entre: `CONNECTING`,
`CONNECTED`, `PARTIAL`, `NEEDS_RECONNECT`, `AWAITING_USER_INPUT`, `STALE`, `UNKNOWN`. Todo valor de
`status` que o item pode assumir tem uma tradução definida — nenhum cai em erro por falta de mapeamento.

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

### Requirement: Item nunca observado responde estado desconhecido, nunca vazio silencioso
Quando um item está vinculado a uma credencial mas ainda não existe nenhuma observação registrada
para ele, o estado de conexão traduzido é `UNKNOWN` — nunca omitido e nunca tratado como `CONNECTED`.

#### Scenario: Item recém-vinculado, sem nenhuma leitura ainda
- **WHEN** um item está vinculado a uma credencial e nenhuma leitura do item na Pluggy foi concluída
  ainda
- **THEN** o estado de conexão traduzido para esse item é `UNKNOWN`
