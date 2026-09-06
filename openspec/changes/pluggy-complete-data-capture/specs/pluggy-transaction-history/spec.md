## ADDED Requirements

### Requirement: Metadado de cartão de crédito é capturado quando presente
Quando a Pluggy devolve `creditCardMetadata` numa transação de conta, todos os seus campos
(`installmentNumber`, `totalInstallments`, `totalAmount`, `payeeMCC`, `purchaseDate`, `billId`,
`cardNumber`, `feeType`, `feeTypeAdditionalInfo`, `otherCreditsType`, `otherCreditsAdditionalInfo`,
`billForecastDate`) MUST ser lidos e persistidos junto à transação. Ausência de `creditCardMetadata`
(transação de conta que não é cartão) continua sendo estado normal, não erro.

#### Scenario: Transação parcelada de cartão preserva parcelamento
- **WHEN** uma transação de cartão de crédito traz `creditCardMetadata.installmentNumber` e
  `totalInstallments`
- **THEN** os dois valores são persistidos junto à transação

#### Scenario: Transação de cartão traz fatura prevista
- **WHEN** uma transação de cartão de crédito traz `creditCardMetadata.billForecastDate`
- **THEN** o valor é persistido junto à transação

#### Scenario: Transação de conta corrente sem cartão
- **WHEN** uma transação de conta `BANK` não traz `creditCardMetadata`
- **THEN** a transação é gravada normalmente, sem valor para os campos de cartão
