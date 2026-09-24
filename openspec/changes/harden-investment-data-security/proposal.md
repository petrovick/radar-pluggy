## Why

O serviço Pluggy lê dados financeiros de múltiplas pessoas e hoje valida JWT com a mesma chave HMAC da API. Precisa participar da revogação de sessão e estabelecer sua própria fronteira HTTP, inclusive quando acessado diretamente.

## What Changes

- **BREAKING**: validar a sessão opaca revogável emitida pela API e deixar de depender da chave compartilhada de assinatura JWT para requisições de usuário.
- Resolver a identidade do usuário exclusivamente da sessão validada, inclusive no cadastro de credenciais Pluggy; manter webhooks com autenticação própria.
- Definir CORS fechado por padrão, CSRF nas mutações por cookie e cabeçalhos sem cache nas respostas privadas diretas.
- Limitar a publicação local do serviço ao loopback ou rede privada necessária e testar autorização entre duas contas.
- Rever dependências afetadas por avisos de segurança sem aceitar correções que introduzam downgrade incompatível.

## Capabilities

### New Capabilities

- `auth/revocable-session`: validação de sessão ativa da API e tratamento de expiração e revogação.
- `security/http-boundary`: CORS, CSRF, cache, exposição de rede e separação de webhooks.

### Modified Capabilities

- `pluggy-credentials`: cadastro de credenciais resolve a pessoa pela sessão opaca validada, sem aceitar identidade declarada pelo cliente.

## Impact

Middleware de autenticação, rotas de credenciais e dados, webhook, Compose, proxy e testes. Depende das propostas homônimas em `oplab-radar-api` e `oplab-radar-front`; o design precisa incluir migração e rollback coordenados. O recurso legado `Car` está fora do escopo.
