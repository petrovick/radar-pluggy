## Purpose

Registrar, por item, por **consumidor** (o pipeline que processa a fonte: `POSITION_SYNC` ou
`HISTORY_LOAD`) e por fonte real de dados da Pluggy (`ACCOUNTS`, `ACCOUNT_TRANSACTIONS`,
`INVESTMENTS`, `INVESTMENT_TRANSACTIONS`, `LOANS`), até que versão da execução daquela fonte
específica **aquele consumidor** já processou com sucesso — para que uma fonte recusada por limite
operacional seja retentada assim que ela própria avançar, sem depender do item inteiro mudar de
novo, sem uma fonte saudável esperar por outra que está travada, e sem um consumidor emprestar
progresso a outro que nunca rodou sobre aquela fonte. `CASH` (`ACCOUNTS`, `ACCOUNT_TRANSACTIONS`) e
`CUSTODY` (`INVESTMENTS`, `INVESTMENT_TRANSACTIONS`) são agrupamentos de negócio usados pela carga de
histórico para decidir elegibilidade — nenhum dos dois tem marca d'água própria, cada um é a união
das marcas d'água das fontes que o compõem, sempre no consumidor `HISTORY_LOAD`.

A marca d'água não representa "qual versão desta fonte existe" — representa "até qual versão da
execução este consumidor processou com sucesso para esta fonte". Essa versão nem sempre vem de um
`lastUpdatedAt` por fonte: `Item.statusDetail` só existe quando `executionStatus` é
`PARTIAL_SUCCESS` — em `SUCCESS`, é `null`, e a versão gravada é `Item.lastUpdatedAt` (ver
Requirement abaixo). `INVESTMENTS` é a única fonte usada por dois consumidores (`POSITION_SYNC`,
para posição; `HISTORY_LOAD`, para descobrir investimentos a escanear na carga de custódia) — cada
um mantém sua própria marca d'água para `INVESTMENTS`, porque cada um processa algo diferente a
partir do mesmo recurso; um avançar nunca avança o do outro.

## ADDED Requirements

### Requirement: Marca d'água é por item, por consumidor e por fonte — nunca só por item ou por fonte
Cada combinação (`itemId`, `consumer`, `source`) tem sua própria marca d'água, independente das
demais combinações do mesmo item — inclusive quando dois consumidores leem a mesma fonte. Uma fonte
avançar para um consumidor nunca move a marca d'água da mesma fonte para outro consumidor, nem a de
outra fonte do mesmo consumidor.

#### Scenario: Duas fontes do mesmo consumidor avançam de forma independente
- **WHEN** `INVESTMENTS` é processado com sucesso por `POSITION_SYNC` para um item e `LOANS` não é
- **THEN** a marca d'água de (`POSITION_SYNC`, `INVESTMENTS`) daquele item avança e a de
  (`POSITION_SYNC`, `LOANS`) permanece a que já estava registrada

#### Scenario: A mesma fonte não compartilha marca d'água entre consumidores
- **WHEN** `POSITION_SYNC` processa `INVESTMENTS` com sucesso e avança sua marca d'água para essa
  fonte, e `HISTORY_LOAD` nunca processou `INVESTMENTS` para o mesmo item
- **THEN** a marca d'água de (`HISTORY_LOAD`, `INVESTMENTS`) permanece a que já estava registrada
  para `HISTORY_LOAD` — a escrita de `POSITION_SYNC` não a altera, e `CUSTODY` continua elegível
  para `HISTORY_LOAD` com base na própria marca d'água

### Requirement: Marca d'água nunca retrocede
Uma tentativa de gravar, para um (`itemId`, `consumer`, `source`), um timestamp anterior ao já
registrado é recusada — a marca d'água registrada permanece inalterada.

#### Scenario: Timestamp mais antigo é recusado
- **WHEN** já existe marca d'água registrada para (`itemId`, `consumer`, `source`) e uma gravação
  chega com timestamp anterior a esse valor
- **THEN** a gravação é recusada e a marca d'água registrada não muda

### Requirement: Combinação nunca observada é sempre elegível
Ausência de marca d'água para um (`itemId`, `consumer`, `source`) nunca é tratada como "já
processado" — é tratada como "nunca observado por este consumidor", sempre elegível para uma
primeira tentativa, mesmo que outro consumidor já tenha processado a mesma fonte.

#### Scenario: Combinação sem marca d'água prévia é elegível
- **WHEN** não existe nenhuma marca d'água registrada para um (`itemId`, `consumer`, `source`)
- **THEN** essa combinação é considerada elegível para processamento, independente de qualquer outro
  sinal de mudança e independente de outro consumidor já ter marca d'água para a mesma fonte

### Requirement: Versão gravada depende de executionStatus — nunca assume statusDetail sempre presente
`Item.statusDetail` só existe quando `executionStatus` é `PARTIAL_SUCCESS` — em `SUCCESS`, é `null`.
A versão de execução gravada para uma fonte é `Item.lastUpdatedAt` quando `executionStatus` é
`SUCCESS`; é `statusDetail.<fonte>.lastUpdatedAt` quando `executionStatus` é `PARTIAL_SUCCESS` **e**
a fonte tem `isUpdated === true`. Uma fonte com `isUpdated` diferente de `true` em `PARTIAL_SUCCESS`
nunca tem sua marca d'água avançada nesta execução, mesmo que `statusDetail` traga um
`lastUpdatedAt` de uma coleta anterior.

#### Scenario: SUCCESS grava a versão do Item, não um valor por fonte
- **WHEN** uma execução termina com `executionStatus === 'SUCCESS'` (`statusDetail` é `null`) e uma
  fonte suportada é processada com sucesso
- **THEN** a marca d'água daquela fonte é gravada com `Item.lastUpdatedAt`

#### Scenario: PARTIAL_SUCCESS grava a versão por fonte, só quando utilizável
- **WHEN** uma execução termina com `executionStatus === 'PARTIAL_SUCCESS'` e uma fonte tem
  `statusDetail.<fonte>.isUpdated === true`
- **THEN** a marca d'água daquela fonte é gravada com `statusDetail.<fonte>.lastUpdatedAt`

#### Scenario: Fonte não coletada não avança, mesmo com lastUpdatedAt antigo presente
- **WHEN** uma execução termina com `executionStatus === 'PARTIAL_SUCCESS'` e uma fonte tem
  `isUpdated` diferente de `true`, com `statusDetail.<fonte>.lastUpdatedAt` apontando para uma
  coleta anterior
- **THEN** a marca d'água daquela fonte não é gravada nesta execução
