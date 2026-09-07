import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { definePluggyPositionSnapshotModel } from '../../../src/infra/db/models/pluggy-position-snapshot-model.js'
import { PluggyPositionSnapshotRep } from '../../../src/adapters/repositories/pluggy-position-snapshot.rep.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'

describe('PluggyPositionSnapshotRep', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyPositionSnapshotModel(sequelize)
  const repository = new PluggyPositionSnapshotRep({
    db: { models: { pluggyPositionSnapshot: model } },
    getTransaction: () => null,
  } as unknown as AppContainer)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('radar_pluggy_position_snapshots')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const migration = require('../../../src/infra/db/migrations/20260903110100-criar-pluggy-connector-position-snapshots.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await migration.up(queryInterface, Sequelize)
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

  function baseInput(itemId: string, investmentId: string, quotaDate = new Date('2026-08-01T00:00:00.000Z')) {
    return {
      itemId,
      investmentId,
      quotaDate,
      currencyCode: 'BRL',
      balance: new Decimal('1359.39'),
      quantity: new Decimal('3.12345678'),
      amountOriginal: new Decimal('1000.00'),
      value: new Decimal('34.12345678'),
      amount: new Decimal('102.37'),
      taxes: new Decimal('1.25'),
      taxes2: new Decimal('0.50'),
      syncedAt: new Date('2026-09-03T10:00:00.000Z'),
    }
  }

  it('primeira sincronização cria snapshot', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const saved = await repository.save(baseInput(itemId, investmentId))
    expect(saved.getBalance()).toEqual(new Decimal('1359.39'))
    expect(saved.getValue()).toEqual(new Decimal('34.12345678'))

    const rows = await model.findAll({ where: { item_id: itemId, investment_id: investmentId } })
    expect(rows).toHaveLength(1)
  })

  it('segunda sincronização da mesma quota_date atualiza sem duplicar', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save(baseInput(itemId, investmentId))
    await repository.save({
      ...baseInput(itemId, investmentId),
      balance: new Decimal('2000.50'),
    })

    const rows = await model.findAll({ where: { item_id: itemId, investment_id: investmentId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.get('balance')).toBe('2000.50')
  })

  it('quota_date diferente cria linha nova sem apagar a anterior', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const date1 = new Date('2026-08-01T00:00:00.000Z')
    const date2 = new Date('2026-08-02T00:00:00.000Z')

    await repository.save(baseInput(itemId, investmentId, date1))
    await repository.save({
      ...baseInput(itemId, investmentId, date2),
      balance: new Decimal('1400.00'),
    })

    const rows = await model.findAll({ where: { item_id: itemId, investment_id: investmentId } })
    expect(rows).toHaveLength(2)
  })
})
