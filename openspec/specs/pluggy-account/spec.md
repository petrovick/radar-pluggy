# pluggy-account Specification

## Purpose

Definir como contas de depósito de um item Pluggy são descobertas, paginadas e registradas neste serviço,
para que o extrato de caixa tenha uma origem conhecida e repetível.

## Requirements

### Requirement: Conta pertence ao item que a originou
Toda conta registrada MUST carregar o `itemId` que a originou. A pessoa dona da conta MUST ser resolvida
pela credencial daquele item; nunca é aceita da requisição ou do payload da Pluggy.

#### Scenario: Conta sem item é recusada
- **WHEN** uma conta é apresentada para gravação sem `itemId`
- **THEN** a gravação é recusada nomeando o campo ausente

### Requirement: Descoberta de contas percorre todas as páginas
O sistema MUST buscar todas as páginas da lista de contas antes de decidir quais contas existem para o item.
Uma página isolada nunca é tratada como a lista completa, e metadados de paginação incoerentes MUST recusar
a descoberta sem apagar contas já gravadas.

#### Scenario: Segunda página contém uma conta de depósito
- **WHEN** a primeira página de contas informa que há uma segunda página contendo uma conta `BANK`
- **THEN** a conta da segunda página é registrada e fica elegível para busca de extrato

### Requirement: Extrato exige conta de depósito conhecida
O sistema MUST buscar extrato somente para conta `BANK` previamente descoberta e registrada a partir do
mesmo item. Ele nunca busca extrato por identificador recebido isoladamente.

#### Scenario: Item sem conta de depósito não gera busca de extrato
- **WHEN** a descoberta de um item não devolve nenhuma conta `BANK`
- **THEN** nenhuma busca de extrato acontece e a carga termina sem erro de conta

### Requirement: Cartão de crédito é ignorado nesta capacidade
Conta `CREDIT` MUST ser ignorada sem recusar o item inteiro. Sua fatura e ciclo possuem significado próprio
e não fazem parte desta entrega.

#### Scenario: Descoberta contém conta e cartão
- **WHEN** a descoberta devolve uma conta `BANK` e uma conta `CREDIT`
- **THEN** somente a conta `BANK` é registrada e tem extrato buscado

### Requirement: Redescoberta atualiza sem duplicar nem apagar
Uma conta MUST ser identificada por (`itemId`, `accountId`). Nova descoberta substitui a linha do mesmo par;
conta ausente em uma resposta posterior MUST permanecer registrada, pois lista parcial ou consentimento
degradado não confirma encerramento.

#### Scenario: Segunda descoberta atualiza uma única linha
- **WHEN** a mesma conta é descoberta duas vezes com saldo diferente
- **THEN** existe uma linha para o par item-conta com o saldo mais recente

### Requirement: Saldo converte para Decimal na fronteira
O saldo MUST converter para `Decimal` ao entrar no sistema. `parseFloat` e aritmética sobre o `number` da
Pluggy são proibidos.

#### Scenario: Saldo chega como Decimal exato
- **WHEN** a Pluggy devolve `balance: 120950.37` para uma conta
- **THEN** o registro grava esse valor como `Decimal`, sem perda de precisão
