## Why

O `radar-pluggy` tem `Dockerfile` e `railway.json` publicados, mas nunca foi de fato implantado: não existe serviço no Railway apontando pra este repositório. Subir agora, decidiu-se, usa GHCR (GitHub Container Registry) como registry da imagem e o Railway só consome a imagem pronta — ao invés do padrão até então configurado (`railway.json` com `builder: DOCKERFILE`, que faria o próprio Railway buildar do source). Essa janela também expõe que o `railway.json` (Config as Code) está com desligamento anunciado para 2026-12-01 (hard cutoff) — como o serviço nunca chegou a usá-lo de verdade, faz sentido nascer direto no substituto (Infrastructure as Code, `.railway/railway.ts`) em vez de passar por um formato que será desligado em menos de três meses.

## What Changes

- Novo workflow do GitHub Actions: builda a imagem (`Dockerfile` existente, estágio `runtime`) a cada push em `main` e publica em `ghcr.io/petrovick/radar-pluggy` com tag mutável `:staging` mais uma tag imutável por commit (`:sha-<hash>`, pra rastreabilidade). Pacote público — Railway consome sem credencial de registry.
- Após o build+push, o mesmo workflow chama `railway redeploy --service radar-pluggy` (Railway CLI) usando um project token escopado ao ambiente `staging` (`RAILWAY_TOKEN` nos secrets do repositório), forçando o Railway a puxar a tag `:staging` de novo e pegar o digest novo.
- Novo ambiente `staging` no projeto Railway `oplab-radar` (existente, hoje só com `oplab-radar-api`/`oplab-radar-front` em `production`). Serviço `radar-pluggy` criado de forma declarativa em `.railway/railway.ts`: fonte = imagem GHCR (`:staging`), `healthcheck: /healthcheck`, `preDeploy` rodando a migration (`sequelize db:migrate --env staging`), variáveis `NODE_ENV`, `CONFIG`, `DATABASES`, `PLUGGY_CREDENTIAL_ENCRYPTION_KEY`.
- `sequelize.config.cjs` ganha um bloco `staging` (mesmo formato do `production`: lê `DATABASES` como JSON) — hoje só existem `development`/`production`, e `db:migrate --env staging` quebraria por chave inexistente.
- **BREAKING** (tooling, não runtime): `railway.json` é removido. Ele nunca chegou a configurar um serviço de verdade (nenhum serviço no Railway usava, source nunca foi conectada) e o formato está sendo desligado pelo Railway; a config real do serviço passa a viver em `.railway/railway.ts`.
- O job `docker` do CI atual (`.github/workflows/ci.yml`), que só builda a imagem como smoke test sem publicar, continua existindo sem alteração — propósito diferente do job novo de publish.

## Capabilities

Mudança de infraestrutura de deploy/CI — nenhum comportamento observável das capacidades de negócio do `pluggy-connector` (credenciais, sincronização de posição, histórico de transação, webhook) muda. O bloco `staging` do `sequelize.config.cjs` é plumbing de deploy (espelha o formato já existente de `production`), não uma regra nova. `skip_specs: true` já declarado em `.openspec.yaml`, mesmo precedente de `add-docker-dev-workflow`.

### New Capabilities

(nenhuma)

### Modified Capabilities

(nenhuma)

## Impact

- Novo: `.github/workflows/<nome-a-definir-em-design>.yml` — build, push pro GHCR, redeploy no Railway.
- Novo: `.railway/railway.ts` — definição declarativa do serviço `radar-pluggy` no ambiente `staging` do projeto `oplab-radar`.
- Removido: `railway.json`.
- Modificado: `sequelize.config.cjs` (bloco `staging`).
- Ambiente `staging` do projeto Railway `oplab-radar` **não é um ambiente novo**: é o `production` existente, renomeado — decisão do usuário. `oplab-radar-api`/`oplab-radar-front` passam a compartilhar ambiente com `radar-pluggy`, sem isolamento; `partial` protege os dois de reconciliação/remoção pelo `config apply`.
- `DATABASES` do `radar-pluggy` reaproveita o mesmo banco físico do `oplab-radar-api` (referência de variável Railway, não um banco novo provisionado).
- Dependências externas a este change, fora do alcance de código (pré-requisitos operacionais, não automatizáveis por PR):
  - `RAILWAY_TOKEN` (project token escopado ao ambiente `staging`) — já criado, como secret do **GitHub Environment** `staging` (não secret de repositório).
  - Após o primeiro push da imagem, marcar o pacote GHCR como público (nasce privado por padrão em repositório privado).
  - Segredos próprios do `radar-pluggy` (`CONFIG.http.jwtSecret`, `CONFIG.pluggy.webhookUrl`, `PLUGGY_CREDENTIAL_ENCRYPTION_KEY`) — sem equivalente a reaproveitar, precisam existir antes do serviço ficar saudável.
