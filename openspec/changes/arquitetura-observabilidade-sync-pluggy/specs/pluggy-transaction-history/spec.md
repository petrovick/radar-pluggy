## MODIFIED Requirements

### Requirement: Atualização diária é reativa à Pluggy
O sistema MUST reagir a `item/created` e `item/updated` recebidos pelo webhook local, reler o item e
exigir marca d'água nova, por fonte real (`ACCOUNTS`, `ACCOUNT_TRANSACTIONS`, `INVESTMENTS`,
`INVESTMENT_TRANSACTIONS`), exclusiva do histórico — nenhuma das quatro tem marca d'água por
agrupamento (`CASH`/`CUSTODY`). Cada fonte MUST comparar seu próprio `lastUpdatedAt` reportado pela
Pluggy (`Item.statusDetail`) contra sua própria marca d'água — não a do item como um todo, nem a de
outra fonte do mesmo agrupamento. `CASH` é elegível para varredura quando `ACCOUNTS` **ou**
`ACCOUNT_TRANSACTIONS` estiver desatualizada; `CUSTODY`, quando `INVESTMENTS` **ou**
`INVESTMENT_TRANSACTIONS` estiver desatualizada. Quando `ACCOUNT_TRANSACTIONS` (ou
`INVESTMENT_TRANSACTIONS`) está elegível, MUST varrer as transações de **todas** as contas (ou
investimentos) que a listagem atual trouxe nesta execução — `Account.updatedAt`/`Investment.updatedAt`
não são contrato documentado pela Pluggy para "houve transação nova" e por isso nunca decidem sozinhos
pular a varredura de um recurso específico; podem no máximo otimizar o escopo de uma varredura já
decidida como necessária, nunca decidir se ela acontece. A marca de posição não pode bloquear o
histórico. Não há cron, polling ou `PATCH /items`.

#### Scenario: Dia sem mudança não busca transações
- **WHEN** nem `ACCOUNTS`, nem `ACCOUNT_TRANSACTIONS`, nem `INVESTMENTS`, nem
  `INVESTMENT_TRANSACTIONS` têm marca d'água mais nova que a última observação registrada para cada
  uma
- **THEN** nenhuma chamada de transação é feita

#### Scenario: Um agrupamento avança sem esperar o outro
- **WHEN** `INVESTMENTS` ou `INVESTMENT_TRANSACTIONS` (fontes de `CUSTODY`) têm marca d'água mais
  nova que a registrada, mas nem `ACCOUNTS` nem `ACCOUNT_TRANSACTIONS` (fontes de `CASH`) têm
- **THEN** as fontes de custódia são varridas normalmente, e nenhuma chamada de fonte de caixa
  acontece nesta rodada

#### Scenario: Uma fonte do mesmo agrupamento avança sem esperar a outra
- **WHEN** `ACCOUNT_TRANSACTIONS` tem marca d'água mais nova que a registrada, mas `ACCOUNTS` não
- **THEN** `CASH` é elegível para varredura (basta uma das duas fontes avançar), e a varredura ainda
  assim considera as duas fontes de `CASH` — a marca d'água de `ACCOUNTS` sozinha não impede reler
  contas

### Requirement: Produto limitado não é interpretado como vazio
Quando o item vier em `PARTIAL_SUCCESS` e o `statusDetail` daquele produto indicar `isUpdated`
diferente de `true`, o sistema MUST recusar aquela fonte nomeando item e produto — independente do
código do `warning` reportado. Nenhuma observação de conclusão avança e dados existentes não são
sobrescritos como vazios.

#### Scenario: Rate limit de investimento
- **WHEN** o item está em `PARTIAL_SUCCESS` e o produto de investimento tem `isUpdated` diferente de
  `true`
- **THEN** a carga de investimento é recusada e os registros existentes permanecem intactos

#### Scenario: Partial success sem limite no produto da fonte
- **WHEN** o item está em `PARTIAL_SUCCESS`, mas o produto da fonte tem `isUpdated` igual a `true`
- **THEN** a carga daquela fonte segue normalmente

#### Scenario: Varredura de transações não é filtrada por updatedAt do recurso
- **WHEN** `ACCOUNT_TRANSACTIONS` está elegível e a listagem atual de contas traz contas cujo
  `updatedAt` não mudou desde a última observação
- **THEN** as transações dessas contas são varridas normalmente, junto com as demais — nenhuma conta
  é pulada só por `updatedAt` não ter avançado

## ADDED Requirements

### Requirement: Fonte de transação depende de sua fonte de descoberta estar utilizável na mesma execução
`ACCOUNT_TRANSACTIONS` só é considerada completamente processada quando, na mesma execução, tanto a
coleta de transações quanto `ACCOUNTS` estiverem utilizáveis (`isUpdated === true`, ou execução
`SUCCESS`) — sem a lista atual de contas, uma conta nova pode existir sem ter sido descoberta. Mesma
relação entre `INVESTMENT_TRANSACTIONS` e `INVESTMENTS`. A fonte de descoberta (`ACCOUNTS`,
`INVESTMENTS`) nunca depende da fonte de transação — avança sozinha quando utilizável.

#### Scenario: Transações não avançam sem a lista de contas atualizada
- **WHEN** o item está em `PARTIAL_SUCCESS`, `transactions.isUpdated === true` mas
  `accounts.isUpdated !== true`
- **THEN** `ACCOUNT_TRANSACTIONS` não é declarada completamente processada nesta execução, mesmo
  com a coleta de transações tendo sido bem-sucedida

#### Scenario: Lista de contas avança independente das transações
- **WHEN** o item está em `PARTIAL_SUCCESS`, `accounts.isUpdated === true` mas
  `transactions.isUpdated !== true`
- **THEN** a marca d'água de `ACCOUNTS` avança normalmente, independente do estado de
  `ACCOUNT_TRANSACTIONS`

#### Scenario: Mesma dependência para investimentos
- **WHEN** o item está em `PARTIAL_SUCCESS`, `investmentTransactions.isUpdated === true` mas
  `investments.isUpdated !== true`
- **THEN** `INVESTMENT_TRANSACTIONS` não é declarada completamente processada nesta execução

### Requirement: Leitura autoritativa de contas reconcilia a fotografia atual
Quando `ACCOUNTS` é utilizável nesta execução e a listagem completa é obtida com sucesso, a resposta
é autoritativa — inclusive lista vazia. Toda conta local daquele Item cujo identificador não veio na
leitura atual deixa de pertencer à fotografia atual. Fonte não utilizável nunca reconcilia nem toca
dado existente.

#### Scenario: Conta encerrada some da fotografia atual
- **WHEN** uma leitura autoritativa de `ACCOUNTS` não traz mais uma conta que a fotografia local já
  tinha para aquele item
- **THEN** essa conta deixa de pertencer à fotografia atual daquele item

#### Scenario: Contas não utilizáveis não reconciliam
- **WHEN** `ACCOUNTS` está recusada nesta execução (`isUpdated` diferente de `true` em
  `PARTIAL_SUCCESS`)
- **THEN** nenhuma reconciliação ocorre e a fotografia de contas existente permanece intocada
