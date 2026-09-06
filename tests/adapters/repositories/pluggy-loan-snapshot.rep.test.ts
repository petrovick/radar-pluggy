import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { definePluggyLoanSnapshotModel } from '../../../src/infra/db/models/pluggy-loan-snapshot-model.js'
import { PluggyLoanSnapshotRep } from '../../../src/adapters/repositories/pluggy-loan-snapshot.rep.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'

describe('PluggyLoanSnapshotRep', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyLoanSnapshotModel(sequelize)
  const repository = new PluggyLoanSnapshotRep({
    db: { models: { pluggyLoanSnapshot: model } },
    getTransaction: () => null,
  } as unknown as AppContainer)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('pluggy_connector_loan_snapshots')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const migration = require('../../../src/infra/db/migrations/20260905100100-criar-pluggy-connector-loan-snapshots.cjs') as {
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

  function baseInput(itemId: string, loanId: string, syncedAt = new Date('2026-09-05T10:00:00.000Z')) {
    return {
      itemId,
      loanId,
      currencyCode: 'BRL',
      outstandingBalance: new Decimal('8000.00'),
      totalInstallments: 24,
      paidInstallments: 5,
      dueInstallments: 19,
      pastDueInstallments: 0,
      syncedAt,
    }
  }

  it('primeira sincronização cria snapshot', async () => {
    const itemId = randomUUID()
    const loanId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const saved = await repository.save(baseInput(itemId, loanId))
    expect(saved.getOutstandingBalance()).toEqual(new Decimal('8000.00'))

    const rows = await model.findAll({ where: { item_id: itemId, loan_id: loanId } })
    expect(rows).toHaveLength(1)
  })

  it('segunda sincronização com o mesmo synced_at atualiza sem duplicar', async () => {
    const itemId = randomUUID()
    const loanId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save(baseInput(itemId, loanId))
    await repository.save({ ...baseInput(itemId, loanId), outstandingBalance: new Decimal('7500.00') })

    const rows = await model.findAll({ where: { item_id: itemId, loan_id: loanId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.get('outstanding_balance')).toBe('7500.00')
  })

  it('synced_at diferente cria linha nova sem apagar a anterior — histórico da evolução do saldo', async () => {
    const itemId = randomUUID()
    const loanId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const syncedAt1 = new Date('2026-09-01T10:00:00.000Z')
    const syncedAt2 = new Date('2026-09-05T10:00:00.000Z')

    await repository.save(baseInput(itemId, loanId, syncedAt1))
    await repository.save({
      ...baseInput(itemId, loanId, syncedAt2),
      outstandingBalance: new Decimal('7000.00'),
    })

    const rows = await model.findAll({ where: { item_id: itemId, loan_id: loanId } })
    expect(rows).toHaveLength(2)
  })
})
