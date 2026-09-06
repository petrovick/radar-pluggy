import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { definePluggyInvestmentTransactionModel } from '../../../src/infra/db/models/pluggy-investment-transaction-model.js'
import { PluggyInvestmentTransactionRep } from '../../../src/adapters/repositories/pluggy-investment-transaction.rep.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

describe('PluggyInvestmentTransactionRep', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyInvestmentTransactionModel(sequelize)
  const repository = new PluggyInvestmentTransactionRep({
    db: { models: { pluggyInvestmentTransaction: model } },
    getTransaction: () => null,
  } as unknown as AppContainer)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('pluggy_connector_investment_transactions')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const migration = require('../../../src/infra/db/migrations/20260903140000-criar-pluggy-connector-investment-transactions.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      try {
        await migration.up(queryInterface, Sequelize)
      } catch {
        // Ignora corrida paralela de criação de tabela
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

  function baseInput(itemId: string, investmentId: string, transactionId: string) {
    return {
      itemId,
      investmentId,
      transactionId,
      type: 'BUY',
      movementType: 'CREDIT',
      quantity: new Decimal('6.12345678'),
      value: new Decimal('34.87654321'),
      amount: new Decimal('213.56'),
      netAmount: new Decimal('213.56'),
      priceFactor: new Decimal('1.00000000'),
      indexerPercentage: new Decimal('100.00000000'),
      agreedRate: new Decimal('0.15000000'),
      date: new Date('2026-06-23T00:00:00.000Z'),
      tradeDate: new Date('2026-06-23T00:00:00.000Z'),
      description: 'Compra de Ações',
      brokerageNumber: '123456789012345678900000000',
      brokerageFee: new Decimal('2.50'),
      stockExchangeFee: new Decimal('0.70'),
    }
  }

  it('salva movimentação e recupera com precisão de 8 casas decimais', async () => {
    const itemId = randomUUID()
    const invId = randomUUID()
    const txId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const saved = await repository.save(baseInput(itemId, invId, txId))
    expect(saved.getQuantity()).toEqual(new Decimal('6.12345678'))
    expect(saved.getValue()).toEqual(new Decimal('34.87654321'))
    expect(saved.getBrokerageFee()).toEqual(new Decimal('2.50'))

    const list = await repository.findByInvestmentId(invId)
    expect(list).toHaveLength(1)
    expect(list[0]?.getTransactionId()).toBe(txId)
    expect(list[0]?.getQuantity()).toEqual(new Decimal('6.12345678'))
    expect(list[0]?.getValue()).toEqual(new Decimal('34.87654321'))
    expect(list[0]?.getBrokerageFee()).toEqual(new Decimal('2.50'))
  })

  it('upsert: salva a mesma movimentação atualizando dados sem duplicar', async () => {
    const itemId = randomUUID()
    const invId = randomUUID()
    const txId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save(baseInput(itemId, invId, txId))
    await repository.save({
      ...baseInput(itemId, invId, txId),
      description: 'Compra de Ações Confirmada',
      brokerageFee: new Decimal('3.00'),
    })

    const list = await repository.findByInvestmentId(invId)
    expect(list).toHaveLength(1)
    expect(list[0]?.getDescription()).toBe('Compra de Ações Confirmada')
    expect(list[0]?.getBrokerageFee()).toEqual(new Decimal('3.00'))
  })

  it('recusa gravação sem campo obrigatório', async () => {
    await expect(
      repository.save({ ...baseInput('item-x', 'inv-x', ''), transactionId: '' }),
    ).rejects.toBeInstanceOf(ApplicationError)
  })
})
