## Context

Ver `proposal.md` e os deltas de `auth/revocable-session`, `pluggy-credentials` e `security/http-boundary`. O middleware de usuário verifica Bearer JWT com HMAC compartilhado com a API. O frontend encaminha `/api/pluggy` para este serviço. A porta local do Compose ainda é publicada em todas as interfaces e as respostas diretas não recebem os cabeçalhos sem cache do proxy.

## Goals / Non-Goals

**Goals:** revogação imediata, identidade derivada de sessão válida, isolamento entre pessoas, política HTTP própria e exposição local mínima.

**Non-Goals:** alterar a autenticação dos webhooks Pluggy, o fluxo de conexão externa ou o recurso legado `Car`.

## Decisions

1. **Introspecção, não HMAC compartilhado:** em rotas de usuário, encaminhar o identificador de sessão recebido à API por endpoint privado com credencial própria do serviço. A API retorna a pessoa e avalia CSRF quando aplicável; Pluggy nunca usa `personId` do cliente. Não manter cache positivo para que logout seja imediato. Alternativa de acesso direto à tabela compartilharia detalhes de persistência e dificulta controle de autorização.
2. **Separar usuário de webhook:** aplicar cookie, origem e CSRF somente às rotas de usuário. Webhooks continuam autenticados pelo segredo de entrada por credencial e não aceitam cookie como substituto. O endpoint de introspecção deve ser inacessível ao público.
3. **Fronteira HTTP local:** exigir `Cache-Control: no-store` nas respostas privadas no próprio serviço, CORS sem autorização por padrão e publicação Docker em `127.0.0.1` salvo rede privada explicitamente necessária. Se houver outra origem autorizada, usar lista exata e preflight; CORS sozinho não protege mutações.
4. **Dependências e isolamento:** revisar avisos transitivos de `sequelize`/`uuid` com atualização compatível e testar identificadores de conta, item e credencial entre duas pessoas. Não fazer downgrade automático de ORM.

## Risks / Trade-offs

- [API indisponível bloqueia chamadas Pluggy] → timeout curto, erro controlado e falha fechada, sem reutilizar uma validação antiga.
- [Migração dual mantém JWT temporariamente] → prazo curto, métricas de uso e remoção coordenada com API/frontend.
- [Rede privada/container difere do host local] → testar acesso do proxy e negar conexão a partir de outra máquina na execução local.

## Migration Plan

1. Aplicar no-store, CORS, exposição local e testes de isolamento sem alterar autenticação.
2. Depois da API oferecer introspecção privada, aceitar sessão opaca e Bearer legado por janela delimitada; provar logout, expiração, CSRF, falha da API e webhooks.
3. Após publicação do frontend, invalidar JWT legado junto com a API e remover verificador HMAC e segredo compartilhado do serviço.
4. Se houver rollback do frontend, restaurar temporariamente os dois validadores nos dois serviços e exigir novo login; manter as proteções independentes de sessão.
