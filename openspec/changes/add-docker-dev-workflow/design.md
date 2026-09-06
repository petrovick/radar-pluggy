## Context

Ver proposal.md - Why. Pontos do estado atual moldam a abordagem, além do que já está lá:

- `config.ts` amarra a fonte ao `NODE_ENV`: ausente/`development` lê `config.json`/`databases.json` do disco; qualquer outro valor exige `CONFIG`/`DATABASES` (JSON) como env var. Decisão desta mudança: **todo fluxo local (`up`, `watch`, `debug`, `setup`) usa `NODE_ENV=development`** — um único caminho de configuração, sempre por arquivo, nunca por env var solta. `.dockerignore` deixou de excluir `config.json`/`databases.json` do contexto de build de propósito, exatamente pra isso: sem essa exclusão, o estágio `build` copia os dois (quando existem no disco do dev) e eles chegam ao `runtime` via `COPY --from=build .../dist`. Railway e o CI nunca têm esses arquivos (gitignored, não fazem parte do clone remoto), então essa mudança não afeta nenhum dos dois — só o build local.
- `PLUGGY_CREDENTIAL_ENCRYPTION_KEY` segue o mesmo caminho: `config.ts` agora aceita `CONFIG.pluggy.credentialEncryptionKey` como fallback quando a env var está ausente, e replica o valor pra `process.env` (é onde `pluggy-credential-cipher.ts` lê, no ponto de uso, sem depender do `Config` retornado por `loadConfig`). Produção continua podendo rotacionar só a env var, sem redeploy — nada nesse caminho muda.
- `sequelize.config.cjs` tem sua própria fonte para o `sequelize-cli`, independente do `config.ts`: o ambiente `development` lê `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_DATABASE`/`MYSQL_USER`/`MYSQL_PASSWORD` (default `127.0.0.1`/`3306`/`oplab_radar`/`root`/`12345678`), e o `production` exige `DATABASES`. Dentro de um container, `127.0.0.1` não resolve ao container do MySQL — precisa de `MYSQL_HOST=mysql` explícito. Isso só afeta `make setup` (roda `sequelize-cli` direto); o processo da aplicação em si não usa esse arquivo.
- `databases.example.json` aponta host `mysql`, banco `oplab_radar` — o mesmo host/schema que o `docker-compose.dev.yml` do `oplab-radar-api` já usa, montado na rede externa `shared-services` (esta rede já existe no ambiente do mantenedor; não é criada por nenhum compose deste workspace).

## Goals / Non-Goals

**Goals:**
- Um único caminho de configuração local, sempre por arquivo (`config.json`/`databases.json`), pra `up`, `watch`, `debug` e `setup` — decisão explícita do usuário: config mora em arquivo, não em variável de ambiente exportada à mão.
- `make watch`/`debug`/`login`/`setup` sobem um estágio `dev` com o código montado, watch de arquivo e `--inspect` opcional.
- Migração local roda contra o `mysql` compartilhado, no schema `oplab_radar` já existente — nunca cria banco novo.

**Non-Goals:**
- Não muda `railway.json`, o `CMD` do estágio `runtime`, nem qualquer script de `package.json`.
- Não sobe MySQL próprio neste repo (decidido: compartilhado).
- Não implementa role args (`--httpServer` etc.) em `index.ts` nem em `tasks/dev.mjs` (decidido: processo único, sem flag).
- Não cobre CI (`.github/workflows/ci.yml` já builda a imagem e roda testes contra MySQL efêmero próprio; fica como está).

## Decisions

- **`docker-compose.yml` (target `runtime`, usado por `up`/`start`/`restart`/`logs`/`ps`)**: `NODE_ENV=development`, sem nenhuma env var de segredo — `config.json`/`databases.json` já vêm dentro da imagem (`.dockerignore` não exclui mais os dois). Mesmo padrão que o `oplab-radar-api` já usa no próprio `docker-compose.yml`.
  - Alternativa descartada: `NODE_ENV` não-development + `CONFIG`/`DATABASES`/`PLUGGY_CREDENTIAL_ENCRYPTION_KEY` via `.env` (o desenho original desta mudança, chegou a ser implementado e testado). Revertido a pedido do usuário: config mora só em `config.json`, sem exceção pro `up`.
- **`docker-compose.dev.yml` (override `target: dev`, usado por `watch`/`debug`/`login`/`setup`)**: mesma coisa, mais bind mount `.:/application` + volume anônimo em `/application/node_modules` (mesma técnica da API, evita node_modules do host vazar pro container) e `WATCH_FILES`/`DEBUG` repassados do ambiente do host, default de `WATCH_FILES` é `1` (mesmo default da API).
- **Portas**: app fixo em `3003` dentro do container (é o `http.port` de `config.example.json`; nenhum motivo pra divergir do que o dev já usa fora de container) — host `3003:3003` (livre; API usa `3002`). Inspector: container `9251` (mesma convenção da API), host `9253:9251` (API já usa `9252` nessa rede).
- **Estágio `dev` do Dockerfile**: parte de `build`, sem `apk add` de toolchain nativo (sem `git`/`ssh`/`build-base`/`python3`/`libcap` — nenhuma dependência deste serviço precisa compilar nada). `CMD ["node", "tasks/dev.mjs"]`.
- **`tasks/dev.mjs`**: cópia simplificada do da API — build (`npm run build`) + `node dist/index.js` (sem role args), restart em mudança de `src/**/*.ts` via polling quando `WATCH_FILES=1`, `--inspect=0.0.0.0:9251` quando `DEBUG=1`. Sem os fluxos de SNS/SQS/EventBridge do `tasks/setup.mjs` da API — não existem aqui.
- **`make setup`**: roda dentro do estágio `dev` (bind mount): garante `config.json`/`databases.json` a partir dos `.example.json` só se ainda não existirem (nunca sobrescreve — mesmo cuidado do `ensureLocalConfig` da API), depois `MYSQL_HOST=mysql MYSQL_PORT=3306 MYSQL_DATABASE=oplab_radar MYSQL_USER=root MYSQL_PASSWORD=<a mesma de databases.example.json> npx sequelize-cli db:migrate` — sem `db:create`: o schema `oplab_radar` é compartilhado e já existe, criado pelo setup do `oplab-radar-api`.
- **Makefile**: mesmos targets e composição (`COMPOSE`/`DEV_COMPOSE`) do `oplab-radar-api`, renomeando o serviço, mais `lanche-feliz` (reset completo: build+setup+debug+logs, depois `rm -rf dist package-lock.json node_modules` ao sair — mesmo target da API, com `$(DEV_COMPOSE)` no lugar de `$(COMPOSE)` na limpeza final, porque só o bind mount do estágio `dev` faz o `rm -rf` alcançar o host).
- Sem `.env`/`.env.example`: única fonte de configuração local é `config.json`/`databases.json` (a partir de `config.example.json`/`databases.example.json`).

## Risks / Trade-offs

- [Risco] `lanche-feliz` apaga `package-lock.json`/`node_modules` do host de verdade (bind mount) — reversível (`npm install` reconstrói o lockfile a partir do `package.json` commitado), mas é destrutivo se rodado sem saber o que faz.
- [Risco] Schema compartilhado: uma migration deste repo aplicada por engano contra a tabela errada afeta o `oplab-radar-api` também. → Mitigação: já é uma restrição existente (mesmo banco físico, mesmo ambiente de dev), não introduzida por esta mudança; `modelagem-de-dados` já define quais tabelas este serviço pode tocar.
- [Risco] `docker-compose.yml` depender da rede externa `shared-services` quebra `make up` numa máquina onde essa rede/`mysql` não existe. → Mitigação: mesmo pré-requisito que o `oplab-radar-api` já impõe ao seu próprio dev; documentar no `README.md` que o mantenedor precisa ter esse ambiente de pé primeiro (mesma dependência, não nova).

## Migration Plan

Mudança aditiva: novos arquivos (`docker-compose.yml`, `docker-compose.dev.yml`, `Makefile`, `tasks/dev.mjs`, `.env.example`) e um novo estágio no `Dockerfile` que ninguém referencia hoje (`docker build` sem `--target` continua parando em `runtime`, igual antes). Nenhum arquivo existente muda de comportamento. Rollback é reverter os arquivos novos e a adição do estágio `dev`.
