import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import SequelizeLib, { type Transaction } from 'sequelize'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import LoadPluggyHistoryImpl from '../../../../src/adapters/gateways/pluggy-history/load-pluggy-history.impl.js'
import type { PluggyAccountDto } from '../../../../src/adapters/gateways/pluggy-accounts.gateway.js'
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
import { definePluggySyncProgressModel } from '../../../../src/infra/db/models/pluggy-sync-progress-model.js'
import { PluggySyncProgressRep } from '../../../../src/adapters/repositories/pluggy-sync-progress.rep.js'
import { definePluggyInvestmentTransactionModel } from '../../../../src/infra/db/models/pluggy-investment-transaction-model.js'
import { definePluggyInvestmentTransactionRawModel } from '../../../../src/infra/db/models/pluggy-investment-transaction-raw-model.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

// O cliente do SDK não é exercitado aqui: estes testes cobrem o impl, e o gateway de borda é
// fingido logo abaixo. O stub existe só para o impl ter o que repassar.
const fakeSdkClient = {} as never

// `HistorySource` é união discriminada por `kind` (revisão do review externo ao PR #14): a variante
// `ACCOUNT` exige `.account` presente — usado nos testes de `scanSource` que só precisam de um
// `HistorySource` de conta válido, sem que o conteúdo do DTO importe para o cenário.
function fakeAccountDto(accountId: string): PluggyAccountDto {
  const now = new Date()
  return {
    itemId: 'item-fake',
    accountId,
    type: 'BANK',
    subtype: undefined,
    number: '1',
    name: 'Conta',
    marketingName: undefined,
    balance: new Decimal('0'),
    currencyCode: 'BRL',
    owner: undefined,
    providerCreatedAt: now,
    providerUpdatedAt: now,
    level: undefined,
    brand: undefined,
    brandAdditionalInfo: undefined,
    balanceCloseDate: undefined,
    balanceDueDate: undefined,
    availableCreditLimit: undefined,
    balanceForeignCurrency: undefined,
    minimumPayment: undefined,
    creditLimit: undefined,
    isLimitFlexible: undefined,
    status: undefined,
    holderType: undefined,
    taxNumber: undefined,
    bankData: undefined,
    disaggregatedCreditLimits: undefined,
    raw: { id: accountId },
  }
}

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
    if (!tables.includes('radar_pluggy_account_transaction_raw')) {
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
    for await (const page of impl.scanSource(itemId, { kind: 'ACCOUNT', referenceId: accountId, updatedAt: undefined, account: fakeAccountDto(accountId) }, undefined)) {
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

    const scan = impl.scanSource(itemId, { kind: 'ACCOUNT', referenceId: accountId, updatedAt: undefined, account: fakeAccountDto(accountId) }, undefined)
    await expect(scan.next()).rejects.toBeInstanceOf(ApplicationError)

    expect(await transactionModel.count({ where: { item_id: itemId } })).toBe(0)
    expect(await transactionRawModel.count({ where: { item_id: itemId } })).toBe(0)
  })

  // Revisão do PR #14: o guard precisa ser checado dentro do laço de paginação do próprio gerador,
  // antes de gravar a página recebida — nunca só pelo consumidor (`scanUntilTheEnd` no interactor)
  // depois do `yield`.
  it('revisão PR #14: lease perdido interrompe a varredura antes de gravar/devolver a página seguinte', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = buildImpl([
      { results: [transactionDto(accountId, randomUUID())], next: '/v2/transactions?cursor=2' },
      { results: [transactionDto(accountId, randomUUID())], next: null },
    ])

    const observedPerPage: number[] = []
    const scan = impl.scanSource(itemId, { kind: 'ACCOUNT', referenceId: accountId, updatedAt: undefined, account: fakeAccountDto(accountId) }, {
      isLost: () => true,
    })

    await expect(
      (async () => {
        for await (const page of scan) {
          observedPerPage.push(page.count)
        }
      })(),
    ).rejects.toMatchObject({ errorType: 'PLUGGY_ITEM_INGESTION_LEASE_LOST' })

    expect(observedPerPage).toEqual([])
    expect(await transactionModel.count({ where: { item_id: itemId } })).toBe(0)
  })

  // Revisão do review externo ao PR #14: o teste acima só prova "já perdido desde o início" — não
  // prova a TRANSIÇÃO. Um `for await` chama `next()` do gerador interno antes de entrar no corpo do
  // laço; se o guard fosse checado só ali dentro (depois do `next()`), a perda ocorrendo ENTRE a
  // primeira página processada e o pedido da segunda ainda deixaria a segunda página ser buscada.
  it('revisão do review externo ao PR #14: lease perdido só APÓS a primeira página nunca busca a segunda', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    itemIdsToCleanup.push(itemId)
    let secondPageRequested = false
    let checks = 0
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
          yield { results: [transactionDto(accountId, randomUUID())], next: '/v2/transactions?cursor=2' }
          secondPageRequested = true
          yield { results: [transactionDto(accountId, randomUUID())], next: null }
        },
      },
    } as unknown as AppContainer

    const mutable = container as unknown as Record<string, unknown>
    mutable.pluggyAccountTransactionRep = new PluggyAccountTransactionRep(container)
    mutable.pluggyAccountTransactionRawRep = new PluggyAccountTransactionRawRep(container)
    mutable.pluggyHistoryCoverageRep = new PluggyHistoryCoverageRep(container)
    const impl = new LoadPluggyHistoryImpl(container)

    const leaseGuard = {
      isLost: () => {
        checks++
        return checks > 1
      },
    }
    const scan = impl.scanSource(itemId, { kind: 'ACCOUNT', referenceId: accountId, updatedAt: undefined, account: fakeAccountDto(accountId) }, leaseGuard)

    const observedPerPage: number[] = []
    await expect(
      (async () => {
        for await (const page of scan) {
          observedPerPage.push(page.count)
        }
      })(),
    ).rejects.toMatchObject({ errorType: 'PLUGGY_ITEM_INGESTION_LEASE_LOST' })

    // A 1ª checagem (antes do 1º next()) devolve `false`: a página 1 é pedida, gravada e devolvida. A
    // 2ª checagem (antes do 2º next()) devolve `true`: lança ANTES de o gerador interno ser resumido
    // para produzir a página 2 — nunca uma segunda chamada de rede.
    expect(observedPerPage).toEqual([1])
    expect(secondPageRequested).toBe(false)
    expect(await transactionModel.count({ where: { item_id: itemId } })).toBe(1)
  })

  it('accountId divergente da conta consultada recusa antes de gravar', async () => {
    const itemId = randomUUID()
    const accountId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = buildImpl([{ results: [transactionDto('conta-errada', randomUUID())], next: null }])

    const scan = impl.scanSource(itemId, { kind: 'ACCOUNT', referenceId: accountId, updatedAt: undefined, account: fakeAccountDto(accountId) }, undefined)
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
    if (!tables.includes('radar_pluggy_investment_transaction_raw')) {
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
    for await (const page of impl.scanSource(itemId, { kind: 'INVESTMENT', referenceId: investmentId, updatedAt: undefined }, undefined)) {
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

    const scan = impl.scanSource(itemId, { kind: 'INVESTMENT', referenceId: investmentId, updatedAt: undefined }, undefined)
    await expect(scan.next()).rejects.toBeInstanceOf(ApplicationError)

    expect(await investmentTransactionModel.count({ where: { item_id: itemId } })).toBe(0)
    expect(await investmentTransactionRawModel.count({ where: { item_id: itemId } })).toBe(0)
  })

  // Revisão do review externo ao PR #14: mesmo invariante do ramo ACCOUNT — perda de lease detectada
  // ANTES de pedir a próxima página, nunca só depois de recebê-la.
  it('revisão do review externo ao PR #14: lease já perdido nunca busca nenhuma página de transação de investimento', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = buildImpl([{ results: [investmentTransactionDto(randomUUID())], page: 1, total: 1, totalPages: 1 }])

    const observed: number[] = []
    await expect(
      (async () => {
        for await (const page of impl.scanSource(
          itemId,
          { kind: 'INVESTMENT', referenceId: investmentId, updatedAt: undefined },
          { isLost: () => true },
        )) {
          observed.push(page.count)
        }
      })(),
    ).rejects.toMatchObject({ errorType: 'PLUGGY_ITEM_INGESTION_LEASE_LOST' })

    expect(observed).toEqual([])
    expect(await investmentTransactionModel.count({ where: { item_id: itemId } })).toBe(0)
  })

  it('revisão do review externo ao PR #14: lease perdido só APÓS a primeira página nunca busca a segunda (transação de investimento)', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)
    let secondPageRequested = false
    let checks = 0
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
          yield { results: [investmentTransactionDto(randomUUID())], page: 1, total: 2, totalPages: 2 }
          secondPageRequested = true
          yield { results: [investmentTransactionDto(randomUUID())], page: 2, total: 2, totalPages: 2 }
        },
      },
    } as unknown as AppContainer

    const mutable = container as unknown as Record<string, unknown>
    mutable.pluggyInvestmentTransactionRep = new PluggyInvestmentTransactionRep(container)
    mutable.pluggyInvestmentTransactionRawRep = new PluggyInvestmentTransactionRawRep(container)
    const impl = new LoadPluggyHistoryImpl(container)

    const leaseGuard = {
      isLost: () => {
        checks++
        return checks > 1
      },
    }
    const observed: number[] = []
    await expect(
      (async () => {
        for await (const page of impl.scanSource(
          itemId,
          { kind: 'INVESTMENT', referenceId: investmentId, updatedAt: undefined },
          leaseGuard,
        )) {
          observed.push(page.count)
        }
      })(),
    ).rejects.toMatchObject({ errorType: 'PLUGGY_ITEM_INGESTION_LEASE_LOST' })

    expect(observed).toEqual([1])
    expect(secondPageRequested).toBe(false)
    expect(await investmentTransactionModel.count({ where: { item_id: itemId } })).toBe(1)
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

    await expect(impl.readCustodySources('item-1', undefined)).resolves.toEqual([
      { kind: 'INVESTMENT', referenceId: 'inv-1', updatedAt },
    ])
  })

  it('investimento sem updatedAt vira fonte sem timestamp — o caso de uso varre inteiro', async () => {
    const impl = buildImpl([{ investmentId: 'inv-1', updatedAt: undefined }])

    await expect(impl.readCustodySources('item-1', undefined)).resolves.toEqual([
      { kind: 'INVESTMENT', referenceId: 'inv-1', updatedAt: undefined },
    ])
  })

  // Revisão do PR #14: o guard precisa ser checado DENTRO da paginação, não só pelo interactor em
  // volta de `discover()` inteiro — sem isto, perder o lease no meio de uma descoberta longa (muitas
  // páginas) ainda buscaria todas as páginas restantes antes do interactor ter a chance de notar.
  it('revisão PR #14: lease perdido no meio da paginação de custódia nunca busca a próxima página', async () => {
    let secondPageRequested = false
    const container = {
      db: { models: {} },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: () => null,
      setTransaction: () => {},
      pluggyItemCredentialResolver: { clientFor: async () => fakeSdkClient },
      pluggyInvestmentsGateway: {
        fetchInvestmentPages: async function* () {
          yield { results: [{ investmentId: 'inv-1', updatedAt: undefined }], page: 1, total: 2, totalPages: 2 }
          secondPageRequested = true
          yield { results: [{ investmentId: 'inv-2', updatedAt: undefined }], page: 2, total: 2, totalPages: 2 }
        },
      },
    } as unknown as AppContainer
    const impl = new LoadPluggyHistoryImpl(container)

    await expect(impl.readCustodySources('item-1', { isLost: () => true })).rejects.toMatchObject({
      errorType: 'PLUGGY_ITEM_INGESTION_LEASE_LOST',
    })
    expect(secondPageRequested).toBe(false)
  })

  // Revisão do review externo ao PR #14: o teste acima só prova "já perdido desde o início" — não
  // prova a TRANSIÇÃO (lease válido na 1ª checagem, perdido só na 2ª).
  it('revisão do review externo ao PR #14: lease perdido só APÓS a primeira página nunca busca a segunda (custódia)', async () => {
    let secondPageRequested = false
    let checks = 0
    const container = {
      db: { models: {} },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: () => null,
      setTransaction: () => {},
      pluggyItemCredentialResolver: { clientFor: async () => fakeSdkClient },
      pluggyInvestmentsGateway: {
        fetchInvestmentPages: async function* () {
          yield { results: [{ investmentId: 'inv-1', updatedAt: undefined }], page: 1, total: 2, totalPages: 2 }
          secondPageRequested = true
          yield { results: [{ investmentId: 'inv-2', updatedAt: undefined }], page: 2, total: 2, totalPages: 2 }
        },
      },
    } as unknown as AppContainer
    const impl = new LoadPluggyHistoryImpl(container)

    const leaseGuard = {
      isLost: () => {
        checks++
        return checks > 1
      },
    }
    await expect(impl.readCustodySources('item-1', leaseGuard)).rejects.toMatchObject({
      errorType: 'PLUGGY_ITEM_INGESTION_LEASE_LOST',
    })
    expect(secondPageRequested).toBe(false)
  })
})

// Requer MySQL alcançável: o log bruto agora é inserido na mesma transação do registro principal
// (change pluggy-complete-data-capture, spec pluggy-raw-payload-audit), então precisa de conexão
// real — um fake de transação não provaria a atomicidade.
// Não toca banco (revisão do review externo ao PR #14): `readCashSources` nunca persiste mais —
// só coleta o DTO de cada conta elegível (BANK/CREDIT), devolvido junto do `HistorySource`. Quem
// grava a fotografia de conta é só `commitAccountsDiscovery`, protegido pelo gate de versão — antes
// desta correção, um worker velho ainda podia sobrescrever uma conta nova ANTES de perder a corrida.
describe('LoadPluggyHistoryImpl.readCashSources', () => {
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

  function buildImpl(accounts: ReturnType<typeof accountDto>[]) {
    const container = {
      db: { models: {} },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: () => null,
      setTransaction: () => {},
      pluggyItemCredentialResolver: { clientFor: async () => fakeSdkClient },
      pluggyAccountsGateway: {
        fetchAccountPages: async function* () {
          yield { results: accounts, page: 1, total: accounts.length, totalPages: 1 }
        },
      },
    } as unknown as AppContainer

    return new LoadPluggyHistoryImpl(container)
  }

  it('conta BANK e conta CREDIT viram fonte de caixa com o DTO completo anexado, sem persistir nada', async () => {
    const itemId = randomUUID()
    const providerUpdatedAt = new Date('2026-09-03T04:40:13.435Z')
    const bank = accountDto(itemId, 'acc-bank', 'BANK', providerUpdatedAt)
    const credit = accountDto(itemId, 'acc-credit', 'CREDIT', providerUpdatedAt)

    const impl = buildImpl([bank, credit])
    const sources = await impl.readCashSources(itemId, undefined)

    expect(sources).toEqual([
      { kind: 'ACCOUNT', referenceId: 'acc-bank', updatedAt: providerUpdatedAt, account: bank },
      { kind: 'ACCOUNT', referenceId: 'acc-credit', updatedAt: providerUpdatedAt, account: credit },
    ])
  })

  it('conta de tipo não elegível (nem BANK nem CREDIT) é descartada', async () => {
    const itemId = randomUUID()
    const impl = buildImpl([accountDto(itemId, 'acc-other', 'INVESTMENT', new Date())])

    await expect(impl.readCashSources(itemId, undefined)).resolves.toEqual([])
  })

  // Revisão do review externo ao PR #14: mesmo motivo de `readCustodySources` — o guard precisa ser
  // checado ANTES de cada `iterator.next()`, inclusive o da primeira página.
  it('revisão do review externo ao PR #14: lease já perdido nunca busca nenhuma página de contas', async () => {
    const itemId = randomUUID()
    const impl = buildImpl([accountDto(itemId, 'acc-1', 'BANK', new Date())])

    await expect(impl.readCashSources(itemId, { isLost: () => true })).rejects.toMatchObject({
      errorType: 'PLUGGY_ITEM_INGESTION_LEASE_LOST',
    })
  })

  it('revisão do review externo ao PR #14: lease perdido só APÓS a primeira página nunca busca a segunda', async () => {
    const itemId = randomUUID()
    const providerUpdatedAt = new Date('2026-09-03T04:40:13.435Z')
    let secondPageRequested = false
    let checks = 0

    const container = {
      db: { models: {} },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: () => null,
      setTransaction: () => {},
      pluggyItemCredentialResolver: { clientFor: async () => fakeSdkClient },
      pluggyAccountsGateway: {
        fetchAccountPages: async function* () {
          yield { results: [accountDto(itemId, 'acc-1', 'BANK', providerUpdatedAt)], page: 1, total: 2, totalPages: 2 }
          secondPageRequested = true
          yield { results: [accountDto(itemId, 'acc-2', 'BANK', providerUpdatedAt)], page: 2, total: 2, totalPages: 2 }
        },
      },
    } as unknown as AppContainer
    const impl = new LoadPluggyHistoryImpl(container)

    const leaseGuard = {
      isLost: () => {
        checks++
        return checks > 1
      },
    }
    await expect(impl.readCashSources(itemId, leaseGuard)).rejects.toMatchObject({
      errorType: 'PLUGGY_ITEM_INGESTION_LEASE_LOST',
    })
    expect(secondPageRequested).toBe(false)
  })
})

describe('LoadPluggyHistoryImpl.readCurrentItemState', () => {
  function buildImpl(itemSnapshot: Record<string, unknown>) {
    const container = {
      db: { models: {} },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: () => null,
      setTransaction: () => {},
      pluggyItemCredentialResolver: { clientFor: async () => fakeSdkClient },
      pluggyItemStateResolver: { read: async () => itemSnapshot },
    } as unknown as AppContainer

    return new LoadPluggyHistoryImpl(container)
  }

  it('traduz o snapshot do item para o estado que o caso de uso consome', async () => {
    const impl = buildImpl({
      status: 'UPDATED',
      executionStatus: 'PARTIAL_SUCCESS',
      lastUpdatedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      itemProducts: ['ACCOUNTS'],
      products: { accounts: { isUpdated: true, lastUpdatedAt: '2026-08-01T00:00:00.000Z', warnings: [] } },
      connector: undefined,
      raw: {},
    })

    await expect(impl.readCurrentItemState('item-1')).resolves.toEqual({
      executionStatus: 'PARTIAL_SUCCESS',
      lastUpdatedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      itemProducts: ['ACCOUNTS'],
      products: { accounts: { isUpdated: true, lastUpdatedAt: '2026-08-01T00:00:00.000Z', warnings: [] } },
    })
  })
})

// Requer MySQL alcançável: prova que o gateway delega para `PluggySyncProgressRep` sempre com
// `consumer = HISTORY_LOAD`, nunca outro valor.
describe('LoadPluggyHistoryImpl.readSyncProgress / advanceSyncProgress', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const syncProgressModel = definePluggySyncProgressModel(sequelize)
  const itemIdsToCleanup: string[] = []

  afterEach(async () => {
    const itemId = itemIdsToCleanup.pop()
    if (itemId !== undefined) {
      await syncProgressModel.destroy({ where: { item_id: itemId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  function buildImpl() {
    const transactions = new Map<string, Transaction | null>()
    const container = {
      db: { Sequelize: SequelizeLib, connections: { [DB_NAMES.MAIN]: sequelize }, models: { pluggySyncProgress: syncProgressModel } },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: (name: string) => transactions.get(name) ?? null,
      setTransaction: (name: string, tx: Transaction | null) => {
        transactions.set(name, tx)
      },
    } as unknown as AppContainer

    const mutable = container as unknown as Record<string, unknown>
    mutable.pluggySyncProgressRep = new PluggySyncProgressRep(container)
    return new LoadPluggyHistoryImpl(container)
  }

  it('advança e lê sempre sob o consumidor HISTORY_LOAD', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)
    const impl = buildImpl()

    await impl.advanceSyncProgress(itemId, 'ACCOUNTS', new Date('2026-08-01T00:00:00.000Z'))

    await expect(impl.readSyncProgress(itemId, 'ACCOUNTS')).resolves.toEqual(new Date('2026-08-01T00:00:00.000Z'))
    const row = await syncProgressModel.findOne({ where: { item_id: itemId } })
    expect(row?.get('consumer')).toBe('HISTORY_LOAD')
    expect(row?.get('source')).toBe('ACCOUNTS')
  })
})

// Requer MySQL alcançável: prova que `commitAccountsDiscovery` de fato remove as contas ausentes da
// leitura atual (design.md D21), delegando para `PluggyAccountRep.reconcile` — e que o faz só quando
// a versão vence a corrida contra `pluggy_sync_progress` (revisão do PR #14).
describe('LoadPluggyHistoryImpl.commitAccountsDiscovery', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const accountModel = definePluggyAccountModel(sequelize)
  const accountRawModel = definePluggyAccountRawModel(sequelize)
  const syncProgressModel = definePluggySyncProgressModel(sequelize)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('radar_pluggy_account_raw')) {
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
      await syncProgressModel.destroy({ where: { item_id: itemId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  // DTO completo (não só o id): revisão do review externo ao PR #14 — `commitAccountsDiscovery`
  // agora upserta a conta inteira, não só reconcilia por id.
  function accountDto(itemId: string, accountId: string, balance: string): PluggyAccountDto {
    const now = new Date()
    return {
      itemId,
      accountId,
      type: 'BANK',
      subtype: undefined,
      number: '1',
      name: 'Conta',
      marketingName: undefined,
      balance: new Decimal(balance),
      currencyCode: 'BRL',
      owner: undefined,
      providerCreatedAt: now,
      providerUpdatedAt: now,
      level: undefined,
      brand: undefined,
      brandAdditionalInfo: undefined,
      balanceCloseDate: undefined,
      balanceDueDate: undefined,
      availableCreditLimit: undefined,
      balanceForeignCurrency: undefined,
      minimumPayment: undefined,
      creditLimit: undefined,
      isLimitFlexible: undefined,
      status: undefined,
      holderType: undefined,
      taxNumber: undefined,
      bankData: undefined,
      disaggregatedCreditLimits: undefined,
      raw: { id: accountId, balance },
    }
  }

  function buildImpl(rawRepOverride?: { save: () => Promise<never> }) {
    const transactions = new Map<string, Transaction | null>()
    const container = {
      db: {
        Sequelize: SequelizeLib,
        connections: { [DB_NAMES.MAIN]: sequelize },
        models: { pluggyAccount: accountModel, pluggyAccountRaw: accountRawModel, pluggySyncProgress: syncProgressModel },
      },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: (name: string) => transactions.get(name) ?? null,
      setTransaction: (name: string, tx: Transaction | null) => {
        transactions.set(name, tx)
      },
    } as unknown as AppContainer

    const mutable = container as unknown as Record<string, unknown>
    mutable.pluggyAccountRep = new PluggyAccountRep(container)
    mutable.pluggyAccountRawRep = rawRepOverride ?? new PluggyAccountRawRep(container)
    mutable.pluggySyncProgressRep = new PluggySyncProgressRep(container)
    return new LoadPluggyHistoryImpl(container)
  }

  async function seedAccount(itemId: string, accountId: string): Promise<void> {
    const now = new Date()
    await accountModel.create({
      item_id: itemId,
      account_id: accountId,
      type: 'BANK',
      number: '1',
      name: 'Conta',
      balance: '10.00',
      currency_code: 'BRL',
      provider_created_at: now,
      provider_updated_at: now,
      created_at: now,
      updated_at: now,
    } as never)
  }

  it('remove contas ausentes da leitura autoritativa atual, e devolve true (venceu a corrida)', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)
    const impl = buildImpl()
    await seedAccount(itemId, 'acc-1')

    await expect(impl.commitAccountsDiscovery(itemId, [], new Date('2026-08-01T00:00:00.000Z'))).resolves.toBe(true)

    expect(await accountModel.count({ where: { item_id: itemId } })).toBe(0)
  })

  // Revisão do review externo ao PR #14: prova que o upsert de conta + payload bruto agora acontece
  // AQUI (não mais em `readCashSources`), só depois de vencer o gate de versão.
  it('upserta cada conta presente e seu payload bruto, na mesma transação do avanço de versão', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)
    const impl = buildImpl()
    const account = accountDto(itemId, 'acc-1', '123.45')

    await expect(impl.commitAccountsDiscovery(itemId, [account], new Date('2026-08-01T00:00:00.000Z'))).resolves.toBe(true)

    const row = await accountModel.findOne({ where: { item_id: itemId, account_id: 'acc-1' } })
    expect(row?.get('balance')).toBe('123.45')
    expect(await accountRawModel.count({ where: { item_id: itemId, account_id: 'acc-1' } })).toBe(1)
  })

  // Change pluggy-complete-data-capture, spec pluggy-raw-payload-audit: falha no log bruto desfaz o
  // upsert da conta da mesma iteração — agora dentro de `commitAccountsDiscovery`, não mais em
  // `readCashSources` (revisão do review externo ao PR #14: `readCashSources` nunca mais persiste).
  it('falha ao gravar o log bruto desfaz o upsert da conta da mesma iteração', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)
    const impl = buildImpl({
      save: async () => {
        throw new ApplicationError('PLUGGY_ACCOUNT_RAW_WRITE_FAILED', { itemId })
      },
    })
    const account = accountDto(itemId, 'acc-1', '123.45')

    await expect(
      impl.commitAccountsDiscovery(itemId, [account], new Date('2026-08-01T00:00:00.000Z')),
    ).rejects.toBeInstanceOf(ApplicationError)

    expect(await accountModel.count({ where: { item_id: itemId } })).toBe(0)
  })

  it('versão mais antiga chegando depois nunca regride a fotografia de contas (corrida de concorrência, revisão do review externo ao PR #14)', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)
    const impl = buildImpl()
    await seedAccount(itemId, 'acc-fresh')
    const olderVersion = new Date('2026-08-01T00:00:00.000Z')
    const newerVersion = new Date('2026-08-10T00:00:00.000Z')

    // Worker "novo" reconcilia primeiro com a lista fresca (só acc-fresh presente).
    const freshResult = await impl.commitAccountsDiscovery(itemId, [accountDto(itemId, 'acc-fresh', '999.00')], newerVersion)
    // Worker "velho" tenta reconciliar depois com uma versão mais antiga e uma lista incompleta —
    // se isso vencesse, apagaria acc-fresh por não estar na lista velha.
    const staleResult = await impl.commitAccountsDiscovery(itemId, [], olderVersion)

    expect(freshResult).toBe(true)
    expect(staleResult).toBe(false)
    expect(await accountModel.count({ where: { item_id: itemId, account_id: 'acc-fresh' } })).toBe(1)

    const progress = await syncProgressModel.findOne({ where: { item_id: itemId, source: 'ACCOUNTS' } })
    expect(progress?.get('last_completed_version_at')).toEqual(newerVersion)
  })

  // Pedido explícito do review externo ao PR #14: prova que o upsert de uma execução VELHA nunca
  // sobrescreve o VALOR já gravado por uma execução mais NOVA da MESMA conta — não só que a conta
  // não é apagada (reconcile), mas que o próprio valor não regride. Antes desta correção,
  // `readCashSources` fazia esse upsert ANTES do gate — um worker velho podia sobrescrever o saldo
  // fresco antes de seu próprio `advance` ser rejeitado.
  it('worker velho com Account X desatualizada nunca sobrescreve o valor já gravado pelo worker novo', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)
    const impl = buildImpl()
    const olderVersion = new Date('2026-08-01T00:00:00.000Z')
    const newerVersion = new Date('2026-08-10T00:00:00.000Z')

    // Worker "novo" grava Account X (V11) com o saldo atual.
    const freshResult = await impl.commitAccountsDiscovery(itemId, [accountDto(itemId, 'acc-x', '500.00')], newerVersion)
    // Worker "velho" (V10) chega depois com a MESMA conta, mas com um saldo desatualizado.
    const staleResult = await impl.commitAccountsDiscovery(itemId, [accountDto(itemId, 'acc-x', '100.00')], olderVersion)

    expect(freshResult).toBe(true)
    expect(staleResult).toBe(false)

    const row = await accountModel.findOne({ where: { item_id: itemId, account_id: 'acc-x' } })
    expect(row?.get('balance')).toBe('500.00')
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

