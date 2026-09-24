## MODIFIED Requirements

### Requirement: Cadastro de credencial exige identidade verificada; personId nunca vem da requisição
O endpoint de cadastro de credencial MUST NOT aceitar `personId` como campo da requisição (corpo, query ou qualquer outro dado fornecido pelo chamador). A pessoa MUST ser resolvida a partir de uma sessão opaca ativa validada pela API. Toda recusa de autenticação MUST responder de forma genérica, sem indicar se a sessão está ausente, expirada, revogada ou sem pessoa correspondente.

#### Scenario: Cadastro sem token de sessão é recusado
- **WHEN** uma requisição de cadastro de credencial chega sem sessão válida
- **THEN** é recusada com uma resposta genérica de não autenticado, sem tentar resolver `personId`

#### Scenario: personId enviado na requisição é ignorado
- **WHEN** uma requisição de cadastro de credencial inclui um `personId` diferente do dono da sessão
- **THEN** a credencial é cadastrada para a pessoa da sessão, nunca para o `personId` enviado
