# Versão pinada, a mesma do `.nvmrc` e coberta pelo `engines` do package.json: a imagem, o CI e a
# máquina do dev compilam com o mesmo Node. Alpine porque nenhuma dependência deste serviço tem
# addon nativo — `mysql2` e `pluggy-sdk` são JavaScript puro.
ARG NODE_VERSION=24.18.1

FROM node:${NODE_VERSION}-alpine AS build

WORKDIR /application

# `package*.json` antes do resto do código: o `npm ci` só reexecuta quando o lockfile muda, não a
# cada alteração em `src/`.
COPY package*.json ./
RUN npm ci

COPY . .

# `tsconfig.build.json`, nunca o `tsconfig.json` da raiz: o da raiz inclui `tests` (é o alvo do
# `npm run type-check`) e emitiria `dist/tests` dentro da imagem de produção.
RUN npm run build

# Estágio de dev: mesma imagem do `build` (já tem devDependencies e o código montado depois via
# bind mount do docker-compose.dev.yml), sem toolchain nativo — diferente do estágio `dev` do
# oplab-radar-api, que instala git/ssh/build-base/python3/libcap: nenhuma dependência deste
# serviço (`mysql2`, `pluggy-sdk`) precisa compilar nada. `tasks/dev.mjs` builda e reinicia o
# processo em mudança de arquivo, e liga o inspector quando `DEBUG=1`.
FROM build AS dev

CMD ["node", "tasks/dev.mjs"]

# Estágio final: é o que o Docker constrói sem `--target` e o que o Railway publica.
FROM node:${NODE_VERSION}-alpine AS runtime

WORKDIR /application

COPY package*.json ./
# `apk upgrade` durante o build, não no start: incorpora correção de CVE do Alpine sem depender de
# a imagem base upstream ser republicada.
# `--ignore-scripts` porque o único lifecycle deste package.json é `prepare: husky`, e o husky é
# devDependency: com `--omit=dev` ele não existe e o script falharia com `husky: not found`. Não há
# dependência que precise de script de instalação aqui.
# npm/npx/node_modules/npm são removidos ao final: as CVEs são do npm interno (tar, ip-address,
# undici bundlados por ele), não das dependências do projeto — e nada no runtime precisa de npm,
# porque tanto o CMD quanto o Pre-Deploy Command do Railway invocam `node` direto.
RUN apk upgrade --no-cache && \
    npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build /application/dist ./dist

# O Pre-Deploy Command do Railway roda nesta mesma imagem, em container separado do app: a CLI, o
# `.sequelizerc` e a config precisam existir no runtime, senão a migration não tem o que aplicar.
# Por isso o `sequelize-cli` está em `dependencies`, e não em `devDependencies`.
# Nenhum segredo entra na imagem: host, usuário e senha do banco vêm da env var `DATABASES`.
# O `aiven-ca.pem` é o certificado público da CA do Aiven (nenhuma chave privada) — é o que permite
# `rejectUnauthorized` de verdade no TLS de produção, em vez de aceitar qualquer certificado.
COPY .sequelizerc sequelize.config.cjs aiven-ca.pem ./

# As migrations são `.cjs` e não passam pelo `tsc`, então não existem em `dist/`: vão cruas, no
# mesmo caminho que o `.sequelizerc` resolve a partir do WORKDIR.
COPY src/infra/db/migrations ./src/infra/db/migrations

# Nada aqui precisa de root: o processo só lê o que já está na imagem e abre socket de saída.
USER node

CMD ["node", "dist/index.js"]
