import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { definePluggyHistoryCoverageModel } from '../../../src/infra/db/models/pluggy-history-coverage-model.js'
import { PluggyHistoryCoverageRep } from '../../../src/adapters/repositories/pluggy-history-coverage.rep.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'

describe('PluggyHistoryCoverageRep', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyHistoryCoverageModel(sequelize)
  const repository = new PluggyHistoryCoverageRep({
    db: { models: { pluggyHistoryCoverage: model } },
    getTransaction: () => null,
  } as unknown as AppContainer)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('pluggy_connector_history_coverage')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const migration = require('../../../src/infra/db/migrations/20260903150000-criar-pluggy-connector-history-coverage.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      try {
        await migration.up(queryInterface, Sequelize)
      } catch {
        // Ignora corrida
      }
    }
  })

  afterEach(async () => {
    const itemId = itemIdsToCleanup.pop()
    if (itemId !== undefined) {
      await model.destroy({ where: { item_id: itemId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('salva cobertura com transações e recupera por referência', async () => {
    const itemId = randomUUID()
    const referenceId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const saved = await repository.save({
      itemId,
      referenceType: 'ACCOUNT',
      referenceId,
      observedTransactionCount: 5,
      oldestObservedTransactionAt: new Date('2026-01-01T00:00:00.000Z'),
      newestObservedTransactionAt: new Date('2026-06-01T00:00:00.000Z'),
      sourceUpdatedAt: new Date('2026-06-01T12:00:00.000Z'),
      lastCompletedScanAt: new Date('2026-09-03T10:00:00.000Z'),
    })

    expect(saved.getObservedTransactionCount()).toBe(5)

    const found = await repository.findByReference(itemId, 'ACCOUNT', referenceId)
    expect(found).toBeDefined()
    expect(found?.getNewestObservedTransactionAt()).toEqual(new Date('2026-06-01T00:00:00.000Z'))
  })

  it('salva cobertura vazia sem inventar período coberto', async () => {
    const itemId = randomUUID()
    const referenceId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const saved = await repository.save({
      itemId,
      referenceType: 'INVESTMENT',
      referenceId,
      observedTransactionCount: 0,
      lastCompletedScanAt: new Date('2026-09-03T10:00:00.000Z'),
    })

    expect(saved.getObservedTransactionCount()).toBe(0)
    expect(saved.getOldestObservedTransactionAt()).toBeUndefined()

    const found = await repository.findByReference(itemId, 'INVESTMENT', referenceId)
    expect(found).toBeDefined()
    expect(found?.getObservedTransactionCount()).toBe(0)
    expect(found?.getOldestObservedTransactionAt()).toBeUndefined()
  })
})
