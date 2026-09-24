## Purpose

Define a exposição HTTP segura do serviço Pluggy para navegadores, chamadas internas e webhooks, incluindo cache e CORS.

## ADDED Requirements

### Requirement: CORS fechado por padrão
O serviço MUST não autorizar acesso cross-origin do navegador por padrão. Exceções MUST listar origens exatas e nunca combinar credenciais com `*`, origem `null` ou reflexão de origem não validada.

#### Scenario: Preflight externo direto
- **WHEN** um navegador envia preflight diretamente ao serviço com origem não autorizada
- **THEN** o serviço não autoriza essa origem

### Requirement: CSRF e respostas privadas
Mutações autenticadas por cookie MUST exigir token CSRF válido e origem permitida. Respostas de dados privados MUST incluir `Cache-Control: no-store`, inclusive quando o serviço é acessado diretamente.

#### Scenario: Mutação sem CSRF
- **WHEN** chega uma requisição autenticada por cookie para alterar uma credencial sem token CSRF válido
- **THEN** o serviço recusa a alteração

#### Scenario: Consulta direta
- **WHEN** uma pessoa consulta posições diretamente no serviço
- **THEN** a resposta traz `Cache-Control: no-store`

### Requirement: Exposição local restrita e webhooks independentes
Na execução local, o serviço MUST publicar sua porta apenas no loopback ou rede privada necessária. Webhooks MUST continuar autenticados por seu segredo próprio e MUST NOT aceitar o cookie do usuário como autenticação.

#### Scenario: Cliente fora da máquina local
- **WHEN** a pilha local é iniciada sem configuração explícita de rede privada
- **THEN** a porta do serviço não fica acessível em todas as interfaces de rede

#### Scenario: Webhook com cookie de usuário
- **WHEN** um webhook chega sem o segredo de entrada válido, mesmo levando cookie de usuário
- **THEN** a notificação é recusada
