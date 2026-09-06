import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ApplicationError } from '../../shared/application-error.js'
import { CREDENTIAL_ENCRYPTION_KEY_LENGTH_BYTES } from '../../shared/pluggy-credential-cipher.js'

// Configuração do processo. Mora em `infra/config/`, mesmo agrupamento do `oplab-radar-api`
// (`config.ts` + `config.json`/`databases.json` reais, gitignored, + os moldes versionados
// `config.example.json`/`databases.example.json`) — decisão explícita do usuário: parar de manter `.env` de variáveis
// soltas e usar arquivo JSON, como o `oplab-radar-api` já faz.
//
// **Nada roda no import.** A validação só acontece dentro de `loadConfig()`, chamada de
// `src/index.ts`.
//
// Fonte por `NODE_ENV`, mesma regra do `oplab-radar-api`: ausente ou `development` lê
// `config.json`/`databases.json` (arquivos reais gitignored, criados a partir dos moldes
// `config.example.json`/`databases.example.json` no mesmo diretório); qualquer outro valor lê as env vars `CONFIG`/`DATABASES` (JSON),
// que é como o Railway injeta segredo.
//
// Nível de validação deliberadamente enxuto, no mesmo tom do `oplab-radar-api`
// (`infra/config/config.ts` de lá confia no JSON e só valida à parte o que já doeu de verdade —
// `PORT`, `LOG_FORMAT`): confia na forma do JSON, e só confere à parte o que este serviço não pode
// deixar passar batido — a mesma lista de `PENDENCIAS.md` (2.1-2.3), não uma exaustão de todo
// campo possível.

export type DatabaseConnectionConfig = {
  host: string
  port: number
  database: string
  username: string
  password: string
  /** Sempre presente; só a chave `ssl` interna varia (com TLS, sem TLS, ou nenhuma declarada). */
  dialectOptions: Record<string, unknown>
}

export type Config = {
  port: number
  jwtSecret: string
  webhookUrl: string
  /** Base64 de 32 bytes, já validado. Registrado no container (`register.ts`) e passado por
   * parâmetro a `encryptSecret`/`decryptSecret` no ponto de uso — nunca lido de `process.env` ali. */
  credentialEncryptionKey: string
  database: DatabaseConnectionConfig
}

const MIN_PORT = 1
const MAX_PORT = 65535

// Certificado da CA do Aiven — público, sem chave privada. O Dockerfile copia `aiven-ca.pem` pra
// raiz do WORKDIR, por isso resolve por `process.cwd()` (mesma convenção do `.sequelizerc`).
const AIVEN_CA_PATH = resolve(process.cwd(), 'aiven-ca.pem')

// Em desenvolvimento, `config.json` e `databases.json` são lidos exclusivamente de
// `src/infra/config/` (resolvidos por process.cwd() ou CONFIG_DIR), sem nunca passar por dist/.
// Em produção, o processo lê exclusivamente das variáveis de ambiente CONFIG e DATABASES.
const CONFIG_DIR = process.env.CONFIG_DIR || resolve(process.cwd(), 'src/infra/config')
const CONFIG_JSON_PATH = resolve(CONFIG_DIR, 'config.json')
const DATABASES_JSON_PATH = resolve(CONFIG_DIR, 'databases.json')

type RawSource = { config: unknown; databases: unknown }

function readJsonSource(env: NodeJS.ProcessEnv): RawSource {
  const nodeEnv = env.NODE_ENV
  if (nodeEnv === undefined || nodeEnv === 'development') {
    return {
      config: JSON.parse(readFileSync(CONFIG_JSON_PATH, 'utf8')) as unknown,
      databases: JSON.parse(readFileSync(DATABASES_JSON_PATH, 'utf8')) as unknown,
    }
  }

  if (!env.CONFIG || !env.DATABASES) {
    throw new ApplicationError('PLUGGY_CONNECTOR_CONFIG_INVALID', {
      reason: 'CONFIG and DATABASES env vars are required outside development',
    })
  }
  return { config: JSON.parse(env.CONFIG) as unknown, databases: JSON.parse(env.DATABASES) as unknown }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const source = readJsonSource(env)
  const config = source.config as {
    http?: { port?: number; jwtSecret?: string }
    pluggy?: { webhookUrl?: string; credentialEncryptionKey?: string }
  }
  const { main } = source.databases as { main?: Record<string, unknown> }

  const port = readPort(env, config.http?.port)

  const jwtSecret = config.http?.jwtSecret
  if (!jwtSecret) {
    throw new ApplicationError('PLUGGY_CONNECTOR_CONFIG_INVALID', { reason: 'CONFIG.http.jwtSecret is required' })
  }
  assertNoPlaceholder(jwtSecret, 'http.jwtSecret', env)

  const webhookUrl = config.pluggy?.webhookUrl
  if (!webhookUrl || !webhookUrl.startsWith('https://')) {
    throw new ApplicationError('PLUGGY_CONNECTOR_CONFIG_INVALID', {
      reason: 'CONFIG.pluggy.webhookUrl is required and must be an https:// URL',
    })
  }
  assertNoPlaceholder(webhookUrl, 'pluggy.webhookUrl', env)

  // Fonte preferida continua sendo a env var própria (segredo rotável sem precisar editar JSON,
  // mesmo precedente do `oplab-radar-api`); `CONFIG.pluggy.credentialEncryptionKey` é o fallback
  // pro fluxo de dev em arquivo — decisão explícita do usuário: em desenvolvimento, config mora em
  // `config.json`, não em variável de ambiente exportada à mão. O valor resolvido e validado entra
  // no `Config` devolvido (como `jwtSecret`/`webhookUrl`) e é registrado no container por
  // `register.ts` — `pluggy-credential-cipher.ts` recebe por parâmetro no ponto de uso, nunca lê
  // `process.env` sozinho.
  const credentialEncryptionKey = resolveCredentialEncryptionKey(env, config.pluggy?.credentialEncryptionKey)
  assertNoPlaceholder(credentialEncryptionKey, 'pluggy.credentialEncryptionKey', env)

  if (main === undefined) {
    throw new ApplicationError('PLUGGY_CONNECTOR_CONFIG_INVALID', { reason: 'databases main connection is required' })
  }

  return { port, jwtSecret, webhookUrl, credentialEncryptionKey, database: readDatabase(main, env) }
}

function readPort(env: NodeJS.ProcessEnv, configuredPort: number | undefined): number {
  const suppliedPort = env.PORT
  // Docker Compose exporta string vazia quando uma env var opcional está ausente (mesma ressalva
  // do `oplab-radar-api` pra `OPLAB_EMAIL`/`PLUGGY_CLIENT_ID`) — vazio não é "a plataforma
  // injetou", então cai pro configurado.
  return parsePort(suppliedPort ? suppliedPort : configuredPort, 'PORT must be an integer between 1 and 65535')
}

function parsePort(value: unknown, reason: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new ApplicationError('PLUGGY_CONNECTOR_CONFIG_INVALID', { reason })
  }
  return port
}

// `Buffer.from(x, 'base64')` decodifica em modo permissivo: ignora caractere fora do alfabeto em
// vez de recusar, então uma chave corrompida (ex.: caractere extra colado por engano) pode
// decodificar pros mesmos 32 bytes da chave original e passar batido só checando o tamanho — por
// isso o formato entra primeiro.
const STRICT_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function resolveCredentialEncryptionKey(env: NodeJS.ProcessEnv, configuredKey: string | undefined): string {
  const encoded = env.PLUGGY_CREDENTIAL_ENCRYPTION_KEY || configuredKey
  if (!encoded) {
    throw new ApplicationError('PLUGGY_CONNECTOR_CONFIG_INVALID', {
      reason: 'PLUGGY_CREDENTIAL_ENCRYPTION_KEY is required',
    })
  }
  if (
    !STRICT_BASE64_PATTERN.test(encoded) ||
    Buffer.from(encoded, 'base64').length !== CREDENTIAL_ENCRYPTION_KEY_LENGTH_BYTES
  ) {
    throw new ApplicationError('PLUGGY_CONNECTOR_CONFIG_INVALID', {
      reason: 'PLUGGY_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    })
  }

  return encoded
}

function assertNoPlaceholder(value: string | undefined, fieldName: string, env: NodeJS.ProcessEnv): void {
  if (!value) return
  if (value.includes('INFORME_AQUI_')) {
    throw new ApplicationError('PLUGGY_CONNECTOR_CONFIG_INVALID', {
      reason: `Field "${fieldName}" contains placeholder "${value}" and must be configured with a real value.`,
    })
  }
  if (env.NODE_ENV !== undefined && env.NODE_ENV !== 'development') {
    if (value === 'dev-jwt-secret-somente-para-ambiente-local' || value.includes('example.com')) {
      throw new ApplicationError('PLUGGY_CONNECTOR_CONFIG_INVALID', {
        reason: `Field "${fieldName}" contains a default local/example value not allowed outside development.`,
      })
    }
  }
}

// Host efetivo é o da réplica de escrita quando `databases.json`/`DATABASES` declara replicação,
// senão o host direto — mesma resolução do `sequelize.config.cjs` do `oplab-radar-api`
// (`main.replication?.write?.host ?? main.host`).
function readDatabase(main: Record<string, unknown>, env: NodeJS.ProcessEnv): DatabaseConnectionConfig {
  const replication = main.replication as { write?: { host?: string } } | undefined
  const host = replication?.write?.host || (main.host as string | undefined)
  const database = main.database as string | undefined
  const username = main.username as string | undefined
  const password = main.password as string | undefined

  if (!host || !main.port || !database || !username || !password) {
    throw new ApplicationError('PLUGGY_CONNECTOR_CONFIG_INVALID', {
      reason: 'databases main connection is missing host, port, database, username or password',
    })
  }
  assertNoPlaceholder(host, 'databases.main.host', env)
  assertNoPlaceholder(database, 'databases.main.database', env)
  assertNoPlaceholder(username, 'databases.main.username', env)
  assertNoPlaceholder(password, 'databases.main.password', env)

  const port = parsePort(main.port, 'databases main connection port must be an integer between 1 and 65535')

  return { host, port, database, username, password, dialectOptions: readDialectOptions(main) }
}

// TLS com a CA do Aiven por padrão. Recua só quando a própria fonte manda `ssl: false` — a saída
// que o MySQL sintético de CI usaria, produção nunca declara.
function readDialectOptions(main: Record<string, unknown>): Record<string, unknown> {
  const { ssl, ...rest } = (main.dialectOptions as Record<string, unknown> | undefined) ?? {}

  if (ssl === false) {
    return rest
  }
  if (ssl) {
    return { ssl, ...rest }
  }
  return { ssl: { ca: readFileSync(AIVEN_CA_PATH, 'utf8'), rejectUnauthorized: true }, ...rest }
}
