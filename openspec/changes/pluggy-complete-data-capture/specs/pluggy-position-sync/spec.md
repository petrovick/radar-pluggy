## MODIFIED Requirements

### Requirement: Campo obrigatório da Pluggy é obrigatório aqui; campo opcional é opcional aqui
`id`, `itemId`, `type`, `balance`, `name`, `currencyCode` e a data da cotação são obrigatórios — ausência
recusa nomeando o campo. `subtype`, `code`, `isin`, `quantity`, `amountOriginal`, `status`, a instituição
(`institutionName`/`institutionNumber`), `issuerCNPJ`, `number`, `amountWithdrawal`, `amountProfit`,
`dueDate`, `issuer`, `issueDate`, `purchaseDate`, `rate`, `rateType`, `fixedAnnualRate`, `lastMonthRate`,
`annualRate`, `lastTwelveMonthsRate`, `owner` e `metadata` (`taxRegime`, `proposalNumber`, `processNumber`)
podem faltar sem recusa: a ausência reflete o investimento não ter aquele atributo, não um dado incompleto.

#### Scenario: Investimento sem balance é recusado
- **WHEN** um investimento retornado pela Pluggy não traz `balance`
- **THEN** a gravação desse investimento é recusada nomeando o campo ausente

#### Scenario: Investimento sem quantity é aceito
- **WHEN** um investimento retornado pela Pluggy não traz `quantity`
- **THEN** a fotografia é gravada normalmente, sem valor para `quantity`

#### Scenario: Investimento de renda fixa traz vencimento e taxa
- **WHEN** um investimento `FIXED_INCOME` retornado pela Pluggy traz `dueDate`, `rate` e `rateType`
- **THEN** a fotografia grava os três campos, sem descartar nenhum

#### Scenario: Investimento traz rentabilidade
- **WHEN** um investimento retornado pela Pluggy traz `amountProfit`
- **THEN** a fotografia grava esse valor, sem descarte

### Requirement: Todo valor monetário ou quantidade converte para Decimal na fronteira
`balance` sempre, e `quantity`, `amountOriginal`, `value`, `amount`, `taxes`, `taxes2`, `amountWithdrawal`,
`amountProfit`, `rate`, `fixedAnnualRate`, `lastMonthRate`, `annualRate` e `lastTwelveMonthsRate` quando
presentes, MUST converter para `Decimal` via `new Decimal(String(n))` no ponto em que entram. `parseFloat` e
aritmética sobre o `number` recebido da Pluggy são proibidos. `quantity` e `value` usam `DECIMAL(20,8)`, pois
a Pluggy pode entregar oito casas; `balance`, `amountOriginal`, `amount`, `taxes` e `taxes2` usam
`DECIMAL(20,2)`. A escala de coluna dos campos novos (`amountWithdrawal`, `amountProfit`, `rate` e demais
taxas) é decisão de design/migration, não deste requisito — o requisito é a conversão para `Decimal`, sem
perda, qualquer que seja a escala escolhida.

#### Scenario: Balance chega como Decimal exato
- **WHEN** a Pluggy devolve `balance: 1359.39` para um investimento
- **THEN** a fotografia grava esse valor como `Decimal`, sem perda de precisão

#### Scenario: Value fracionário é preservado
- **WHEN** a API de posição processa um investimento que envia `value` com oito casas decimais
- **THEN** o registro preserva todas as oito casas em `DECIMAL(20,8)`

#### Scenario: Campos financeiros opcionais são incluídos
- **WHEN** a API de posição processa um ativo que envia `amount`, `taxes` ou `taxes2`
- **THEN** cada campo é convertido para Decimal e inserido na coluna financeira correspondente

#### Scenario: Rentabilidade converte para Decimal
- **WHEN** a API de posição processa um ativo que envia `amountProfit`
- **THEN** o valor é convertido para Decimal e inserido na coluna correspondente, sem perda de precisão
