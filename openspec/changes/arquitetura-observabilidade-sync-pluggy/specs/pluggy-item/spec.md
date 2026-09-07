## MODIFIED Requirements

### Requirement: Estado de sincronização restrito ao conjunto documentado pela Pluggy
`PluggyItem.status` só aceita um dos valores que a Pluggy documenta para o campo `status` do `Item`:
`UPDATING`, `LOGIN_ERROR`, `OUTDATED`, `WAITING_USER_INPUT`, `WAITING_USER_ACTION`, `MERGING`,
`UPDATED`. Um valor fora desse conjunto nunca é persistido.

#### Scenario: Status desconhecido é recusado
- **WHEN** uma atualização de `PluggyItem` chega com um `status` que não pertence ao conjunto documentado
- **THEN** a atualização é recusada nomeando o valor recebido

#### Scenario: Status de espera por ação do titular é aceito
- **WHEN** uma atualização de `PluggyItem` chega com `status` `WAITING_USER_ACTION`
- **THEN** a atualização é aceita normalmente

#### Scenario: Status de mesclagem é aceito
- **WHEN** uma atualização de `PluggyItem` chega com `status` `MERGING`
- **THEN** a atualização é aceita normalmente

## ADDED Requirements

### Requirement: Identidade do connector é capturada no vínculo e atualizada em toda observação subsequente
O connector (instituição financeira) de um item — `connectorId`, `connectorName`,
`connectorImageUrl`, `connectorPrimaryColor` — é capturado a partir do próprio payload do `Item` no
momento em que o vínculo entre credencial e item é criado, nunca inferido pelo nome da instituição
nem deixado em branco quando o payload o traz. Sempre que este serviço observa um Item válido
novamente e o payload traz `connector`, a identidade conhecida do vínculo é atualizada a partir desse
payload — sem chamada extra a `GET /connectors/{id}`, sempre reaproveitando o `connector` já embutido
no `GET /items/{id}` que a observação já faz.

#### Scenario: Vínculo novo captura o connector do payload
- **WHEN** um vínculo entre credencial e item é criado e o `Item` lido da Pluggy traz um `connector`
- **THEN** a identidade do connector é persistida junto do vínculo, a partir desse payload

#### Scenario: Connector nunca é inferido pelo nome
- **WHEN** a identidade do connector de um item precisa ser conhecida
- **THEN** ela vem exclusivamente do `connectorId` capturado do payload da Pluggy, nunca de
  correspondência por nome de instituição

#### Scenario: Vínculo legado sem connector é preenchido na próxima observação
- **WHEN** um vínculo já existente não tem identidade de connector persistida e uma observação
  subsequente do mesmo item traz `connector` válido
- **THEN** a identidade do connector é persistida no vínculo, sem exigir novo cadastro

#### Scenario: Mudança de metadata do connector chega ao vínculo sem re-cadastro
- **WHEN** um vínculo já tem identidade de connector persistida e uma observação subsequente do
  mesmo item traz um `connector` com `name`, `imageUrl` ou `primaryColor` diferentes dos já
  persistidos
- **THEN** a identidade do connector do vínculo é atualizada para refletir o payload mais recente
