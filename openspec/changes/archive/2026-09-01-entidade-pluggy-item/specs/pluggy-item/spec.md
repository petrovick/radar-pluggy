## Purpose

Registrar, de forma durável e íntegra, o estado de sincronização de uma conexão Pluggy (`Item`) por
pessoa, para que interactors de sincronização e o futuro handler de webhook tenham uma fonte confiável de
"em que ponto está esse item" sem reconstruir isso a cada chamada à Pluggy.

## ADDED Requirements

### Requirement: Identidade única do item e vínculo obrigatório a uma pessoa
Cada `PluggyItem` é identificado de forma única pelo `itemId` da Pluggy (um UUID) e pertence a exatamente
uma pessoa (`personId`). Não existe `PluggyItem` sem pessoa vinculada, nem dois registros para o mesmo
`itemId`.

#### Scenario: Criação sem pessoa vinculada é recusada
- **WHEN** um `PluggyItem` é criado sem `personId`
- **THEN** a criação é recusada nomeando o campo ausente

#### Scenario: Duplicidade de itemId é recusada
- **WHEN** já existe um `PluggyItem` para determinado `itemId` e uma segunda criação é tentada com o
  mesmo `itemId`
- **THEN** a criação é recusada pela restrição de unicidade

### Requirement: Estado de sincronização restrito ao conjunto documentado pela Pluggy
`PluggyItem.status` só aceita um dos valores que a Pluggy documenta para o campo `status` do `Item`:
`UPDATING`, `LOGIN_ERROR`, `OUTDATED`, `WAITING_USER_INPUT`, `UPDATED`. Um valor fora desse conjunto nunca
é persistido.

#### Scenario: Status desconhecido é recusado
- **WHEN** uma atualização de `PluggyItem` chega com um `status` que não pertence ao conjunto documentado
- **THEN** a atualização é recusada nomeando o valor recebido

### Requirement: Marca d'água de sincronização nunca retrocede
O campo que guarda a última sincronização bem-sucedida (`lastUpdatedAt`) só avança. Uma tentativa de
gravar um `lastUpdatedAt` anterior ao já registrado é recusada, para preservar a garantia de
"dia sem movimento ⇒ zero chamadas de transação" que a sincronização por marca d'água depende.

#### Scenario: Watermark mais antigo é recusado
- **WHEN** o `PluggyItem` já tem um `lastUpdatedAt` registrado e uma atualização chega com um
  `lastUpdatedAt` anterior a esse valor
- **THEN** a atualização é recusada, e o `lastUpdatedAt` registrado permanece inalterado

### Requirement: Credencial da Pluggy nunca é persistida por este registro
`PluggyItem` nunca armazena `clientId`, `clientSecret`, token de acesso ou qualquer segredo de
autenticação — esses dados são de propriedade e responsabilidade do `oplab-radar-api`. Este registro
guarda só o estado público de sincronização (`itemId`, `status`, `lastUpdatedAt`, vínculo a `personId`).

#### Scenario: Tentativa de persistir credencial é recusada
- **WHEN** uma criação ou atualização de `PluggyItem` inclui um campo de credencial (`clientSecret`,
  token de acesso, ou equivalente)
- **THEN** a operação é recusada, nomeando o campo que não pertence a este registro
