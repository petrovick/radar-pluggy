import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/infra/config/config.js'
import { validConfigEnv } from './support/test-config-env.js'

const require = createRequire(import.meta.url)

function configFromCjs(env: 'staging' | 'production'): Record<string, unknown> {
  const modulePath = require.resolve('../sequelize.config.cjs')
  delete require.cache[modulePath]
  return require(modulePath)[env] as Record<string, unknown>
}

// Prova que a leitura de `DATABASES` em `sequelize.config.cjs` (consumida pelo `sequelize-cli`,
// que não importa módulo TS) concorda com `infra/config/config.ts` (consumida pelo processo) para
// a mesma variável — as duas leem o mesmo formato, cada uma na sua linguagem. `staging` e
// `production` são o mesmo getter (mesmo `DATABASES`), então toda asserção de paridade vale pros
// dois ambientes Railway.
describe('sequelize.config.cjs', () => {
  const originalDatabases = process.env.DATABASES

  afterEach(() => {
    if (originalDatabases === undefined) {
      delete process.env.DATABASES
    } else {
      process.env.DATABASES = originalDatabases
    }
  })

  function expectParity(databases: Record<string, unknown>): void {
    const raw = JSON.stringify({ main: databases })
    process.env.DATABASES = raw

    const fromConfig = loadConfig({ ...validConfigEnv(), DATABASES: raw }).database
    const expected = {
      dialect: 'mysql',
      host: fromConfig.host,
      port: fromConfig.port,
      database: fromConfig.database,
      username: fromConfig.username,
      password: fromConfig.password,
      dialectOptions: fromConfig.dialectOptions,
    }

    expect(configFromCjs('production')).toEqual(expected)
    expect(configFromCjs('staging')).toEqual(expected)
  }

  it('concorda quando dialectOptions.ssl: false recua a TLS', () => {
    expectParity({
      host: 'host-direto.example',
      port: 3306,
      database: 'db',
      username: 'u',
      password: 'p',
      dialectOptions: { ssl: false },
    })
  })

  it('concorda quando TLS entra por padrão, com a mesma CA do Aiven lida do disco', () => {
    expectParity({ host: 'host-direto.example', port: 3306, database: 'db', username: 'u', password: 'p' })
  })

  it('concorda quando replication.write.host está declarado — as duas usam a réplica de escrita', () => {
    expectParity({
      host: 'host-direto.example',
      port: 3306,
      database: 'db',
      username: 'u',
      password: 'p',
      replication: { write: { host: 'host-replica-escrita.example' } },
    })
  })

  it('concorda quando replication.write.host é string vazia — as duas recaem pro host direto', () => {
    expectParity({
      host: 'host-direto.example',
      port: 3306,
      database: 'db',
      username: 'u',
      password: 'p',
      replication: { write: { host: '' } },
    })
  })

  it('concorda quando dialectOptions.ssl é null — as duas entram com a CA do Aiven por padrão', () => {
    expectParity({
      host: 'host-direto.example',
      port: 3306,
      database: 'db',
      username: 'u',
      password: 'p',
      dialectOptions: { ssl: null },
    })
  })

  it('DATABASES ausente recusa ao ler staging ou production, nunca ao ler development', () => {
    delete process.env.DATABASES
    const modulePath = require.resolve('../sequelize.config.cjs')
    delete require.cache[modulePath]
    const cjs = require(modulePath) as Record<string, unknown>

    expect(() => cjs.staging).toThrow('DATABASES env var is required to run migrations in staging')
    expect(() => cjs.production).toThrow('DATABASES env var is required to run migrations in production')
    expect(cjs.development).toBeDefined()
  })
})
