## MODIFIED Requirements

### Requirement: Extrato exige conta de depósito conhecida
O sistema MUST buscar extrato somente para conta `BANK` ou `CREDIT` previamente descoberta e registrada a
partir do mesmo item. Ele nunca busca extrato por identificador recebido isoladamente.

#### Scenario: Item sem conta de depósito não gera busca de extrato
- **WHEN** a descoberta de um item não devolve nenhuma conta `BANK` nem `CREDIT`
- **THEN** nenhuma busca de extrato acontece e a carga termina sem erro de conta

#### Scenario: Conta de cartão de crédito gera busca de extrato
- **WHEN** a descoberta devolve uma conta `CREDIT`
- **THEN** a conta é registrada e fica elegível para busca de extrato, do mesmo jeito que uma conta `BANK`

## REMOVED Requirements

### Requirement: Cartão de crédito é ignorado nesta capacidade
**Reason**: decisão de escopo revertida — o titular precisa do extrato do cartão de crédito, e a fatura
(`creditData`) já é capturada pelo gateway de contas; só faltava não descartar a conta antes de registrá-la.
**Migration**: nenhuma migração de dado é necessária. Conta `CREDIT` já descoberta em cargas anteriores (mas
até então descartada) volta a ser processada normalmente na próxima sincronização, sem apagar nada que já
existia.

## ADDED Requirements

### Requirement: Campo de conta é capturado integralmente, nunca descartado
Todo campo que o schema `Account`/`CreditData` da Pluggy documenta MUST ser lido pelo gateway e persistido,
incluindo `taxNumber`, o objeto `bankData` inteiro (`closingBalance`, `automaticallyInvestedBalance`,
`overdraftContractedLimit`, `overdraftUsedLimit`, `unarrangedOverdraftAmount`, `hasReservedBalance`,
`reservedBalances`) e `disaggregatedCreditLimits`. Campo ausente ou `null` no payload da Pluggy continua
sendo aceito como ausência legítima — só a leitura do gateway não pode descartar um campo presente.

#### Scenario: Conta bancária traz saldo reservado
- **WHEN** a Pluggy devolve `bankData.hasReservedBalance: true` com uma `reservedBalances` não vazia
- **THEN** o registro grava a lista de saldos reservados, sem descartar nenhum item dela

#### Scenario: Cartão traz limite desagregado
- **WHEN** a Pluggy devolve `creditData.disaggregatedCreditLimits` com uma ou mais linhas
- **THEN** cada linha é persistida, sem descarte

#### Scenario: Conta traz CPF do titular
- **WHEN** a Pluggy devolve `taxNumber` para uma conta
- **THEN** o valor é persistido junto ao registro da conta
