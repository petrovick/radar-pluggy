import { randomBytes, randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import ReadPluggyAccountStatementImpl from '../../../../src/adapters/gateways/pluggy-account-transaction/read-pluggy-account-statement.impl.js'
import { PluggyItemCredentialResolver } from '../../../../src/adapters/gateways/pluggy-item-credential.resolver.js'
import { PluggyClientGateway } from '../../../../src/adapters/gateways/pluggy-client.gateway.js'
import { PluggyAccountRep } from '../../../../src/adapters/repositories/pluggy-account.rep.js'
import { PluggyAccountTransactionRep } from '../../../../src/adapters/repositories/pluggy-account-transaction.rep.js'
import { PluggyCredentialRep } from '../../../../src/adapters/repositories/pluggy-credential.rep.js'
import { PluggyCredentialItemRep } from '../../../../src/adapters/repositories/pluggy-credential-item.rep.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'
import { definePluggyAccountModel } from '../../../../src/infra/db/models/pluggy-account-model.js'
import { definePluggyAccountTransactionModel } from '../../../../src/infra/db/models/pluggy-account-transaction-model.js'
import { definePluggyCredentialModel } from '../../../../src/infra/db/models/pluggy-credential-model.js'
import { definePluggyCredentialItemModel } from '../../../../src/infra/db/models/pluggy-credential-item-model.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'

describe('ReadPluggyAccountStatementImpl', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const accountModel = definePluggyAccountModel(sequelize)
  const transactionModel = definePluggyAccountTransactionModel(sequelize)
  const credentialModel = definePluggyCredentialModel(sequelize)
  const credentialItemModel = definePluggyCredentialItemModel(sequelize)

  const container = {
    db: {
      models: {
        pluggyAccount: accountModel,
        pluggyAccountTransaction: transactionModel,
        pluggyCredential: credentialModel,
        pluggyCredentialItem: credentialItemModel,
      },
    },
    getTransaction: () => null,
    logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    credentialEncryptionKey: randomBytes(32).toString('base64'),
  } as unknown as AppContainer
  const mutable = container as unknown as Record<string, unknown>
  const accountRep = new PluggyAccountRep(container)
  const transactionRep = new PluggyAccountTransactionRep(container)
  const credentialRep = new PluggyCredentialRep(container)
  const credentialItemRep = new PluggyCredentialItemRep(container)
  mutable.pluggyAccountRep = accountRep
  mutable.pluggyAccountTransactionRep = transactionRep
  mutable.pluggyCredentialRep = credentialRep
  mutable.pluggyCredentialItemRep = credentialItemRep
  mutable.pluggyClientGateway = new PluggyClientGateway()
  mutable.pluggyItemCredentialResolver = new PluggyItemCredentialResolver(container)

  const impl = new ReadPluggyAccountStatementImpl(container)
  const credentialIds: number[] = []
  const itemIds: string[] = []

  beforeAll(async () => {
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const { Sequelize } = await import('sequelize')
    type Migration = { up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void> }
    const queryInterface = sequelize.getQueryInterface()

    const tables = await queryInterface.showAllTables()
    if (!tables.includes('radar_pluggy_accounts')) {
      const migration = require('../../../../src/infra/db/migrations/20260903120000-criar-pluggy-connector-accounts.cjs') as Migration
      await migration.up(queryInterface, Sequelize)
    }
    const accountCols = await queryInterface.describeTable('radar_pluggy_accounts')
    if (!accountCols.level) {
      const creditMigration = require('../../../../src/infra/db/migrations/20260905120000-adicionar-dados-de-credito-em-pluggy-connector-accounts.cjs') as Migration
      await creditMigration.up(queryInterface, Sequelize)
    }
    const accountColsAfterCredit = await queryInterface.describeTable('radar_pluggy_accounts')
    if (!accountColsAfterCredit.tax_number) {
      const fullCaptureMigration = require('../../../../src/infra/db/migrations/20260906180100-adicionar-campos-completos-em-pluggy-connector-accounts.cjs') as Migration
      await fullCaptureMigration.up(queryInterface, Sequelize)
    }

    if (!tables.includes('radar_pluggy_account_transactions')) {
      const migration = require('../../../../src/infra/db/migrations/20260903130000-criar-pluggy-connector-account-transactions.cjs') as Migration
      await migration.up(queryInterface, Sequelize)
    }
    const txCols = await queryInterface.describeTable('radar_pluggy_account_transactions')
    if (!txCols.credit_card_metadata) {
      const metadataMigration = require('../../../../src/infra/db/migrations/20260906180200-adicionar-credit-card-metadata-em-pluggy-connector-account-transactions.cjs') as Migration
      await metadataMigration.up(queryInterface, Sequelize)
    }
  })

  afterEach(async () => {
    while (itemIds.length > 0) {
      const itemId = itemIds.pop()
      if (itemId !== undefined) {
        await accountModel.destroy({ where: { item_id: itemId } })
        await transactionModel.destroy({ where: { item_id: itemId } })
        await credentialItemModel.destroy({ where: { item_id: itemId } })
      }
    }
    while (credentialIds.length > 0) {
      const id = credentialIds.pop()
      if (id !== undefined) {
        await credentialModel.destroy({ where: { id } })
      }
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  function uniquePersonId(): number {
    return 900_000_000 + Math.floor(Math.random() * 90_000_000)
  }

  async function seedAccountOwnedBy(personId: number): Promise<{ accountId: string; itemId: string }> {
    const credential = await credentialRep.create({ personId, clientId: randomUUID(), clientSecret: 'segredo' })
    const credentialId = credential.requireId()
    credentialIds.push(credentialId)

    const itemId = randomUUID()
    itemIds.push(itemId)
    await credentialItemRep.linkItem(credentialId, itemId)

    const accountId = randomUUID()
    await accountRep.save({
      itemId,
      accountId,
      type: 'CREDIT',
      number: '1234',
      name: 'Cartão Exemplo',
      balance: new Decimal('500.00'),
      currencyCode: 'BRL',
      providerCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
      providerUpdatedAt: new Date('2026-09-01T00:00:00.000Z'),
      availableCreditLimit: new Decimal('1000.00'),
      creditLimit: new Decimal('2000.00'),
      minimumPayment: new Decimal('150.00'),
      balanceDueDate: new Date('2026-09-10T00:00:00.000Z'),
    })

    return { accountId, itemId }
  }

  it('assertAccountBelongsToPerson passa quando a conta pertence à pessoa', async () => {
    const personId = uniquePersonId()
    const { accountId } = await seedAccountOwnedBy(personId)

    await expect(impl.assertAccountBelongsToPerson(accountId, personId)).resolves.toBeUndefined()
  })

  it('assertAccountBelongsToPerson recusa quando a conta é de outra pessoa', async () => {
    const dono = uniquePersonId()
    const outraPessoa = uniquePersonId()
    const { accountId } = await seedAccountOwnedBy(dono)

    await expect(impl.assertAccountBelongsToPerson(accountId, outraPessoa)).rejects.toMatchObject({
      errorType: 'PLUGGY_ACCOUNT_UNAUTHORIZED',
    })
  })

  it('assertAccountBelongsToPerson recusa accountId inexistente', async () => {
    await expect(impl.assertAccountBelongsToPerson(randomUUID(), uniquePersonId())).rejects.toBeInstanceOf(
      ApplicationError,
    )
  })

  it('readBillSummary traduz os campos de crédito da conta com escala fixa', async () => {
    const personId = uniquePersonId()
    const { accountId } = await seedAccountOwnedBy(personId)

    await expect(impl.readBillSummary(accountId)).resolves.toEqual({
      availableCreditLimit: '1000.00',
      creditLimit: '2000.00',
      minimumPayment: '150.00',
      dueDate: '2026-09-10T00:00:00.000Z',
    })
  })

  it('readTransactionsByBillMonth filtra por billForecastDate, exclui outra fatura e transação sem metadado', async () => {
    const personId = uniquePersonId()
    const { accountId, itemId } = await seedAccountOwnedBy(personId)

    await transactionRep.save({
      itemId,
      accountId,
      transactionId: randomUUID(),
      description: 'Compra parcelada',
      currencyCode: 'BRL',
      amount: new Decimal('-250.00'),
      date: new Date('2026-08-20T00:00:00.000Z'),
      transactionType: 'CREDIT',
      status: 'POSTED',
      category: 'Compras',
      merchant: { name: 'Loja Exemplo' },
      creditCardMetadata: { billForecastDate: '2026-09', installmentNumber: 2, totalInstallments: 5 },
      providerCreatedAt: new Date('2026-08-20T00:00:00.000Z'),
      providerUpdatedAt: new Date('2026-08-20T00:00:00.000Z'),
    })
    await transactionRep.save({
      itemId,
      accountId,
      transactionId: randomUUID(),
      description: 'Compra de outra fatura',
      currencyCode: 'BRL',
      amount: new Decimal('-50.00'),
      date: new Date('2026-07-15T00:00:00.000Z'),
      transactionType: 'CREDIT',
      status: 'POSTED',
      creditCardMetadata: { billForecastDate: '2026-08' },
      providerCreatedAt: new Date('2026-07-15T00:00:00.000Z'),
      providerUpdatedAt: new Date('2026-07-15T00:00:00.000Z'),
    })
    await transactionRep.save({
      itemId,
      accountId,
      transactionId: randomUUID(),
      description: 'Sem metadado de cartão',
      currencyCode: 'BRL',
      amount: new Decimal('-10.00'),
      date: new Date('2026-09-05T00:00:00.000Z'),
      transactionType: 'CREDIT',
      status: 'POSTED',
      providerCreatedAt: new Date('2026-09-05T00:00:00.000Z'),
      providerUpdatedAt: new Date('2026-09-05T00:00:00.000Z'),
    })

    const views = await impl.readTransactionsByBillMonth(accountId, '2026-09')

    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({
      description: 'Compra parcelada',
      amount: '-250.00',
      category: 'Compras',
      merchantName: 'Loja Exemplo',
      billForecastMonth: '2026-09',
      installment: { number: 2, total: 5 },
    })
  })
})
