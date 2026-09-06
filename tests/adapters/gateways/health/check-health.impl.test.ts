import { afterAll, describe, expect, it } from 'vitest'
import CheckHealthImpl from '../../../../src/adapters/gateways/health/check-health.impl.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'

// Requer MySQL alcançável — mesma infraestrutura dos testes de contrato.
describe('CheckHealthImpl', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())

  function buildImpl(connections: Record<string, unknown>): CheckHealthImpl {
    return new CheckHealthImpl({
      db: { connections, Sequelize: undefined, models: undefined },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: () => null,
      setTransaction: () => {},
    } as unknown as AppContainer)
  }

  afterAll(async () => {
    await sequelize.close()
  })

  it('não recusa quando a conexão principal responde', async () => {
    const impl = buildImpl({ main: sequelize })

    await expect(impl.checkDatabaseConnection()).resolves.toBeUndefined()
  })

  it('recusa quando a conexão principal não está registrada em db.connections', async () => {
    const impl = buildImpl({})

    await expect(impl.checkDatabaseConnection()).rejects.toThrow(/conexão "main" não registrada/)
  })
})
