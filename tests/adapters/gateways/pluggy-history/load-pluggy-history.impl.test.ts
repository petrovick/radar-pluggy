import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import SequelizeLib, { type Transaction } from 'sequelize'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import LoadPluggyHistoryImpl from '../../../../src/adapters/gateways/pluggy-history/load-pluggy-history.impl.js'
import { PluggyAccountTransactionRep } from '../../../../src/adapters/repositories/pluggy-account-transaction.rep.js'
import { PluggyHistoryCoverageRep } from '../../../../src/adapters/repositories/pluggy-history-coverage.rep.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'
import { DB_NAMES } from '../../../../src/infra/db/models.js'
import { definePluggyAccountTransactionModel } from '../../../../src/infra/db/models/pluggy-account-transaction-model.js'
import { definePluggyHistoryCoverageModel } from '../../../../src/infra/db/models/pluggy-history-coverage-model.js'
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
  const coverageModel = definePluggyHistoryCoverageModel(sequelize)
  const itemIdsToCleanup: string[] = []

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
    }
  }

  function buildImpl(pages: { results: ReturnType<typeof transactionDto>[]; next: string | null }[]) {
    const transactions = new Map<string, Transaction | null>()

    const container = {
      db: {
        Sequelize: SequelizeLib,
        connections: { [DB_NAMES.MAIN]: sequelize },
        models: { pluggyAccountTransaction: transactionModel, pluggyHistoryCoverage: coverageModel },
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
    mutable.pluggyHistoryCoverageRep = new PluggyHistoryCoverageRep(container)

    return new LoadPluggyHistoryImpl(container)
  }

  afterEach(async () => {
    const itemId = itemIdsToCleanup.pop()
    if (itemId !== undefined) {
      await transactionModel.destroy({ where: { item_id: itemId } })
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

