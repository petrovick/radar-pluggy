import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import SequelizeLib, { type Transaction } from 'sequelize'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import LoadPluggyHistoryImpl from '../../../../src/adapters/gateways/pluggy-history/load-pluggy-history.impl.js'
import { PluggyAccountTransactionRep } from '../../../../src/adapters/repositories/pluggy-account-transaction.rep.js'
import { PluggyAccountTransactionRawRep } from '../../../../src/adapters/repositories/pluggy-account-transaction-raw.rep.js'
import { PluggyAccountRep } from '../../../../src/adapters/repositories/pluggy-account.rep.js'
import { PluggyAccountRawRep } from '../../../../src/adapters/repositories/pluggy-account-raw.rep.js'
import { PluggyHistoryCoverageRep } from '../../../../src/adapters/repositories/pluggy-history-coverage.rep.js'
import { PluggyInvestmentTransactionRep } from '../../../../src/adapters/repositories/pluggy-investment-transaction.rep.js'
import { PluggyInvestmentTransactionRawRep } from '../../../../src/adapters/repositories/pluggy-investment-transaction-raw.rep.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'
import { DB_NAMES } from '../../../../src/infra/db/models.js'
import { definePluggyAccountTransactionModel } from '../../../../src/infra/db/models/pluggy-account-transaction-model.js'
import { definePluggyAccountTransactionRawModel } from '../../../../src/infra/db/models/pluggy-account-transaction-raw-model.js'
import { definePluggyAccountModel } from '../../../../src/infra/db/models/pluggy-account-model.js'
import { definePluggyAccountRawModel } from '../../../../src/infra/db/models/pluggy-account-raw-model.js'
import { definePluggyHistoryCoverageModel } from '../../../../src/infra/db/models/pluggy-history-coverage-model.js'
import { definePluggyInvestmentTransactionModel } from '../../../../src/infra/db/models/pluggy-investment-transaction-model.js'
import { definePluggyInvestmentTransactionRawModel } from '../../../../src/infra/db/models/pluggy-investment-transaction-raw-model.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

// O cliente do SDK não é exercitado aqui: estes testes cobrem o impl, e o gateway de borda é
// fingido logo abaixo. O stub existe só para o impl ter o que repassar.
const fakeSdkClient = {} as never

// Requer MySQL alcançável. O que este teste prova, e o teste do interactor não pode provar (ele usa
// fake do gateway): que cada página é gravada ANTES de ser devolvida, e que `accountId` divergente
// recusa antes de gravar lançamento na conta errada.
describe('LoadPluggyHistoryImpl.scanSource', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const transactionModel = definePluggyAccountTransactionModel(sequelize)
  const transactionRawModel = definePluggyAccountTransactionRawModel(sequelize)
  const coverageModel = definePluggyHistoryCoverageModel(sequelize)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('pluggy_connector_account_transaction_raw')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const migration = require('../../../../src/infra/db/migrations/20260906181400-criar-pluggy-connector-account-transaction-raw.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await migration.up(queryInterface, Sequelize)
    }
  })

  function transactionDto(accountId: string, transactionId: string) {
    return {
      accountId,
      transactionId,
      description: 'Compra Mercado',
      currencyCode: 'BRL',
      amount: new Decimal('-18.24'),
      date: new Date('2026-09-03T04:22:50.758Z'),
      transactionType: 'DEBIT',
      status: 'POSTED',
      providerCreatedAt: new Date('2026-09-03T04:26:12.808Z'),
      providerUpdatedAt: new Date('2026-09-03T04:40:13.435Z'),
      raw: { id: transactionId, accountId },
    }
  }

  function buildImpl(
    pages: { results: ReturnType<typeof transactionDto>[]; next: string | null }[],
    rawRepOverride?: { save: () => Promise<never> },
  ) {
    const transactions = new Map<string, Transaction | null>()

    const container = {
      db: {
        Sequelize: SequelizeLib,
        connections: { [DB_NAMES.MAIN]: sequelize },
        models: {
          pluggyAccountTransaction: transactionModel,
          pluggyAccountTransactionRaw: transactionRawModel,
          pluggyHistoryCoverage: coverageModel,
        },
      },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: (name: string) => transactions.get(name) ?? null,
      setTransaction: (name: string, tx: Transaction | null) => {
        transactions.set(name, tx)
      },
      pluggyItemCredentialResolver: { clientFor: async () => fakeSdkClient, credentialFor: async () => undefined },
      pluggyAccountTransactionsGateway: {

        fetchTransactionPages: async function* () {
          for (const page of pages) {
            yield page
          }
        },
      },
    } as unknown as AppContainer

    const mutable = container as unknown as Record<string, unknown>
    mutable.pluggyAccountTransactionRep = new PluggyAccountTransactionRep(container)
    mutable.pluggyAccountTransactionRawRep = rawRepOverride ?? new PluggyAccountTransactionRawRep(container)
    mutable.pluggyHistoryCoverageRep = new PluggyHistoryCoverageRep(container)

    return new LoadPluggyHistoryImpl(container)
  }

  afterEach(async () => {
    const itemId = itemIdsToCleanup.pop()
    if (itemId !== undefined) {
      await transactionModel.destroy({ where: { item_id: itemId } })
      await transactionRawModel.destroy({ where: { item_id: itemId } })
      await coverageModel.destroy({ where: { item_id: itemId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('grava cada página antes de devolvê-la ao caso de uso', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = buildImpl([
      { results: [transactionDto(accountId, randomUUID())], next: '/v2/transactions?cursor=2' },
      { results: [transactionDto(accountId, randomUUID())], next: null },
    ])

    const observedPerPage: number[] = []
    for await (const page of impl.scanSource(itemId, { kind: 'ACCOUNT', referenceId: accountId, updatedAt: undefined })) {
      observedPerPage.push(page.count)
      // Se a gravação acontecesse só no fim da varredura, esta contagem seria 0 na primeira volta.
      expect(await transactionModel.count({ where: { item_id: itemId } })).toBe(observedPerPage.length)
    }

    expect(observedPerPage).toEqual([1, 1])
    // Change pluggy-complete-data-capture, spec pluggy-raw-payload-audit: log bruto junto do
    // principal, mesma quantidade de linhas.
    expect(await transactionRawModel.count({ where: { item_id: itemId } })).toBe(2)
  })

  // Change pluggy-complete-data-capture, spec pluggy-raw-payload-audit: falha no log bruto desfaz
  // a transação da mesma iteração (mini-transação por transação).
  it('falha ao gravar o log bruto desfaz a transação da mesma iteração', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = buildImpl(
      [{ results: [transactionDto(accountId, randomUUID())], next: null }],
      {
        save: async () => {
          throw new ApplicationError('PLUGGY_ACCOUNT_TRANSACTION_RAW_WRITE_FAILED', { itemId })
        },
      },
    )

    const scan = impl.scanSource(itemId, { kind: 'ACCOUNT', referenceId: accountId, updatedAt: undefined })
    await expect(scan.next()).rejects.toBeInstanceOf(ApplicationError)

    expect(await transactionModel.count({ where: { item_id: itemId } })).toBe(0)
    expect(await transactionRawModel.count({ where: { item_id: itemId } })).toBe(0)
  })

  it('accountId divergente da conta consultada recusa antes de gravar', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = buildImpl([{ results: [transactionDto('conta-errada', randomUUID())], next: null }])

    const scan = impl.scanSource(itemId, { kind: 'ACCOUNT', referenceId: accountId, updatedAt: undefined })
    await expect(scan.next()).rejects.toBeInstanceOf(ApplicationError)

    expect(await transactionModel.count({ where: { item_id: itemId } })).toBe(0)
  })

  it('varredura vazia grava contagem zero e datas nulas, sem alegar período coberto', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = buildImpl([{ results: [], next: null }])

    await impl.saveCompletedScan(itemId, {
      kind: 'ACCOUNT',
      referenceId: accountId,
      observedCount: 0,
      oldestObservedAt: undefined,
      newestObservedAt: undefined,
      sourceUpdatedAt: undefined,
    })

    const row = await coverageModel.findOne({ where: { item_id: itemId, reference_id: accountId } })
    expect(row?.get('observed_transaction_count')).toBe(0)
    expect(row?.get('oldest_observed_transaction_at')).toBeNull()
    expect(row?.get('newest_observed_transaction_at')).toBeNull()
    // A conclusão em si existe: prova que a varredura terminou, sem afirmar cobertura de período.
    expect(row?.get('last_completed_scan_at')).toBeInstanceOf(Date)
  })
})

// Mesma disciplina de log bruto do ramo ACCOUNT acima, agora para o ramo INVESTMENT (change
// pluggy-complete-data-capture, spec pluggy-raw-payload-audit).
describe('LoadPluggyHistoryImpl.scanSource — transação de investimento', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const investmentTransactionModel = definePluggyInvestmentTransactionModel(sequelize)
  const investmentTransactionRawModel = definePluggyInvestmentTransactionRawModel(sequelize)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('pluggy_connector_investment_transaction_raw')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const migration = require('../../../../src/infra/db/migrations/20260906181500-criar-pluggy-connector-investment-transaction-raw.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await migration.up(queryInterface, Sequelize)
    }
  })

  afterEach(async () => {
    const itemId = itemIdsToCleanup.pop()
    if (itemId !== undefined) {
      await investmentTransactionModel.destroy({ where: { item_id: itemId } })
      await investmentTransactionRawModel.destroy({ where: { item_id: itemId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  function investmentTransactionDto(transactionId: string) {
    return {
      transactionId,
      type: 'BUY',
      date: new Date('2026-09-03T03:00:00.000Z'),
      raw: { id: transactionId, type: 'BUY' },
    }
  }

  function buildImpl(
    pages: { results: ReturnType<typeof investmentTransactionDto>[]; page: number; total: number; totalPages: number }[],
    rawRepOverride?: { save: () => Promise<never> },
  ) {
    const transactions = new Map<string, Transaction | null>()

    const container = {
      db: {
        Sequelize: SequelizeLib,
        connections: { [DB_NAMES.MAIN]: sequelize },
        models: {
          pluggyInvestmentTransaction: investmentTransactionModel,
          pluggyInvestmentTransactionRaw: investmentTransactionRawModel,
        },
      },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: (name: string) => transactions.get(name) ?? null,
      setTransaction: (name: string, tx: Transaction | null) => {
        transactions.set(name, tx)
      },
      pluggyItemCredentialResolver: { clientFor: async () => fakeSdkClient, credentialFor: async () => undefined },
      pluggyInvestmentTransactionsGateway: {
        fetchTransactionPages: async function* () {
          for (const page of pages) {
            yield page
          }
        },
      },
    } as unknown as AppContainer

    const mutable = container as unknown as Record<string, unknown>
    mutable.pluggyInvestmentTransactionRep = new PluggyInvestmentTransactionRep(container)
    mutable.pluggyInvestmentTransactionRawRep = rawRepOverride ?? new PluggyInvestmentTransactionRawRep(container)

    return new LoadPluggyHistoryImpl(container)
  }

  it('grava transação de investimento e log bruto na mesma unidade', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = buildImpl([
      { results: [investmentTransactionDto(randomUUID())], page: 1, total: 1, totalPages: 1 },
    ])

    const observed: number[] = []
    for await (const page of impl.scanSource(itemId, { kind: 'INVESTMENT', referenceId: investmentId, updatedAt: undefined })) {
      observed.push(page.count)
    }

    expect(observed).toEqual([1])
    expect(await investmentTransactionModel.count({ where: { item_id: itemId } })).toBe(1)
    expect(await investmentTransactionRawModel.count({ where: { item_id: itemId } })).toBe(1)
  })

  // Change pluggy-complete-data-capture, spec pluggy-raw-payload-audit: falha no log bruto desfaz
  // a transação da mesma iteração (mini-transação por transação).
  it('falha ao gravar o log bruto desfaz a transação de investimento da mesma iteração', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = buildImpl(
      [{ results: [investmentTransactionDto(randomUUID())], page: 1, total: 1, totalPages: 1 }],
      {
        save: async () => {
          throw new ApplicationError('PLUGGY_INVESTMENT_TRANSACTION_RAW_WRITE_FAILED', { itemId })
        },
      },
    )

    const scan = impl.scanSource(itemId, { kind: 'INVESTMENT', referenceId: investmentId, updatedAt: undefined })
    await expect(scan.next()).rejects.toBeInstanceOf(ApplicationError)

    expect(await investmentTransactionModel.count({ where: { item_id: itemId } })).toBe(0)
    expect(await investmentTransactionRawModel.count({ where: { item_id: itemId } })).toBe(0)
  })
})

// Não toca banco: prova só a tradução de investimento da Pluggy para fonte de histórico, que é onde
// o portão incremental de custódia vive ou morre.
describe('LoadPluggyHistoryImpl.readCustodySources', () => {
  function buildImpl(investments: { investmentId: string; updatedAt: Date | undefined }[]) {
    const container = {
      db: { models: {} },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: () => null,
      setTransaction: () => {},
      pluggyItemCredentialResolver: { clientFor: async () => fakeSdkClient },
      pluggyInvestmentsGateway: {
        fetchInvestmentPages: async function* () {
          yield { results: investments, page: 1, total: investments.length, totalPages: 1 }
        },
      },
    } as unknown as AppContainer

    return new LoadPluggyHistoryImpl(container)
  }

  it('propaga o updatedAt do investimento para a fonte de custódia', async () => {
    const updatedAt = new Date('2026-08-30T12:00:00.000Z')
    const impl = buildImpl([{ investmentId: 'inv-1', updatedAt }])

    await expect(impl.readCustodySources('item-1')).resolves.toEqual([
      { kind: 'INVESTMENT', referenceId: 'inv-1', updatedAt },
    ])
  })

  it('investimento sem updatedAt vira fonte sem timestamp — o caso de uso varre inteiro', async () => {
    const impl = buildImpl([{ investmentId: 'inv-1', updatedAt: undefined }])

    await expect(impl.readCustodySources('item-1')).resolves.toEqual([
      { kind: 'INVESTMENT', referenceId: 'inv-1', updatedAt: undefined },
    ])
  })
})

// Requer MySQL alcançável: o log bruto agora é inserido na mesma transação do registro principal
// (change pluggy-complete-data-capture, spec pluggy-raw-payload-audit), então precisa de conexão
// real — um fake de transação não provaria a atomicidade.
describe('LoadPluggyHistoryImpl.readCashSources', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const accountModel = definePluggyAccountModel(sequelize)
  const accountRawModel = definePluggyAccountRawModel(sequelize)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('pluggy_connector_account_raw')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const migration = require('../../../../src/infra/db/migrations/20260906181300-criar-pluggy-connector-account-raw.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await migration.up(queryInterface, Sequelize)
    }
  })

  afterEach(async () => {
    const itemId = itemIdsToCleanup.pop()
    if (itemId !== undefined) {
      await accountModel.destroy({ where: { item_id: itemId } })
      await accountRawModel.destroy({ where: { item_id: itemId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  function accountDto(itemId: string, accountId: string, type: string, providerUpdatedAt: Date) {
    return {
      itemId,
      accountId,
      type,
      subtype: type === 'CREDIT' ? 'CREDIT_CARD' : 'CHECKING_ACCOUNT',
      number: '12345-6',
      name: 'Conta Teste',
      balance: new Decimal('100.00'),
      currencyCode: 'BRL',
      providerCreatedAt: new Date('2026-08-23T04:26:12.808Z'),
      providerUpdatedAt,
      raw: { id: accountId, type },
    }
  }

  function buildImpl(accounts: ReturnType<typeof accountDto>[], rawRepOverride?: { save: () => Promise<never> }) {
    const transactions = new Map<string, Transaction | null>()

    const container = {
      db: {
        Sequelize: SequelizeLib,
        connections: { [DB_NAMES.MAIN]: sequelize },
        models: { pluggyAccount: accountModel, pluggyAccountRaw: accountRawModel },
      },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: (name: string) => transactions.get(name) ?? null,
      setTransaction: (name: string, tx: Transaction | null) => {
        transactions.set(name, tx)
      },
      pluggyItemCredentialResolver: { clientFor: async () => fakeSdkClient },
      pluggyAccountsGateway: {
        fetchAccountPages: async function* () {
          yield { results: accounts, page: 1, total: accounts.length, totalPages: 1 }
        },
      },
    } as unknown as AppContainer

    const mutable = container as unknown as Record<string, unknown>
    mutable.pluggyAccountRep = new PluggyAccountRep(container)
    mutable.pluggyAccountRawRep = rawRepOverride ?? new PluggyAccountRawRep(container)

    return new LoadPluggyHistoryImpl(container)
  }

  it('conta BANK e conta CREDIT viram fonte de caixa e são salvas, com log bruto na mesma transação', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)
    const providerUpdatedAt = new Date('2026-09-03T04:40:13.435Z')

    const impl = buildImpl([
      accountDto(itemId, 'acc-bank', 'BANK', providerUpdatedAt),
      accountDto(itemId, 'acc-credit', 'CREDIT', providerUpdatedAt),
    ])

    const sources = await impl.readCashSources(itemId)

    expect(sources).toEqual([
      { kind: 'ACCOUNT', referenceId: 'acc-bank', updatedAt: providerUpdatedAt },
      { kind: 'ACCOUNT', referenceId: 'acc-credit', updatedAt: providerUpdatedAt },
    ])
    expect(await accountModel.count({ where: { item_id: itemId } })).toBe(2)
    expect(await accountRawModel.count({ where: { item_id: itemId } })).toBe(2)
  })

  // Change pluggy-complete-data-capture, spec pluggy-raw-payload-audit: falha no log bruto desfaz
  // o registro principal da mesma conta (mini-transação por conta).
  it('falha ao gravar o log bruto desfaz a conta da mesma iteração', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)
    const providerUpdatedAt = new Date('2026-09-03T04:40:13.435Z')

    const impl = buildImpl(
      [accountDto(itemId, 'acc-bank', 'BANK', providerUpdatedAt)],
      {
        save: async () => {
          throw new ApplicationError('PLUGGY_ACCOUNT_RAW_WRITE_FAILED', { itemId })
        },
      },
    )

    await expect(impl.readCashSources(itemId)).rejects.toBeInstanceOf(ApplicationError)

    expect(await accountModel.count({ where: { item_id: itemId } })).toBe(0)
    expect(await accountRawModel.count({ where: { item_id: itemId } })).toBe(0)
  })
})

describe('LoadPluggyHistoryImpl.assertItemAccess', () => {
  function buildImpl(mockCredential: { getPersonId: () => number } | undefined) {
    const container = {
      db: { models: {} },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: () => null,
      setTransaction: () => {},
      pluggyItemCredentialResolver: {
        findCredentialFor: async () => mockCredential,
      },
    } as unknown as AppContainer

    return new LoadPluggyHistoryImpl(container)
  }

  it('permite acesso quando o titular da credencial confere com o personId informado', async () => {
    const impl = buildImpl({ getPersonId: () => 42 })
    await expect(impl.assertItemAccess('item-1', 42)).resolves.toBeUndefined()
  })

  it('recusa com PLUGGY_ITEM_UNAUTHORIZED quando o personId for diferente', async () => {
    const impl = buildImpl({ getPersonId: () => 99 })
    await expect(impl.assertItemAccess('item-1', 42)).rejects.toMatchObject({
      errorType: 'PLUGGY_ITEM_UNAUTHORIZED',
    })
  })

  it('recusa com PLUGGY_ITEM_UNAUTHORIZED quando o item não tiver credencial vinculada', async () => {
    const impl = buildImpl(undefined)
    await expect(impl.assertItemAccess('item-1', 42)).rejects.toMatchObject({
      errorType: 'PLUGGY_ITEM_UNAUTHORIZED',
    })
  })
})

