## Why

O `pluggy-connector` não tem `docker-compose` nem estágio `dev` no `Dockerfile` — o próprio `Dockerfile` documenta essa decisão ("desenvolvimento roda direto no host"). Isso diverge do `oplab-radar-api`, que sobe via `make debug`/`make watch` com watch de arquivo e inspector do Node dentro de container, ligado à mesma rede/MySQL compartilhado de dev. Sem esse padrão aqui, depurar o `pluggy-connector` em paridade com produção (mesma imagem, mesmo Node, mesmo MySQL/schema compartilhado que a API já usa) exige rodar fora de container, com ambiente divergente do que o Railway publica.

## What Changes

- `Dockerfile` ganha um terceiro estágio `dev` (entre `build` e `runtime`), enxuto — sem o toolchain nativo que o `oplab-radar-api` instala (`git`/`ssh`/`build-base`/`python3`/`libcap`), já que este serviço não tem dependência nativa (`mysql2` e `pluggy-sdk` são JS puro). O estágio `runtime` de produção não muda.
- Novo `tasks/dev.mjs`: supervisor de dev que builda, sobe `dist/index.js`, reinicia em mudança de `src/**/*.ts` (`WATCH_FILES=1`) e liga `--inspect=0.0.0.0:9251` (`DEBUG=1`). Sem role args (`--httpServer`/`--sqsPoller`) — decidido explicitamente: este processo só tem um papel.
- Novo `docker-compose.yml`: serviço `pluggy-connector` (target `runtime`), na rede externa `shared-services`, mesmo host/schema `mysql`/`oplab_radar` que o `oplab-radar-api` já usa em dev (MySQL compartilhado, não isolado).
- Novo `docker-compose.dev.yml`: override com `target: dev`, bind mount do código, env `WATCH_FILES`/`DEBUG`, porta do inspector publicada.
- Novo `Makefile` na raiz, com os mesmos targets do `oplab-radar-api` (`build up down debug start stop restart logs ps login setup watch lanche-feliz`). `setup` adaptado: este repo não tem `npm run setup`/`tasks/setup.mjs` como a API — agora tem (novo `tasks/setup.mjs` + script `"setup"` em `package.json`), que garante `config.json`/`databases.json` a partir dos `.example.json` e roda a migration local contra o `mysql` compartilhado.
- `.dockerignore` deixa de excluir `config.json`/`databases.json` do contexto de build — decisão explícita do usuário: um único caminho de configuração local, sempre por arquivo (`NODE_ENV=development`), até pro `make up` (que antes exigia `CONFIG`/`DATABASES`/`PLUGGY_CREDENTIAL_ENCRYPTION_KEY` via `.env`, removido). Railway/CI não são afetados: os arquivos nunca existem no clone remoto.
- `src/infra/config/config.ts`: `PLUGGY_CREDENTIAL_ENCRYPTION_KEY` ganha uma segunda fonte — `CONFIG.pluggy.credentialEncryptionKey` — usada só quando a env var está ausente; quando usada, o valor é replicado pra `process.env` (é onde `pluggy-credential-cipher.ts` lê, no ponto de uso). **Único item desta mudança que altera comportamento observável do processo** (todo o resto é ferramental de dev) — env var continua vencendo quando presente, então produção/Railway não muda.

Nenhuma outra mudança de comportamento do processo em produção: `railway.json`, o `CMD` do estágio `runtime` e o `start`/`migrate` do `package.json` continuam iguais.

## Capabilities

Mudança de ferramental de desenvolvimento (Docker/Makefile) — nenhum comportamento observável do serviço muda. `skip_specs: true` já declarado em `.openspec.yaml`.

### New Capabilities

(nenhuma)

### Modified Capabilities

(nenhuma)

## Impact

- `Dockerfile`: novo estágio `dev`.
- Novos arquivos: `docker-compose.yml`, `docker-compose.dev.yml`, `Makefile`, `tasks/dev.mjs`, `tasks/setup.mjs`.
- `.dockerignore`: `config.json`/`databases.json` deixam de ser excluídos do build local.
- `package.json`: novo script `"setup"`.
- `src/infra/config/config.ts`: fallback de `PLUGGY_CREDENTIAL_ENCRYPTION_KEY` pra `CONFIG.pluggy.credentialEncryptionKey` (testes novos em `tests/infra/config/config.test.ts`).
- `eslint.config.js`: override de globals de Node pra `tasks/**/*.mjs`.
- `src/infra/config/config.example.json`/`config.json` (local, gitignored): novo campo `pluggy.credentialEncryptionKey`. `databases.example.json`/`databases.json` (local): novos campos `port`/`dialectOptions.ssl:false` (faltavam, quebrava `loadConfig()`).
- Ambiente de dev do mantenedor: passa a depender da rede externa `shared-services` e do container `mysql` já usado pelo `oplab-radar-api` (nenhuma mudança nesses, só nova conexão).
- Portas host reservadas: `3003` (app) e `9253` (inspector) — API já usa `3002`/`9252` nessa mesma rede.
