## 1. Dockerfile

- [x] 1.1 Adicionar estágio `dev` entre `build` e `runtime` (`FROM build AS dev`), sem toolchain nativo (nenhum `apk add`), com `CMD ["node", "tasks/dev.mjs"]`. Verificar com `docker build --target dev -t pluggy-connector:dev .` concluindo sem erro.
- [x] 1.2 Confirmar que `docker build .` (sem `--target`) continua parando em `runtime` e gerando a mesma imagem de hoje — verificar com `docker build -t pluggy-connector:ci .` (o mesmo comando do CI) passando.

## 2. Supervisor de dev

- [x] 2.1 Criar `tasks/dev.mjs`: builda (`npm run build`), sobe `node dist/index.js` (sem role args), reinicia por polling de `src/**/*.ts` quando `WATCH_FILES=1`, adiciona `--inspect=0.0.0.0:9251` quando `DEBUG=1`. Verificar rodando `WATCH_FILES=1 DEBUG=1 node tasks/dev.mjs` localmente (fora de container), confirmando log de start, e que uma alteração em `src/` reinicia o processo.

## 3. Docker Compose

- [x] 3.1 Criar `docker-compose.yml`: serviço `pluggy-connector`, build `target: runtime`, rede externa `shared-services`, `NODE_ENV=production-local`, `CONFIG`/`DATABASES`/`PLUGGY_CREDENTIAL_ENCRYPTION_KEY` via `${...}`, porta `3003:3003`. Verificar com `docker compose config` sem erro de interpolação.
- [x] 3.2 Criar `docker-compose.dev.yml`: override `target: dev`, bind mount `.:/application` + volume anônimo `/application/node_modules`, `NODE_ENV=development`, `WATCH_FILES`/`DEBUG` repassados (default `WATCH_FILES=1`), porta do inspector `9253:9251`. Verificar com `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` sem erro.
- [x] 3.3 Criar `.env.example` na raiz documentando `CONFIG`, `DATABASES` (formato JSON de uma linha, espelhando `config.example.json`/`databases.example.json`) e `PLUGGY_CREDENTIAL_ENCRYPTION_KEY`. Sem segredo real.

## 4. Makefile

- [x] 4.1 Criar `Makefile` na raiz com os targets `build up down debug start stop restart logs ps login setup watch`, mesma composição `COMPOSE`/`DEV_COMPOSE` do `oplab-radar-api`, apontando pro serviço `pluggy-connector`.
- [x] 4.2 Adaptar `setup`: dentro do estágio `dev`, garantir `config.json`/`databases.json` a partir dos `.example.json` só se ainda não existirem (nunca sobrescrever), depois `MYSQL_HOST=mysql MYSQL_PORT=3306 MYSQL_DATABASE=oplab_radar MYSQL_USER=root MYSQL_PASSWORD=<a de databases.example.json> npx sequelize-cli db:migrate` — sem `db:create`. Verificar rodando `make setup` com a rede `shared-services`/`mysql` já de pé e conferindo que as migrations deste serviço aparecem em `SequelizeMeta`.

## 5. Verificação de ponta a ponta

- [x] 5.1 `make up` sobe o container `runtime` (produção local) respondendo em `GET /healthcheck` na porta `3003`, usando `CONFIG`/`DATABASES` do `.env` — sem bind mount, sem `config.json` dentro do container (`docker exec ... ls src/infra/config` não deve mostrar `config.json`/`databases.json`).
- [x] 5.2 `make watch` sobe o estágio `dev` com bind mount, reiniciando o processo ao salvar um arquivo em `src/`.
- [x] 5.3 `make debug` sobe o mesmo estágio `dev` com o inspector ouvindo em `127.0.0.1:9253`, verificado conectando um debugger (`chrome://inspect` ou equivalente do editor) e batendo um breakpoint.
- [x] 5.4 `npm run lint`, `npm run type-check` e `npm test` continuam verdes sem alteração (nenhum código de aplicação muda nesta mudança).
