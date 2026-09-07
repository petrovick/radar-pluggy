## MODIFIED Requirements

### Requirement: Atualização diária é reativa à Pluggy
O sistema MUST reagir a `item/created` e `item/updated` recebidos pelo webhook local, reler o item e
exigir marca d'água nova, por fonte real (`ACCOUNTS`, `ACCOUNT_TRANSACTIONS`, `INVESTMENTS`,
`INVESTMENT_TRANSACTIONS`), exclusiva do histórico — nenhuma das quatro tem marca d'água por
agrupamento (`CASH`/`CUSTODY`). Cada fonte MUST comparar seu próprio `lastUpdatedAt` reportado pela
Pluggy (`Item.statusDetail`) contra sua própria marca d'água — não a do item como um todo, nem a de
outra fonte do mesmo agrupamento. `CASH` é elegível para varredura quando `ACCOUNTS` **ou**
`ACCOUNT_TRANSACTIONS` estiver desatualizada; `CUSTODY`, quando `INVESTMENTS` **ou**
`INVESTMENT_TRANSACTIONS` estiver desatualizada. Em carga posterior, MUST chamar transações somente
para recurso cujo `updatedAt` avançou desde a última observação; se qualquer dos dois timestamps
faltar, MUST varrer a fonte inteira como fallback seguro. A marca de posição não pode bloquear o
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
