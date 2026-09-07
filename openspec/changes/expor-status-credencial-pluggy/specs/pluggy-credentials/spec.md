## ADDED Requirements

### Requirement: Estado de configuração da credencial é consultável via HTTP, autenticado
Este serviço expõe um endpoint autenticado que informa se a pessoa da sessão tem credencial Pluggy
configurada e pronta para sincronizar (credencial existente com ao menos um `itemId` vinculado).
A resposta é um booleano simples — nunca expõe qual credencial ou `itemId` está associado, nem
distingue "sem nenhuma credencial" de "credencial sem itemId vinculado". A ausência de configuração
é reportada como sucesso (o estado é consultável, não uma falha), não como erro HTTP.

#### Scenario: Pessoa sem nenhuma credencial cadastrada consulta o próprio estado
- **WHEN** a pessoa da sessão consulta o estado de configuração e não tem nenhuma credencial Pluggy
  cadastrada
- **THEN** a resposta indica configuração ausente, com sucesso HTTP

#### Scenario: Pessoa com credencial mas sem itemId vinculado consulta o próprio estado
- **WHEN** a pessoa da sessão consulta o estado de configuração e tem credencial cadastrada, mas
  nenhum `itemId` vinculado a ela
- **THEN** a resposta indica configuração ausente, com sucesso HTTP — sem distinguir este cenário do
  de nenhuma credencial cadastrada

#### Scenario: Pessoa com credencial e itemId vinculado consulta o próprio estado
- **WHEN** a pessoa da sessão consulta o estado de configuração e tem credencial com ao menos um
  `itemId` vinculado
- **THEN** a resposta indica configuração presente

#### Scenario: Consulta sem token de sessão é recusada
- **WHEN** uma requisição de consulta de estado chega sem token de sessão
- **THEN** é recusada com uma resposta genérica de não autenticado, sem tentar resolver `personId`
