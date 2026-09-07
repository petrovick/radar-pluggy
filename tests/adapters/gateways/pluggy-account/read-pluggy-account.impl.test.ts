import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import ReadPluggyAccountImpl from '../../../../src/adapters/gateways/pluggy-account/read-pluggy-account.impl.js'
import { PluggyAccountRep } from '../../../../src/adapters/repositories/pluggy-account.rep.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'
import { definePluggyAccountModel } from '../../../../src/infra/db/models/pluggy-account-model.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'

describe('ReadPluggyAccountImpl.readAccountsByItemIds', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyAccountModel(sequelize)

  const container = {
    db: { models: { pluggyAccount: model } },
    getTransaction: () => null,
    logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as AppContainer
  const mutable = container as unknown as Record<string, unknown>
  mutable.pluggyAccountRep = new PluggyAccountRep(container)
  mutable.pluggyPersonItemResolver = { itemIdsFor: async () => [] }

  const impl = new ReadPluggyAccountImpl(container)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const { Sequelize } = await import('sequelize')
    type Migration = { up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void> }

    const tables = await queryInterface.showAllTables()
    if (!tables.includes('radar_pluggy_accounts')) {
      const migration = require('../../../../src/infra/db/migrations/20260903120000-criar-pluggy-connector-accounts.cjs') as Migration
      await migration.up(queryInterface, Sequelize)
    }
    const cols = await queryInterface.describeTable('radar_pluggy_accounts')
    if (!cols.level) {
      const creditMigration = require('../../../../src/infra/db/migrations/20260905120000-adicionar-dados-de-credito-em-pluggy-connector-accounts.cjs') as Migration
      await creditMigration.up(queryInterface, Sequelize)
    }
    const colsAfterCredit = await queryInterface.describeTable('radar_pluggy_accounts')
    if (!colsAfterCredit.tax_number) {
      const fullCaptureMigration = require('../../../../src/infra/db/migrations/20260906180100-adicionar-campos-completos-em-pluggy-connector-accounts.cjs') as Migration
      await fullCaptureMigration.up(queryInterface, Sequelize)
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

  function baseInput(itemId: string, accountId: string, type: string) {
    return {
      itemId,
      accountId,
      type,
      subtype: undefined,
      number: '12345-6',
      name: 'Conta Exemplo',
      balance: new Decimal('100.00'),
      currencyCode: 'BRL',
      providerCreatedAt: new Date('2026-08-23T04:26:12.808Z'),
      providerUpdatedAt: new Date('2026-09-03T04:40:13.435Z'),
    }
  }

  it('cruza contas BANK e CREDIT de itens diferentes, no formato mínimo que o consumidor precisa', async () => {
    const itemA = randomUUID()
    const itemB = randomUUID()
    const accountBank = randomUUID()
    const accountCredit = randomUUID()

    try {
      const rep = new PluggyAccountRep(container)
      await rep.save(baseInput(itemA, accountBank, 'BANK'))
      await rep.save(baseInput(itemB, accountCredit, 'CREDIT'))

      const views = await impl.readAccountsByItemIds([itemA, itemB])

      expect(views).toHaveLength(2)
      const credit = views.find((v) => v.accountId === accountCredit)
      expect(credit).toMatchObject({ type: 'CREDIT', subtype: null, name: 'Conta Exemplo' })
    } finally {
      await model.destroy({ where: { item_id: [itemA, itemB] } })
    }
  })
})
