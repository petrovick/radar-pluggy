import { describe, expect, it } from 'vitest'
import { LoadPluggyHistoryInteractor } from '../../../../src/interactors/pluggy-history/load/load-pluggy-history.interactor.js'
import type {
  CompletedScan,
  HistorySource,
  LoadPluggyHistoryGateway,
  PersistedPage,
} from '../../../../src/interactors/pluggy-history/load/load-pluggy-history.types.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

const ITEM_ID = '00000000-0000-0000-0000-000000000001'
const ITEM_UPDATED_AT = '2026-09-03T04:40:14.026Z'

const account = (id = 'acc-1', updatedAt?: Date): HistorySource => ({
  kind: 'ACCOUNT',
  referenceId: id,
  ...(updatedAt !== undefined ? { updatedAt } : { updatedAt: undefined }),
})
const investment = (id = 'inv-1', updatedAt?: Date): HistorySource => ({
  kind: 'INVESTMENT',
  referenceId: id,
  ...(updatedAt !== undefined ? { updatedAt } : { updatedAt: undefined }),
})

type Calls = {
  scanned: string[]
  completed: CompletedScan[]
  watermarks: Date[]
}

function buildGateway(overrides: Partial<LoadPluggyHistoryGateway> = {}): {
  gateway: LoadPluggyHistoryGateway
  calls: Calls
} {
  const calls: Calls = { scanned: [], completed: [], watermarks: [] }

  const gateway: LoadPluggyHistoryGateway = {
    addContext: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    readCurrentItemState: async () => ({
      executionStatus: 'SUCCESS',
      lastUpdatedAt: ITEM_UPDATED_AT,
      cashProduct: { limitedByRateLimit: false, warningCodes: [] },
      custodyProduct: { limitedByRateLimit: false, warningCodes: [] },
    }),
    readLastSyncedHistoryWatermark: async () => undefined,
    readCashSources: async () => [account()],
    readCustodySources: async () => [investment()],
    readSourceObservation: async () => ({ sourceUpdatedAt: undefined }),
     
    scanSource: async function* (_itemId, source) {
      calls.scanned.push(`${source.kind}:${source.referenceId}`)
      yield { count: 1, oldestAt: new Date('2025-08-29T00:00:00.000Z'), newestAt: new Date('2026-09-01T00:00:00.000Z') }
    },
    saveCompletedScan: async (_itemId, scan) => {
      calls.completed.push(scan)
    },
    advanceHistoryWatermark: async (_itemId, at) => {
      calls.watermarks.push(at)
    },
    assertItemAccess: async () => {},
    ...overrides,
  }

  return { gateway, calls }
}

const buildInteractor = (gateway: LoadPluggyHistoryGateway) =>
  new LoadPluggyHistoryInteractor({ loadPluggyHistoryImpl: gateway } as unknown as AppContainer)

describe('LoadPluggyHistoryInteractor', () => {
  it('primeira carga varre caixa e custódia e só então avança a marca d’água', async () => {
    const { gateway, calls } = buildGateway()

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(result.data).toEqual({
      loaded: true,
      sourcesScanned: 2,
      transactionsObserved: 2,
      sourcesRefused: [],
    })
    expect(calls.scanned).toEqual(['ACCOUNT:acc-1', 'INVESTMENT:inv-1'])
    expect(calls.completed).toHaveLength(2)
    expect(calls.watermarks).toEqual([new Date(ITEM_UPDATED_AT)])
  })

  it('dia sem mudança faz zero chamadas de transação', async () => {
    const { gateway, calls } = buildGateway({
      readLastSyncedHistoryWatermark: async () => new Date(ITEM_UPDATED_AT),
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(result.data?.loaded).toBe(false)
    expect(calls.scanned).toEqual([])
    expect(calls.watermarks).toEqual([])
  })

  it('recurso inalterado desde a última observação não é varrido de novo', async () => {
    const observedAt = new Date('2026-09-02T00:00:00.000Z')
    const { gateway, calls } = buildGateway({
      readLastSyncedHistoryWatermark: async () => new Date('2026-09-01T00:00:00.000Z'),
      readCashSources: async () => [account('acc-1', observedAt)],
      readCustodySources: async () => [],
      readSourceObservation: async () => ({ sourceUpdatedAt: observedAt }),
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(calls.scanned).toEqual([])
    expect(result.data?.sourcesScanned).toBe(0)
    // A marca d'água do item avança mesmo sem fonte elegível: o item mudou, as fontes é que não.
    expect(calls.watermarks).toEqual([new Date(ITEM_UPDATED_AT)])
  })

  it('recurso sem updatedAt é varrido integralmente, nunca presumido inalterado', async () => {
    const { gateway, calls } = buildGateway({
      readLastSyncedHistoryWatermark: async () => new Date('2026-09-01T00:00:00.000Z'),
      readCashSources: async () => [account('acc-1', undefined)],
      readCustodySources: async () => [],
      readSourceObservation: async () => ({ sourceUpdatedAt: new Date('2026-09-02T00:00:00.000Z') }),
    })

    await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(calls.scanned).toEqual(['ACCOUNT:acc-1'])
  })

  it('investimento inalterado desde a última observação não é varrido de novo', async () => {
    // O caminho de custódia é o que estava quebrado: `readCustodySources` devolvia `updatedAt`
    // sempre undefined, então o portão nunca fechava e toda carga varria a custódia inteira, contra
    // o que a spec pluggy-transaction-history exige.
    const observedAt = new Date('2026-09-02T00:00:00.000Z')
    const { gateway, calls } = buildGateway({
      readLastSyncedHistoryWatermark: async () => new Date('2026-09-01T00:00:00.000Z'),
      readCashSources: async () => [],
      readCustodySources: async () => [investment('inv-1', observedAt)],
      readSourceObservation: async () => ({ sourceUpdatedAt: observedAt }),
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(calls.scanned).toEqual([])
    expect(result.data?.sourcesScanned).toBe(0)
  })

  it('investimento com updatedAt mais novo que a observação é varrido', async () => {
    const { gateway, calls } = buildGateway({
      readLastSyncedHistoryWatermark: async () => new Date('2026-09-01T00:00:00.000Z'),
      readCashSources: async () => [],
      readCustodySources: async () => [investment('inv-1', new Date('2026-09-03T00:00:00.000Z'))],
      readSourceObservation: async () => ({ sourceUpdatedAt: new Date('2026-09-02T00:00:00.000Z') }),
    })

    await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(calls.scanned).toEqual(['INVESTMENT:inv-1'])
  })

  it('produto limitado por rate limit recusa só aquela fonte, nomeando o produto', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () => ({
        executionStatus: 'PARTIAL_SUCCESS',
        lastUpdatedAt: ITEM_UPDATED_AT,
        cashProduct: { limitedByRateLimit: true, warningCodes: ['RATE_LIMIT'] },
        custodyProduct: { limitedByRateLimit: false, warningCodes: [] },
      }),
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(result.data?.sourcesRefused).toEqual(['caixa'])
    // Custódia segue: limitar um produto não pode derrubar o outro.
    expect(calls.scanned).toEqual(['INVESTMENT:inv-1'])
  })

  it('partial success sem limite no produto da fonte segue normalmente', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () => ({
        executionStatus: 'PARTIAL_SUCCESS',
        lastUpdatedAt: ITEM_UPDATED_AT,
        cashProduct: { limitedByRateLimit: false, warningCodes: ['SOME_OTHER_WARNING'] },
        custodyProduct: { limitedByRateLimit: false, warningCodes: [] },
      }),
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(result.data?.sourcesRefused).toEqual([])
    expect(calls.scanned).toEqual(['ACCOUNT:acc-1', 'INVESTMENT:inv-1'])
  })

  it('investimento sem movimentação grava contagem zero e datas nulas, não "período coberto"', async () => {
    const { gateway, calls } = buildGateway({
      readCashSources: async () => [],
      readCustodySources: async () => [investment('inv-vazio')],
       
      scanSource: async function* (): AsyncGenerator<PersistedPage> {
        yield { count: 0, oldestAt: undefined, newestAt: undefined }
      },
    })

    await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(calls.completed).toEqual([
      {
        kind: 'INVESTMENT',
        referenceId: 'inv-vazio',
        observedCount: 0,
        oldestObservedAt: undefined,
        newestObservedAt: undefined,
        sourceUpdatedAt: undefined,
      },
    ])
  })

  it('acumula a observação por todas as páginas antes de concluir a varredura', async () => {
    const { gateway, calls } = buildGateway({
      readCashSources: async () => [account('acc-1')],
      readCustodySources: async () => [],
      scanSource: async function* (): AsyncGenerator<PersistedPage> {
        yield { count: 2, oldestAt: new Date('2026-05-01T00:00:00.000Z'), newestAt: new Date('2026-06-01T00:00:00.000Z') }
        yield { count: 3, oldestAt: new Date('2025-08-29T00:00:00.000Z'), newestAt: new Date('2026-01-01T00:00:00.000Z') }
      },
    })

    await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(calls.completed[0]).toMatchObject({
      observedCount: 5,
      oldestObservedAt: new Date('2025-08-29T00:00:00.000Z'),
      newestObservedAt: new Date('2026-06-01T00:00:00.000Z'),
    })
  })

  it('falha no meio de uma fonte não grava conclusão nem avança a marca d’água', async () => {
    const { gateway, calls } = buildGateway({
      // eslint-disable-next-line require-yield
      scanSource: async function* (): AsyncGenerator<PersistedPage> {
        throw new ApplicationError('PLUGGY_TRANSACTIONS_UPSTREAM_ERROR', { status: 500 })
      },
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_TRANSACTIONS_UPSTREAM_ERROR')
    expect(calls.completed).toEqual([])
    expect(calls.watermarks).toEqual([])
  })

  it('item fora de SUCCESS/PARTIAL_SUCCESS não carrega nada', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () => ({
        executionStatus: 'LOGIN_ERROR',
        lastUpdatedAt: undefined,
        cashProduct: { limitedByRateLimit: false, warningCodes: [] },
        custodyProduct: { limitedByRateLimit: false, warningCodes: [] },
      }),
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(result.data?.loaded).toBe(false)
    expect(calls.scanned).toEqual([])
  })

  it('erro inesperado vira erro nomeado do caso de uso', async () => {
    const { gateway } = buildGateway({
      readCurrentItemState: async () => {
        throw new Error('socket hang up')
      },
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_HISTORY_LOAD_FAILED')
  })

  it('origem USER com item autorizado confere permissão e processa carga', async () => {
    let checkedPersonId: number | undefined
    const { gateway } = buildGateway({
      assertItemAccess: async (_itemId, personId) => {
        checkedPersonId = personId
      },
    })

    const result = await buildInteractor(gateway).execute({ origin: 'USER', personId: 42, itemId: ITEM_ID })

    expect(checkedPersonId).toBe(42)
    expect(result.data?.loaded).toBe(true)
  })

  it('origem USER com item não autorizado recusa antes de ler estado ou varrer fontes', async () => {
    let readItemCalled = false
    const { gateway } = buildGateway({
      assertItemAccess: async () => {
        throw new ApplicationError('PLUGGY_ITEM_UNAUTHORIZED', { itemId: ITEM_ID })
      },
      readCurrentItemState: async () => {
        readItemCalled = true
        throw new Error('não deveria chamar')
      },
    })

    const result = await buildInteractor(gateway).execute({ origin: 'USER', personId: 99, itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_ITEM_UNAUTHORIZED')
    expect(readItemCalled).toBe(false)
  })
})
