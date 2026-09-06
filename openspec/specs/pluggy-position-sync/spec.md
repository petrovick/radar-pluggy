# pluggy-position-sync Specification

## Purpose

Decidir quando este serviço busca a posição de investimento de um item na Pluggy, e como grava a
fotografia resultante, sem gastar chamada de API além do estritamente necessário.

## Requirements

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
`balance` sempre, e `quantity`, `amountOriginal`, `value`, `amount`, `taxes` e `taxes2` quando presentes,
MUST converter para `Decimal` via `new Decimal(String(n))` no ponto em que entram. `parseFloat` e
aritmética sobre o `number` recebido da Pluggy são proibidos. `value`, `amount`, `taxes` e `taxes2` MUST ser
capturados e armazenados; `quantity` e `value` usam `DECIMAL(20,8)`, pois a Pluggy pode entregar oito casas,
enquanto `balance`, `amountOriginal`, `amount`, `taxes` e `taxes2` usam `DECIMAL(20,2)`.

#### Scenario: Balance chega como Decimal exato
- **WHEN** a Pluggy devolve `balance: 1359.39` para um investimento
- **THEN** a fotografia grava esse valor como `Decimal`, sem perda de precisão

#### Scenario: Value fracionário é preservado
- **WHEN** a API de posição processa um investimento que envia `value` com oito casas decimais
- **THEN** o registro preserva todas as oito casas em `DECIMAL(20,8)`

#### Scenario: Campos financeiros opcionais são incluídos
- **WHEN** a API de posição processa um ativo que envia `amount`, `taxes` ou `taxes2`
- **THEN** cada campo é convertido para Decimal e inserido na coluna financeira correspondente

### Requirement: Cada sincronização bem-sucedida também grava um snapshot histórico
Além de atualizar a fotografia (que continua sem histórico), toda sincronização que grava uma fotografia
nova MUST também gravar, na mesma operação atômica, um snapshot append-only identificado por (`itemId`,
`investmentId`, `quotaDate`). A Pluggy não oferece endpoint de valor histórico de investimento — o
snapshot é a única forma de reconstruir evolução de patrimônio no futuro, e um dia não capturado nunca é
recuperável depois. `quotaDate` é a data da cotação reportada pela Pluggy, não o instante em que este
serviço processou a sincronização.

#### Scenario: Primeira sincronização do dia cria o snapshot
- **WHEN** a fotografia de um investimento é atualizada e ainda não existe snapshot para aquele
  `itemId`/`investmentId`/`quotaDate`
- **THEN** um novo snapshot é gravado com os mesmos valores financeiros da fotografia

#### Scenario: Segunda sincronização do mesmo dia não duplica
- **WHEN** o mesmo `itemId`/`investmentId`/`quotaDate` já tem um snapshot gravado
- **THEN** a sincronização atualiza esse snapshot em vez de criar uma segunda linha

#### Scenario: Sincronização de outro dia cria uma linha nova
- **WHEN** a fotografia é atualizada com uma `quotaDate` diferente da última já observada
- **THEN** o snapshot anterior permanece intacto e uma nova linha é gravada para a nova data

#### Scenario: Falha ao gravar o snapshot também recusa a fotografia
- **WHEN** a gravação do snapshot falha
- **THEN** a atualização da fotografia na mesma sincronização é revertida, nunca ficando dessincronizada
