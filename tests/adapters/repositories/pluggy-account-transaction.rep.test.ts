import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { definePluggyAccountTransactionModel } from '../../../src/infra/db/models/pluggy-account-transaction-model.js'
import { PluggyAccountTransactionRep } from '../../../src/adapters/repositories/pluggy-account-transaction.rep.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

describe('PluggyAccountTransactionRep', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyAccountTransactionModel(sequelize)
  const repository = new PluggyAccountTransactionRep({
    db: { models: { pluggyAccountTransaction: model } },
    getTransaction: () => null,
  } as unknown as AppContainer)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('radar_pluggy_account_transactions')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const migration = require('../../../src/infra/db/migrations/20260903130000-criar-pluggy-connector-account-transactions.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await migration.up(queryInterface, Sequelize)
    }
    const cols = await queryInterface.describeTable('radar_pluggy_account_transactions')
    if (!cols.credit_card_metadata) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const fullCaptureMigration = require('../../../src/infra/db/migrations/20260906180200-adicionar-credit-card-metadata-em-pluggy-connector-account-transactions.cjs') as {
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

  function baseInput(itemId: string, accountId: string, transactionId: string) {
    return {
      itemId,
      accountId,
      transactionId,
      description: 'Compra Apple',
      descriptionRaw: 'COMPRA APPLE SAO PAULO',
      currencyCode: 'BRL',
      amount: new Decimal('-18.24'),
      amountInAccountCurrency: new Decimal('-18.24'),
      balance: new Decimal('19981.76'),
      date: new Date('2026-09-03T04:22:50.758Z'),
      transactionType: 'DEBIT',
      status: 'POSTED',
      categoryId: '08000000',
      category: 'Shopping',
      operationType: 'PURCHASE',
      merchant: { name: 'Apple', cnpj: '623904' },
      paymentData: { payee: 'Apple Store' },
      sourceOrder: 0,
      providerCreatedAt: new Date('2026-09-03T04:40:13.580Z'),
      providerUpdatedAt: new Date('2026-09-03T04:40:13.580Z'),
    }
  }

  it('salva transação e recupera com precisão decimal exata e JSON parseado', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    const txId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const saved = await repository.save(baseInput(itemId, accountId, txId))
    expect(saved.getAmount()).toEqual(new Decimal('-18.24'))
    expect(saved.getBalance()).toEqual(new Decimal('19981.76'))
    expect(saved.getMerchant()).toEqual({ name: 'Apple', cnpj: '623904' })

    const list = await repository.findByAccountId(accountId)
    expect(list).toHaveLength(1)
    expect(list[0]?.getTransactionId()).toBe(txId)
    expect(list[0]?.getAmount()).toEqual(new Decimal('-18.24'))
    expect(list[0]?.getMerchant()).toEqual({ name: 'Apple', cnpj: '623904' })
  })

  it('upsert: salva a mesma transação atualizando atributos sem duplicar', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    const txId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save(baseInput(itemId, accountId, txId))
    await repository.save({
      ...baseInput(itemId, accountId, txId),
      description: 'Compra Apple Confirmada',
      status: 'SETTLED',
    })

    const list = await repository.findByAccountId(accountId)
    expect(list).toHaveLength(1)
    expect(list[0]?.getDescription()).toBe('Compra Apple Confirmada')
    expect(list[0]?.getStatus()).toBe('SETTLED')
  })

  it('recusa gravação sem campo obrigatório', async () => {
    await expect(
      repository.save({ ...baseInput('item-x', 'acc-x', ''), transactionId: '' }),
    ).rejects.toBeInstanceOf(ApplicationError)
  })

  // Change pluggy-complete-data-capture, spec pluggy-transaction-history: campo antes descartado.
  it('salva e recupera creditCardMetadata inteiro', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    const txId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save({
      ...baseInput(itemId, accountId, txId),
      creditCardMetadata: { installmentNumber: 1, totalInstallments: 3, billForecastDate: '2026-10' },
    })

    const list = await repository.findByAccountId(accountId)
    expect(list[0]?.getCreditCardMetadata()).toEqual({
      installmentNumber: 1,
      totalInstallments: 3,
      billForecastDate: '2026-10',
    })
  })

  it('transação sem creditCardMetadata grava e recupera com o campo indefinido', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    const txId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save(baseInput(itemId, accountId, txId))

    const list = await repository.findByAccountId(accountId)
    expect(list[0]?.getCreditCardMetadata()).toBeUndefined()
  })
})
