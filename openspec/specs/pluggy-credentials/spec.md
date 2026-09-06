# pluggy-credentials Specification

## Purpose

Definir como este serviço obtém e usa a credencial (`clientId`/`clientSecret`) e o `itemId` de uma pessoa para
autenticar contra a API da Pluggy, e como ele reage quando esse dado não existe.

## Requirements

### Requirement: Credencial pertence a exatamente uma pessoa
Uma credencial Pluggy (`clientId`/`clientSecret`) pertence a exatamente uma pessoa. Uma pessoa pode ter mais de
uma credencial. Este serviço nunca usa a credencial de uma pessoa para autenticar uma chamada feita em nome de
outra. Quando webhook estiver habilitado, cada credencial MUST ter um segredo de entrada próprio, armazenado
cifrado e diferente de `clientSecret`; ele é usado somente para autenticar notificações recebidas. O id, URL
e evento do webhook remoto MUST permanecer com a credencial para permitir atualização sem duplicar inscrição.

#### Scenario: Chamada para uma pessoa usa só a credencial dela
- **WHEN** este serviço autentica contra a API da Pluggy para sincronizar dado de uma pessoa
- **THEN** usa exclusivamente uma credencial que pertence a essa pessoa

#### Scenario: Webhook não reutiliza o segredo da API Pluggy
- **WHEN** o serviço provisiona o webhook de uma credencial
- **THEN** configura um segredo de entrada próprio e nunca envia ou compara o `clientSecret` como header de webhook

### Requirement: Cada itemId resolve a uma única credencial
Um `itemId` só existe porque foi criado através de uma Application específica da Pluggy — nunca é ambíguo entre
credenciais. Este serviço resolve, para cada `itemId`, exatamente a credencial à qual ele pertence antes de
autenticar.

#### Scenario: itemId sem credencial resolvível é recusado
- **WHEN** este serviço recebe um `itemId` para sincronizar e não consegue resolver a credencial à qual ele
  pertence
- **THEN** a sincronização é recusada, nomeando o `itemId` sem credencial associada

### Requirement: Credencial ou itemId ausente é recusa nomeada, nunca default
Quando a credencial ou o `itemId` necessários para uma pessoa não existem, a operação é recusada nomeando o
que falta. Nunca segue sem autenticação, nunca substitui por credencial ou `itemId` de outra pessoa, nunca usa
valor vazio como se fosse ausência de dado válida.

#### Scenario: Pessoa sem nenhuma credencial cadastrada
- **WHEN** este serviço tenta sincronizar dado de uma pessoa que não tem nenhuma credencial Pluggy cadastrada
- **THEN** a operação é recusada nomeando a pessoa e a ausência de credencial

#### Scenario: Pessoa com credencial mas sem itemId cadastrado
- **WHEN** este serviço tenta sincronizar dado de uma pessoa que tem credencial, mas nenhum `itemId` associado
  a ela
- **THEN** a operação é recusada nomeando a pessoa e a ausência de `itemId`

### Requirement: Vínculo entre conta pessoal Pluggy e Application é responsabilidade externa ao produto
Este serviço não cria `Item`, não gera Connect Token, não abre Connect Widget e não automatiza a autorização
OAuth entre a conta pessoal Meu Pluggy e a Application do Dashboard. Esse vínculo é feito manualmente, fora do
produto, e o resultado (credencial e `itemId`) chega a este serviço já pronto, por configuração.

#### Scenario: Serviço nunca tenta criar item
- **WHEN** este serviço precisa de dado de uma pessoa sem `itemId` configurado
- **THEN** ele recusa a operação (ver requisito anterior) e não tenta criar um item nem iniciar um fluxo de
  conexão em nome da pessoa

### Requirement: Cadastro de credencial exige identidade verificada; personId nunca vem da requisição
O endpoint de cadastro de credencial nunca aceita `personId` como campo da requisição (corpo, query ou
qualquer outro dado fornecido pelo chamador). A pessoa é sempre resolvida a partir de um token de sessão
verificado. Toda recusa de autenticação responde de forma genérica, sem indicar qual foi o motivo (token
ausente, assinatura inválida, expirado, ou sem pessoa correspondente).

#### Scenario: Cadastro sem token de sessão é recusado
- **WHEN** uma requisição de cadastro de credencial chega sem token de sessão
- **THEN** é recusada com uma resposta genérica de não autenticado, sem tentar resolver `personId`

#### Scenario: personId enviado na requisição é ignorado
- **WHEN** uma requisição de cadastro de credencial inclui um `personId` diferente do dono do token de sessão
- **THEN** a credencial é cadastrada para a pessoa do token, nunca para o `personId` enviado
