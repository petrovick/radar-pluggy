## Purpose

Definir como um contrato de empréstimo (`Loan`) de um item Pluggy é descoberto, sincronizado e registrado
neste serviço, capturando o schema completo do contrato para uso patrimonial e auditoria futura.

## ADDED Requirements

### Requirement: Empréstimo pertence ao item que o originou
Todo empréstimo registrado MUST carregar o `itemId` que o originou. A pessoa dona do empréstimo é resolvida
pela credencial daquele item, nunca aceita isoladamente.

#### Scenario: Empréstimo sem item é recusado
- **WHEN** um empréstimo é apresentado para gravação sem `itemId`
- **THEN** a gravação é recusada nomeando o campo ausente

### Requirement: Cada sincronização grava a fotografia mais recente e um snapshot histórico
O empréstimo, dentro de um item, é identificado por (`itemId`, `loanId`). Uma nova sincronização substitui
a fotografia anterior do mesmo par. Além da fotografia, toda sincronização MUST também gravar, na mesma
operação atômica, um snapshot append-only do saldo devedor e das contagens de parcela — a Pluggy não
oferece histórico de saldo devedor, e um dia não capturado nunca é recuperável depois.

#### Scenario: Segunda sincronização do mesmo empréstimo atualiza a fotografia
- **WHEN** o mesmo empréstimo é sincronizado duas vezes, com saldo devedor diferente na segunda vez
- **THEN** existe só uma linha de fotografia para esse empréstimo, com o saldo da segunda sincronização

#### Scenario: Cada sincronização acrescenta um snapshot
- **WHEN** um empréstimo já sincronizado é sincronizado de novo
- **THEN** um novo snapshot é gravado, e o snapshot anterior permanece intacto

### Requirement: Campo do contrato é capturado integralmente
Todo campo que o schema `Loan` da Pluggy documenta MUST ser lido pelo gateway e persistido: identificação
do contrato (`contractNumber`, `ipocCode`, `productName`, `type`, `kind`), datas (`contractDate`,
`disbursementDates`, `settlementDate`, `dueDate`, `firstInstallmentDueDate`), condições
(`contractAmount`, `CET`, `installmentPeriodicity`, `installmentPeriodicityAdditionalInfo`,
`amortizationScheduled`, `amortizationScheduledAdditionalInfo`, `cnpjConsignee`), e as listas
`interestRates`, `contractedFees`, `contractedFinanceCharges`, `warranties`, `installments` (incluindo
`balloonPayments`) e `payments` (incluindo `payments.releases`). Campo ausente ou `null` no payload da
Pluggy é aceito como ausência legítima, nunca recusa.

#### Scenario: Contrato com taxa de juros indexada
- **WHEN** a Pluggy devolve `interestRates` com um indexador e taxa pré ou pós-fixada
- **THEN** a linha inteira de `interestRates` é persistida, sem descarte de campo

#### Scenario: Contrato com garantia
- **WHEN** a Pluggy devolve `warranties` com um item de garantia
- **THEN** o item é persistido com todos os seus campos

#### Scenario: Pagamento fora da parcela
- **WHEN** a Pluggy devolve `payments.releases` com uma liberação de pagamento fora do calendário
  (`isOverParcelPayment: true`)
- **THEN** a liberação é persistida com seus encargos e tarifas associados

### Requirement: Valor monetário de campo escalar converte para Decimal; dentro de lista/objeto aninhado é preservado opaco
`contractAmount`, `CET` e `payments.contractOutstandingBalance` (extraído como `outstandingBalance`) MUST
converter para `Decimal` via `new Decimal(String(n))` no ponto em que entram — `parseFloat` e aritmética
sobre o `number` recebido da Pluggy são proibidos para esses campos. `interestRates`, `contractedFees`,
`contractedFinanceCharges`, `warranties`, e o restante de `installments`/`payments` além dos campos
escalares já extraídos (incluindo qualquer valor monetário dentro de `payments.releases` ou
`installments.balloonPayments`) são objetos/listas aninhadas complexas do Open Banking Brasil, carregadas
opacas — mesmo tratamento de `merchant`/`paymentData` na capacidade `pluggy-transaction-history`: sem
conversão campo a campo, sem lógica de negócio nossa em cima dos números que carregam.

#### Scenario: Saldo devedor chega como Decimal exato
- **WHEN** a Pluggy devolve `payments.contractOutstandingBalance: 4523.10`
- **THEN** o registro grava esse valor como `Decimal`, sem perda de precisão

#### Scenario: Valor monetário dentro de lista aninhada é preservado como veio
- **WHEN** a Pluggy devolve `contractedFees` com um item cujo `amount` é `150.5`
- **THEN** o valor é persistido dentro do JSON opaco exatamente como recebido, sem conversão para
  `Decimal`
