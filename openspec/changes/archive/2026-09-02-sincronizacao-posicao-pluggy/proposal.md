## Why

Existem credencial, resolução de credencial por `itemId` e cliente de autenticação (`configuracao-credenciais-pluggy`), mas nenhum código chama de fato a Pluggy pra buscar posição de investimento. Sem isso, a integração não produz nenhum dado real — é o próximo elo da cadeia.

## What Changes

- Novo gateway `GET /items/{id}` — lê `status`/`executionStatus`/`lastUpdatedAt` frescos da Pluggy.
- Novo gateway `GET /investments?itemId=X` — lê a lista de investimentos do item, com valor/quantidade convertidos pra `Decimal` na fronteira (fronteira-pluggy, regra 1).
- Nova entidade `PluggyPosition` — fotografia de um investimento num item, num instante.
- Nova tabela `pluggy_positions` (mesma convenção de `pluggy_items`) — guarda a fotografia mais recente por item + investimento (sem histórico completo nesta entrega — ver design.md).
- Novo interactor de sincronização: dado um `itemId`, resolve a credencial, autentica, busca o item fresco, aplica o portão de marca d'água (fronteira-pluggy, regra 6 — só segue se `executionStatus: SUCCESS` e `lastUpdatedAt` mais novo que o guardado), busca os investimentos e grava a posição. Avança a marca d'água em `PluggyItem` só quando o portão passa.
- **Fora do escopo, deliberadamente:** provento/`investment_income` (D18 do ADR 0029 — precisa de mapa de classificação próprio, change futuro), busca de `GET /investments/{id}/transactions` (só entra quando o change de provento existir — é o único consumidor dela), e o handler de webhook que dispara este interactor a partir de um evento real (change futuro; este interactor é chamável diretamente, testado sem o webhook, mesmo padrão de `PluggyAuthGateway`/`FindPluggyCredentialInteractor`).

## Capabilities

### New Capabilities
- `pluggy-position-sync`: como este serviço decide se sincroniza a posição de um item (portão de marca d'água) e como grava a fotografia resultante.

### Modified Capabilities
(nenhuma)

## Impact

- Novos arquivos em `adapters/gateways/` (dois gateways HTTP), `entities/`, `infra/db/{migrations,models}/`, `adapters/repositories/`, `interactors/pluggy-position/sync/`.
- Depende do que já existe: `FindPluggyCredentialInteractor`, `PluggyAuthGateway`, `PluggyItem`/`PluggyItemRep`.
- Nenhum código de `oplab-radar-front` ou `oplab-radar-api` — este change é só `pluggy-connector`.
