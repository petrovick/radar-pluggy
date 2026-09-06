## Purpose

Decidir quando este serviço busca a posição de investimento de um item na Pluggy, e como grava a
fotografia resultante, sem gastar chamada de API além do estritamente necessário.

## ADDED Requirements

### Requirement: Sincronização só ocorre quando o portão de marca d'água do item libera
Antes de buscar investimentos, o serviço lê o estado fresco do item (`executionStatus`, `lastUpdatedAt`).
A busca de investimentos só acontece quando `executionStatus` é `SUCCESS` e o `lastUpdatedAt` fresco é mais
novo que o já registrado para aquele item.

#### Scenario: Item sem mudança não gera nenhuma chamada de investimentos
- **WHEN** o `lastUpdatedAt` fresco do item não é mais novo que o já registrado
- **THEN** nenhuma chamada a `GET /investments` acontece, e a sincronização termina sem erro

#### Scenario: Item com executionStatus diferente de SUCCESS não sincroniza
- **WHEN** o item fresco vem com `executionStatus` diferente de `SUCCESS`
- **THEN** nenhuma chamada a `GET /investments` acontece

### Requirement: Cada sincronização grava a fotografia mais recente, sem histórico
A posição de um investimento, dentro de um item, é identificada por (`itemId`, `investmentId`). Uma nova
sincronização substitui a fotografia anterior do mesmo par — nunca cria uma segunda linha para o mesmo
investimento.

#### Scenario: Segunda sincronização do mesmo investimento atualiza a linha existente
- **WHEN** o mesmo investimento (mesmo `itemId` e `investmentId`) é sincronizado duas vezes, com valores
  diferentes na segunda vez
- **THEN** existe só uma linha para esse investimento, com os valores da segunda sincronização

### Requirement: Campo obrigatório da Pluggy é obrigatório aqui; campo opcional é opcional aqui
`id`, `itemId`, `type`, `balance`, `name`, `currencyCode` e a data da cotação são obrigatórios — ausência
recusa nomeando o campo. `subtype`, `code`, `isin`, `quantity`, `amountOriginal`, `status` e a instituição
podem faltar sem recusa: a ausência reflete o investimento não ter aquele atributo, não um dado incompleto.

#### Scenario: Investimento sem balance é recusado
- **WHEN** um investimento retornado pela Pluggy não traz `balance`
- **THEN** a gravação desse investimento é recusada nomeando o campo ausente

#### Scenario: Investimento sem quantity é aceito
- **WHEN** um investimento retornado pela Pluggy não traz `quantity`
- **THEN** a fotografia é gravada normalmente, sem valor para `quantity`

### Requirement: Lista de investimentos vazia com portão aberto é recusa nomeada
Quando o portão de marca d'água libera a sincronização mas a Pluggy devolve uma lista vazia de
investimentos para o item, isso é tratado como estado de reconexão — nunca como "portfólio ficou vazio".
Nenhuma posição existente é apagada ou sobrescrita nesse caso.

#### Scenario: Lista vazia recusa nomeando o item, sem apagar posição existente
- **WHEN** o portão libera a sincronização e `GET /investments` devolve uma lista vazia para o item
- **THEN** a sincronização é recusada nomeando o item, e nenhuma fotografia de posição existente é alterada

### Requirement: Todo valor monetário ou quantidade converte para Decimal na fronteira
`balance` sempre, e `quantity`/`amountOriginal` quando presentes, convertem para `Decimal` via
`new Decimal(String(n))` no ponto em que o dado entra — nunca `parseFloat`, nunca aritmética sobre o `number`
recebido da Pluggy. `value`, `amount`, `taxes` e `taxes2` não são capturados por esta entrega (design.md D3):
a regra não abre exceção pra eles, o dado simplesmente não entra.

#### Scenario: Balance chega como Decimal exato
- **WHEN** a Pluggy devolve `balance: 1359.39` para um investimento
- **THEN** a fotografia grava esse valor como `Decimal`, sem perda de precisão
