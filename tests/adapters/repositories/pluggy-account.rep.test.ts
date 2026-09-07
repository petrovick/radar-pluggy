import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { definePluggyAccountModel } from '../../../src/infra/db/models/pluggy-account-model.js'
import { PluggyAccountRep } from '../../../src/adapters/repositories/pluggy-account.rep.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

describe('PluggyAccountRep', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyAccountModel(sequelize)
  const repository = new PluggyAccountRep({
    db: { models: { pluggyAccount: model } },
    getTransaction: () => null,
  } as unknown as AppContainer)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('radar_pluggy_accounts')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const migration = require('../../../src/infra/db/migrations/20260903120000-criar-pluggy-connector-accounts.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await migration.up(queryInterface, Sequelize)
    }
    // Banco limpo (CI do zero) só tem a tabela original: aplica a migration de crédito também,
    // mesmo padrão de `pluggy-position.rep.test.ts` para migration de criação + alteração posterior.
    const cols = await queryInterface.describeTable('radar_pluggy_accounts')
    if (!cols.level) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const creditMigration = require('../../../src/infra/db/migrations/20260905120000-adicionar-dados-de-credito-em-pluggy-connector-accounts.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await creditMigration.up(queryInterface, Sequelize)
    }
    const colsAfterCredit = await queryInterface.describeTable('radar_pluggy_accounts')
    if (!colsAfterCredit.tax_number) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const fullCaptureMigration = require('../../../src/infra/db/migrations/20260906180100-adicionar-campos-completos-em-pluggy-connector-accounts.cjs') as {
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

  function baseInput(itemId: string, accountId: string) {
    return {
      itemId,
      accountId,
      type: 'BANK',
      subtype: 'CHECKING_ACCOUNT',
      number: '12345-6',
      name: 'Banco Exemplo',
      balance: new Decimal('1500.50'),
      currencyCode: 'BRL',
      providerCreatedAt: new Date('2026-08-23T04:26:12.808Z'),
      providerUpdatedAt: new Date('2026-09-03T04:40:13.435Z'),
    }
  }

  it('salva conta e recupera com precisão decimal exata', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const saved = await repository.save(baseInput(itemId, accountId))
    expect(saved.getBalance()).toEqual(new Decimal('1500.50'))

    const found = await repository.findByAccountId(accountId)
    expect(found).toBeDefined()
    expect(found?.getBalance()).toEqual(new Decimal('1500.50'))
    expect(found?.getName()).toBe('Banco Exemplo')
  })

  it('upsert: segunda sincronização da mesma conta atualiza saldo sem duplicar linha', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save(baseInput(itemId, accountId))
    await repository.save({
      ...baseInput(itemId, accountId),
      balance: new Decimal('25000.50'),
    })

    const accounts = await repository.findByItemId(itemId)
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.getBalance()).toEqual(new Decimal('25000.50'))
  })

  it('conta ausente em redescoberta posterior permanece gravada no banco', async () => {
    const itemId = randomUUID()
    const account1 = randomUUID()
    const account2 = randomUUID()
    itemIdsToCleanup.push(itemId)

    // Primeira descoberta: 2 contas
    await repository.save(baseInput(itemId, account1))
    await repository.save(baseInput(itemId, account2))

    // Redescoberta só traz account1
    await repository.save({
      ...baseInput(itemId, account1),
      balance: new Decimal('100.00'),
    })

    const accounts = await repository.findByItemId(itemId)
    expect(accounts).toHaveLength(2)
    const acc2 = accounts.find((a) => a.getAccountId() === account2)
    expect(acc2).toBeDefined()
  })

  it('recusa gravação sem campo obrigatório antes de tocar o banco', async () => {
    await expect(
      repository.save({ ...baseInput('item-x', ''), accountId: '' }),
    ).rejects.toBeInstanceOf(ApplicationError)
  })

  it('salva e recupera conta CREDIT com dados de crédito completos, com precisão decimal exata', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save({
      ...baseInput(itemId, accountId),
      type: 'CREDIT',
      level: 'BLACK',
      brand: 'MASTERCARD',
      brandAdditionalInfo: 'Bandeira parceira',
      balanceCloseDate: new Date('2026-08-20T00:00:00.000Z'),
      balanceDueDate: new Date('2026-08-27T00:00:00.000Z'),
      availableCreditLimit: new Decimal('5000.00'),
      balanceForeignCurrency: new Decimal('0.00'),
      minimumPayment: new Decimal('150.50'),
      creditLimit: new Decimal('10000.00'),
      isLimitFlexible: true,
      status: 'ACTIVE',
      holderType: 'MAIN',
    })

    const found = await repository.findByAccountId(accountId)
    expect(found?.getLevel()).toBe('BLACK')
    expect(found?.getBrand()).toBe('MASTERCARD')
    expect(found?.getBrandAdditionalInfo()).toBe('Bandeira parceira')
    expect(found?.getBalanceCloseDate()).toEqual(new Date('2026-08-20T00:00:00.000Z'))
    expect(found?.getBalanceDueDate()).toEqual(new Date('2026-08-27T00:00:00.000Z'))
    expect(found?.getAvailableCreditLimit()).toEqual(new Decimal('5000.00'))
    expect(found?.getBalanceForeignCurrency()).toEqual(new Decimal('0.00'))
    expect(found?.getMinimumPayment()).toEqual(new Decimal('150.50'))
    expect(found?.getCreditLimit()).toEqual(new Decimal('10000.00'))
    expect(found?.getIsLimitFlexible()).toBe(true)
    expect(found?.getStatus()).toBe('ACTIVE')
    expect(found?.getHolderType()).toBe('MAIN')
  })

  it('conta BANK sem dados de crédito grava e recupera com os campos de crédito indefinidos', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save(baseInput(itemId, accountId))

    const found = await repository.findByAccountId(accountId)
    expect(found?.getLevel()).toBeUndefined()
    expect(found?.getBrand()).toBeUndefined()
    expect(found?.getAvailableCreditLimit()).toBeUndefined()
    expect(found?.getBalanceCloseDate()).toBeUndefined()
    expect(found?.getIsLimitFlexible()).toBeUndefined()
    expect(found?.getStatus()).toBeUndefined()
    expect(found?.getHolderType()).toBeUndefined()
  })

  // Change pluggy-complete-data-capture, spec pluggy-account: campos antes descartados no gateway.
  it('salva e recupera taxNumber, bankData e disaggregatedCreditLimits', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save({
      ...baseInput(itemId, accountId),
      taxNumber: '123.456.789-00',
      bankData: { closingBalance: 1000.5, hasReservedBalance: false },
      disaggregatedCreditLimits: [{ creditLineLimitType: 'LIMITE_CREDITO_TOTAL', usedAmount: 500 }],
    })

    const found = await repository.findByAccountId(accountId)
    expect(found?.getTaxNumber()).toBe('123.456.789-00')
    expect(found?.getBankData()).toEqual({ closingBalance: 1000.5, hasReservedBalance: false })
    expect(found?.getDisaggregatedCreditLimits()).toEqual([
      { creditLineLimitType: 'LIMITE_CREDITO_TOTAL', usedAmount: 500 },
    ])
  })

  it('conta sem taxNumber/bankData/disaggregatedCreditLimits grava e recupera com os três indefinidos', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save(baseInput(itemId, accountId))

    const found = await repository.findByAccountId(accountId)
    expect(found?.getTaxNumber()).toBeUndefined()
    expect(found?.getBankData()).toBeUndefined()
    expect(found?.getDisaggregatedCreditLimits()).toBeUndefined()
  })
})
