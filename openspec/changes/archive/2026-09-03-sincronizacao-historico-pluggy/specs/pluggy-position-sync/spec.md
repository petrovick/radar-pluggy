## MODIFIED Requirements

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

## ADDED Requirements

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
