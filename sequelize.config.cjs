const fs = require('node:fs')
const path = require('node:path')

// Mesmo banco físico `oplab_radar` do `oplab-radar-api` — mesmos nomes de env var de dev local
// (`MYSQL_*`) usados em `src/infra/config/config.ts`, pra não inventar uma segunda convenção pra
// mesma infraestrutura. Produção reusa a MESMA env var `DATABASES` (JSON) do `oplab-radar-api` —
// mesmo formato que `infra/config/config.ts` lê em TypeScript, no mesmo nível enxuto de
// validação: confia no JSON, só recusa o que não tem fallback nenhum (`DATABASES` ausente em
// produção).
const AIVEN_CA_PATH = path.resolve(__dirname, 'aiven-ca.pem')

function assertNoMigrationPlaceholder(cfg) {
  for (const [key, val] of Object.entries(cfg)) {
    if (typeof val === 'string' && val.includes('INFORME_AQUI_')) {
      throw new Error(
        `[MIGRATION CONFIG ERROR] Database configuration "${key}" contains placeholder "${val}". Configure real credentials before running migrations.`
      )
    }
  }
}

// Guarda compartilhada por `staging`/`production` (dois call sites reais, mesmo comportamento):
// nomeia o ambiente que pediu a migration na mensagem de erro, sem duplicar a checagem.
function requireDatabasesConfig(envName) {
  if (!process.env.DATABASES) {
    throw new Error(`DATABASES env var is required to run migrations in ${envName}`)
  }
  return fromDatabasesJson(process.env.DATABASES)
}

function fromDatabasesJson(raw) {
  const { main } = JSON.parse(raw)
  const { ssl, ...dialectOptionsRest } = main.dialectOptions ?? {}

  const cfg = {
    dialect: 'mysql',
    host: (main.replication && main.replication.write && main.replication.write.host) || main.host,
    port: Number(main.port),
    database: main.database,
    username: main.username,
    password: main.password,
    dialectOptions:
      ssl === false
        ? dialectOptionsRest
        : { ssl: ssl || { ca: fs.readFileSync(AIVEN_CA_PATH, 'utf8'), rejectUnauthorized: true }, ...dialectOptionsRest },
  }
  assertNoMigrationPlaceholder(cfg)
  return cfg
}

// Dev local: mesmo MySQL do `shared-services`, sem TLS. Default aqui é conveniência de
// desenvolvimento, não a conexão de produção (que nunca tem default).
function developmentConfig() {
  const cfg = {
    dialect: 'mysql',
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE || 'oplab_radar',
    username: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '12345678',
  }
  assertNoMigrationPlaceholder(cfg)
  return cfg
}

module.exports = {
  development: developmentConfig(),
  // Getter, não valor: só recusa quando o `sequelize-cli` de fato pede `--env staging`/`--env
  // production`, sem exigir `DATABASES` pra rodar `development` (nunca concorrem pela mesma env
  // var). `staging` é idêntico a `production` — mesmo formato de `DATABASES`, ambiente Railway
  // diferente é o que distingue os dois, não o código.
  get staging() {
    return requireDatabasesConfig('staging')
  },
  get production() {
    return requireDatabasesConfig('production')
  },
}
