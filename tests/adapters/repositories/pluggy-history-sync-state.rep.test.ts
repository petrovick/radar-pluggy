import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { definePluggyHistorySyncStateModel } from '../../../src/infra/db/models/pluggy-history-sync-state-model.js'
import { PluggyHistorySyncStateRep } from '../../../src/adapters/repositories/pluggy-history-sync-state.rep.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'

describe('PluggyHistorySyncStateRep', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyHistorySyncStateModel(sequelize)
  const repository = new PluggyHistorySyncStateRep({
    db: { models: { pluggyHistorySyncState: model } },
    getTransaction: () => null,
  } as unknown as AppContainer)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('radar_pluggy_history_sync_states')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const migration = require('../../../src/infra/db/migrations/20260903160000-criar-pluggy-connector-history-sync-states.cjs') as {
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

  it('salva e recupera marca d’água exclusiva do histórico por itemId', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const date1 = new Date('2026-08-01T00:00:00.000Z')
    await repository.save({ itemId, lastCompletedItemUpdatedAt: date1 })

    const found = await repository.findByItemId(itemId)
    expect(found).toBeDefined()
    expect(found?.getLastCompletedItemUpdatedAt()).toEqual(date1)
  })

  it('upsert: atualiza a marca d’água para o mesmo itemId sem duplicar linha', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const date1 = new Date('2026-08-01T00:00:00.000Z')
    const date2 = new Date('2026-08-02T00:00:00.000Z')

    await repository.save({ itemId, lastCompletedItemUpdatedAt: date1 })
    await repository.save({ itemId, lastCompletedItemUpdatedAt: date2 })

    const found = await repository.findByItemId(itemId)
    expect(found?.getLastCompletedItemUpdatedAt()).toEqual(date2)
  })
})
