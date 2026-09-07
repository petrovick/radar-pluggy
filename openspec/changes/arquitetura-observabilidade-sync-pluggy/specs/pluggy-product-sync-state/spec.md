## Purpose

Registrar, por item e por produto (`INVESTMENTS`, `LOANS`, `CASH`, `CUSTODY`), até que versão dos
dados daquele produto específico este serviço já processou com sucesso — para que um produto
recusado por limite operacional seja retentado assim que ele próprio avançar, sem depender do item
inteiro mudar de novo e sem um produto saudável esperar por outro que está travado.

## ADDED Requirements

### Requirement: Marca d'água é por item e por produto, nunca só por item
Cada combinação (`itemId`, `produto`) tem sua própria marca d'água, independente das demais
combinações do mesmo item. Um produto avançar nunca move a marca d'água de outro produto do mesmo
item.

#### Scenario: Dois produtos do mesmo item avançam de forma independente
- **WHEN** `INVESTMENTS` é processado com sucesso para um item e `LOANS` não é
- **THEN** a marca d'água de `INVESTMENTS` daquele item avança e a de `LOANS` permanece a que já
  estava registrada

### Requirement: Marca d'água de produto nunca retrocede
Uma tentativa de gravar, para um (`itemId`, `produto`), um timestamp anterior ao já registrado é
recusada — a marca d'água registrada permanece inalterada.

#### Scenario: Timestamp mais antigo é recusado
- **WHEN** já existe marca d'água registrada para (`itemId`, `produto`) e uma gravação chega com
  timestamp anterior a esse valor
- **THEN** a gravação é recusada e a marca d'água registrada não muda

### Requirement: Produto nunca observado é sempre elegível
Ausência de marca d'água para um (`itemId`, `produto`) nunca é tratada como "já processado" — é
tratada como "nunca observado", sempre elegível para uma primeira tentativa.

#### Scenario: Produto sem marca d'água prévia é elegível
- **WHEN** não existe nenhuma marca d'água registrada para um (`itemId`, `produto`)
- **THEN** esse produto é considerado elegível para processamento, independente de qualquer outro
  sinal de mudança
