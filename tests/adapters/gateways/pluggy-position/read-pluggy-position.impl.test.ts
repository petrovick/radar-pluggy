import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import ReadPluggyPositionImpl from '../../../../src/adapters/gateways/pluggy-position/read-pluggy-position.impl.js'
import { PluggyPositionRep } from '../../../../src/adapters/repositories/pluggy-position.rep.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'
import { definePluggyPositionModel } from '../../../../src/infra/db/models/pluggy-position-model.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'

// Prova a tradução entidade → DTO HTTP: escala decimal fixa (não `Decimal.toString()`, que
// suprimiria zero à direita) e campo ausente vira `null`, nunca `undefined` (a resposta é JSON).
// A resolução pessoa→item já tem cobertura própria (`pluggy-person-item.resolver.test.ts`); aqui o
// resolver é um fake só devolvendo os itemIds fixos que o teste seeda.
describe('ReadPluggyPositionImpl.readPositionsByItemIds', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyPositionModel(sequelize)

  const container = {
    db: { models: { pluggyPosition: model } },
    getTransaction: () => null,
    logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as AppContainer
  const mutable = container as unknown as Record<string, unknown>
  mutable.pluggyPositionRep = new PluggyPositionRep(container)
  mutable.pluggyPersonItemResolver = { itemIdsFor: async () => [] }

  const impl = new ReadPluggyPositionImpl(container)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('radar_pluggy_positions')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const createMigration = require('../../../../src/infra/db/migrations/20260901130000-criar-pluggy-positions.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await createMigration.up(queryInterface, Sequelize)
      await queryInterface.renameTable('pluggy_positions', 'radar_pluggy_positions')
    }
    const cols = await queryInterface.describeTable('radar_pluggy_positions')
    if (!cols.value) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const alterMigration = require('../../../../src/infra/db/migrations/20260903110000-alterar-pluggy-connector-positions-precisao.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await alterMigration.up(queryInterface, Sequelize)
    }
    const colsAfterFullCapture = await queryInterface.describeTable('radar_pluggy_positions')
    if (!colsAfterFullCapture.due_date) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const fullCaptureMigration = require('../../../../src/infra/db/migrations/20260906180000-adicionar-campos-completos-em-pluggy-connector-positions.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
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

  it('formata decimal com a escala da coluna e data em ISO, campo ausente vira null', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const rep = new PluggyPositionRep(container)
    await rep.save({
      investmentId,
      itemId,
      type: 'EQUITY',
      subtype: undefined,
      name: 'PETR4',
      code: undefined,
      isin: undefined,
      currencyCode: 'BRL',
      balance: new Decimal('1500.5'),
      quantity: new Decimal('10'),
      amountOriginal: undefined,
      status: undefined,
      institutionName: undefined,
      institutionNumber: undefined,
      quotaDate: new Date('2026-08-01T00:00:00.000Z'),
      issuerCnpj: undefined,
      number: undefined,
      amountWithdrawal: undefined,
      amountProfit: undefined,
      dueDate: undefined,
      issuer: undefined,
      issueDate: undefined,
      purchaseDate: new Date('2024-01-01T00:00:00.000Z'),
      rate: undefined,
      rateType: undefined,
      fixedAnnualRate: undefined,
      lastMonthRate: undefined,
      annualRate: undefined,
      lastTwelveMonthsRate: undefined,
      owner: undefined,
      metadata: undefined,
    })

    const [view] = await impl.readPositionsByItemIds([itemId])

    expect(view).toMatchObject({
      investmentId,
      type: 'EQUITY',
      subtype: null,
      balance: '1500.50',
      quantity: '10.00000000',
      value: null,
      dueDate: null,
      institutionName: null,
      purchaseDate: '2024-01-01T00:00:00.000Z',
    })
  })
})
