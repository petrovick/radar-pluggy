import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { testDatabaseConfig } from './test-database-config.js'

describe('testDatabaseConfig', () => {
  const originalEnv = process.env.MYSQL_DATABASE

  beforeEach(() => {
    delete process.env.MYSQL_DATABASE
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MYSQL_DATABASE = originalEnv
    } else {
      delete process.env.MYSQL_DATABASE
    }
  })

  it('usa oplab_radar_test por padrão se MYSQL_DATABASE não for definida', () => {
    const config = testDatabaseConfig()
    expect(config.database).toBe('oplab_radar_test')
  })

  it('recusa conexão se MYSQL_DATABASE for oplab_radar', () => {
    process.env.MYSQL_DATABASE = 'oplab_radar'
    expect(() => testDatabaseConfig()).toThrowError(/Conexão de teste recusada/)
  })

  it('recusa conexão se MYSQL_DATABASE não terminar com _test', () => {
    process.env.MYSQL_DATABASE = 'minha_base_prod'
    expect(() => testDatabaseConfig()).toThrowError(/Conexão de teste recusada/)
  })

  it('aceita base customizada terminada em _test', () => {
    process.env.MYSQL_DATABASE = 'ci_runner_db_test'
    const config = testDatabaseConfig()
    expect(config.database).toBe('ci_runner_db_test')
  })
})
