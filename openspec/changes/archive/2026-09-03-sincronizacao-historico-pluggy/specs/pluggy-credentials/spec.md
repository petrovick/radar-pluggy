## MODIFIED Requirements

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
