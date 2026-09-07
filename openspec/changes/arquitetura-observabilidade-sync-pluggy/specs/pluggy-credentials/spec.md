## ADDED Requirements

### Requirement: Consulta de status expõe conexão por item, não só existência de credencial
A consulta de status de credencial de uma pessoa MUST continuar devolvendo `hasCredential` no mesmo
formato de hoje, e passa a devolver também, para cada item vinculado a alguma credencial da pessoa,
o estado de conexão traduzido daquele item (`pluggy-connection-observability`), o instante da última
atualização, a próxima atualização automática prevista quando conhecida, e a identidade do connector
(incluindo os produtos que ele suporta, `pluggy-item`), num novo campo `items[]`. Mudança aditiva: um
consumidor que só lê `hasCredential` continua funcionando sem alteração. Uma pessoa sem nenhuma
credencial continua recebendo ausência de credencial, sem lista de itens.

#### Scenario: Pessoa com itens em estados diferentes
- **WHEN** uma pessoa tem duas credenciais vinculadas a itens, um com conexão saudável e outro
  precisando de reconexão
- **THEN** a consulta de status devolve os dois itens, cada um com seu próprio estado de conexão

#### Scenario: Pessoa sem credencial continua sem lista de itens
- **WHEN** uma pessoa não tem nenhuma credencial cadastrada
- **THEN** a consulta de status indica ausência de credencial, sem devolver nenhum item

### Requirement: Cada item devolve o estado por fonte suportada pelo connector
Além do `connectionStatus` agregado do item, a consulta de status MUST devolver, para cada fonte que
o connector daquele item suporta (`pluggy-item`), se ela está atualizada (`isUpdated`) e o
`lastUpdatedAt` correspondente — na mesma granularidade que `pluggy-sync-progress` e
`pluggy-connection-observability` já rastreiam. Uma fonte não suportada pelo connector aparece
marcada como não suportada, sem `isUpdated`/`lastUpdatedAt`. Em `executionStatus === 'SUCCESS'`
(`statusDetail` nulo), toda fonte suportada aparece `isUpdated: true` com o `lastUpdatedAt` do Item —
a tradução não exige `statusDetail` para responder isso.

#### Scenario: Item parcial não contamina fonte saudável com o alerta de outra
- **WHEN** um item está em `PARTIAL_SUCCESS`, com `accounts` não coletado nesta execução e
  `investments` coletado
- **THEN** a consulta de status mostra `accounts` como não atualizado e `investments` como
  atualizado, para o mesmo item

#### Scenario: Fonte não suportada pelo connector aparece marcada como tal
- **WHEN** o connector de um item não suporta um produto (por exemplo, `loans`)
- **THEN** a consulta de status marca essa fonte como não suportada, sem `isUpdated` nem
  `lastUpdatedAt`

#### Scenario: SUCCESS não exige statusDetail para responder o estado por fonte
- **WHEN** um item está em `executionStatus === 'SUCCESS'`
- **THEN** cada fonte suportada pelo connector aparece atualizada, com `lastUpdatedAt` igual ao do
  Item, sem depender de `statusDetail` (que é nulo neste caso)

### Requirement: Validação de credencial nova é registrada no histórico de chamadas antes do vínculo existir
A chamada que valida se uma credencial nova consegue alcançar o item informado — feita antes de
qualquer persistência do vínculo — MUST ser registrada no histórico de chamadas
(`pluggy-call-history`), identificada pelo `itemId` informado mesmo que esse item ainda não esteja
persistido neste serviço.

#### Scenario: Validação de credencial gera registro de chamada
- **WHEN** uma nova credencial é validada contra um `itemId` informado, antes de qualquer
  persistência
- **THEN** um registro correspondente aparece no histórico de chamadas, identificado por esse
  `itemId`

### Requirement: Identidade do connector é capturada no cadastro
No momento em que o vínculo entre credencial e item é criado, a identidade do connector do item —
obtida do mesmo payload que validou a credencial — MUST ser persistida junto do vínculo. Esse
vínculo nunca fica sem identidade de connector quando o payload da Pluggy a trouxe. Observações
subsequentes do mesmo item podem atualizar essa identidade novamente — ver `pluggy-item` — sem que
isso mude o requisito de que o cadastro já a persista de imediato.

#### Scenario: Cadastro persiste a identidade do connector do item
- **WHEN** um cadastro de credencial cria o vínculo entre credencial e item
- **THEN** a identidade do connector lida durante a validação é persistida na mesma operação que
  cria o vínculo
