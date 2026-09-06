## MODIFIED Requirements

### Requirement: Credencial da Pluggy nunca é persistida por este registro
`PluggyItem` nunca armazena `clientId`, `clientSecret`, token de acesso ou qualquer segredo de autenticação —
esses dados são de propriedade e responsabilidade de uma entidade própria deste serviço (`PluggyCredential`),
nunca de `PluggyItem`. Este registro guarda só o estado público de sincronização (`itemId`, `status`,
`lastUpdatedAt`, vínculo a `personId`).

#### Scenario: Tentativa de persistir credencial é recusada
- **WHEN** uma criação ou atualização de `PluggyItem` inclui um campo de credencial (`clientSecret`, token de
  acesso, ou equivalente)
- **THEN** a operação é recusada, nomeando o campo que não pertence a este registro
