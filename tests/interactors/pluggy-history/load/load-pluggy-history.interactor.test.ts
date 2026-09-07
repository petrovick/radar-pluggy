import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { LoadPluggyHistoryInteractor } from '../../../../src/interactors/pluggy-history/load/load-pluggy-history.interactor.js'
import type {
  CompletedScan,
  CurrentItemHistoryState,
  HistorySource,
  LoadPluggyHistoryGateway,
  PersistedPage,
} from '../../../../src/interactors/pluggy-history/load/load-pluggy-history.types.js'
import type { PluggySource } from '../../../../src/adapters/gateways/pluggy-source-catalog.js'
import type { PluggyAccountDto } from '../../../../src/adapters/gateways/pluggy-accounts.gateway.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

const ITEM_ID = '00000000-0000-0000-0000-000000000001'
const ITEM_UPDATED_AT = '2026-09-03T04:40:14.026Z'
// Habilita as quatro fontes de histórico (D26) — `ProductType` do catálogo (com "S"), não o
// vocabulário de domínio.
const ALL_PRODUCTS = ['ACCOUNTS', 'TRANSACTIONS', 'INVESTMENTS', 'INVESTMENTS_TRANSACTIONS']

// DTO mínimo (revisão do review externo ao PR #14): `readCashSources` sempre preenche `.account` em
// todo `HistorySource` de contas — `toDiscoveredAccounts` (no interactor) lança se estiver ausente.
function fakeAccountDto(accountId: string): PluggyAccountDto {
  const now = new Date('2026-08-01T00:00:00.000Z')
  return {
    itemId: ITEM_ID,
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

const account = (id = 'acc-1', updatedAt?: Date): HistorySource => ({
  kind: 'ACCOUNT',
  referenceId: id,
  updatedAt,
  account: fakeAccountDto(id),
})
const investment = (id = 'inv-1', updatedAt?: Date): HistorySource => ({
  kind: 'INVESTMENT',
  referenceId: id,
  updatedAt,
})

function itemState(overrides: Partial<CurrentItemHistoryState> = {}): CurrentItemHistoryState {
  return {
    executionStatus: 'SUCCESS',
    lastUpdatedAt: ITEM_UPDATED_AT,
    updatedAt: ITEM_UPDATED_AT,
    itemProducts: ALL_PRODUCTS,
    products: {},
    ...overrides,
  }
}

type Calls = {
  scanned: string[]
  completed: CompletedScan[]
  advanced: { source: PluggySource; versionAt: Date }[]
  cashDiscovered: number
  custodyDiscovered: number
}

function buildGateway(overrides: Partial<LoadPluggyHistoryGateway> = {}): {
  gateway: LoadPluggyHistoryGateway
  calls: Calls
} {
  const calls: Calls = { scanned: [], completed: [], advanced: [], cashDiscovered: 0, custodyDiscovered: 0 }

  const gateway: LoadPluggyHistoryGateway = {
    addContext: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    readCurrentItemState: async () => itemState(),
    readSyncProgress: async () => undefined,
    advanceSyncProgress: async (_itemId, source, versionAt) => {
      calls.advanced.push({ source, versionAt })
    },
    readCashSources: async () => {
      calls.cashDiscovered++
      return [account()]
    },
    readCustodySources: async () => {
      calls.custodyDiscovered++
      return [investment()]
    },
    commitAccountsDiscovery: async (_itemId, _accounts, versionAt) => {
      calls.advanced.push({ source: 'ACCOUNTS', versionAt })
      return true
    },

    scanSource: async function* (_itemId, source) {
      calls.scanned.push(`${source.kind}:${source.referenceId}`)
      yield { count: 1, oldestAt: new Date('2025-08-29T00:00:00.000Z'), newestAt: new Date('2026-09-01T00:00:00.000Z') }
    },
    saveCompletedScan: async (_itemId, scan) => {
      calls.completed.push(scan)
    },
    assertItemAccess: async () => {},
    ...overrides,
  }

  return { gateway, calls }
}

const buildInteractor = (gateway: LoadPluggyHistoryGateway) =>
  new LoadPluggyHistoryInteractor({ loadPluggyHistoryImpl: gateway } as unknown as AppContainer)

describe('LoadPluggyHistoryInteractor', () => {
  it('primeira carga (nenhuma marca d’água prévia) varre caixa e custódia e avança as quatro fontes', async () => {
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
    expect(calls.advanced.map((a) => a.source).sort()).toEqual(
      ['ACCOUNTS', 'ACCOUNT_TRANSACTIONS', 'INVESTMENTS', 'INVESTMENT_TRANSACTIONS'].sort(),
    )
    expect(calls.advanced.every((a) => a.versionAt.toISOString() === ITEM_UPDATED_AT)).toBe(true)
  })

  it('dia sem mudança faz zero chamadas de transação nem de descoberta', async () => {
    const upToDate = new Date(ITEM_UPDATED_AT)
    const { gateway, calls } = buildGateway({ readSyncProgress: async () => upToDate })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(result.data?.loaded).toBe(true)
    expect(result.data?.sourcesScanned).toBe(0)
    expect(calls.scanned).toEqual([])
    expect(calls.advanced).toEqual([])
    expect(calls.cashDiscovered).toBe(0)
    expect(calls.custodyDiscovered).toBe(0)
  })

  it('um agrupamento avança sem esperar o outro: só custódia desatualizada varre só custódia', async () => {
    const { gateway, calls } = buildGateway({
      readSyncProgress: async (_itemId, source) =>
        source === 'INVESTMENTS' || source === 'INVESTMENT_TRANSACTIONS' ? undefined : new Date(ITEM_UPDATED_AT),
    })

    await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(calls.scanned).toEqual(['INVESTMENT:inv-1'])
    expect(calls.cashDiscovered).toBe(0)
  })

  it('conta com updatedAt inalterado ainda tem suas transações varridas (D14: updatedAt do recurso nunca é gate)', async () => {
    const { gateway, calls } = buildGateway({
      readCashSources: async () => [account('acc-1', new Date('2020-01-01T00:00:00.000Z'))],
    })

    await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(calls.scanned).toContain('ACCOUNT:acc-1')
  })

  it('ACCOUNT_TRANSACTIONS não avança sem ACCOUNTS utilizável na mesma execução (D13)', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () =>
        itemState({
          executionStatus: 'PARTIAL_SUCCESS',
          itemProducts: ['ACCOUNTS', 'TRANSACTIONS'],
          products: {
            accounts: { isUpdated: false, lastUpdatedAt: undefined, warnings: [] },
            transactions: { isUpdated: true, lastUpdatedAt: ITEM_UPDATED_AT, warnings: [] },
          },
        }),
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(calls.cashDiscovered).toBe(0)
    expect(calls.scanned).not.toContain('ACCOUNT:acc-1')
    expect(calls.advanced.map((a) => a.source)).not.toContain('ACCOUNT_TRANSACTIONS')
    expect(result.data?.sourcesRefused).toEqual(['ACCOUNTS'])
  })

  it('ACCOUNTS avança sozinha, independente do estado de ACCOUNT_TRANSACTIONS', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () =>
        itemState({
          executionStatus: 'PARTIAL_SUCCESS',
          itemProducts: ['ACCOUNTS', 'TRANSACTIONS'],
          products: {
            accounts: { isUpdated: true, lastUpdatedAt: '2026-09-05T00:00:00.000Z', warnings: [] },
            transactions: { isUpdated: false, lastUpdatedAt: undefined, warnings: [] },
          },
        }),
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(calls.advanced).toEqual([{ source: 'ACCOUNTS', versionAt: new Date('2026-09-05T00:00:00.000Z') }])
    expect(result.data?.sourcesRefused).toEqual(['ACCOUNT_TRANSACTIONS'])
  })

  it('fonte não habilitada para o Item nunca é elegível, mesmo sem marca d’água prévia (D26)', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () => itemState({ itemProducts: ['ACCOUNTS', 'TRANSACTIONS'] }),
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(calls.custodyDiscovered).toBe(0)
    expect(calls.scanned).toEqual(['ACCOUNT:acc-1'])
    // Não habilitada nunca aparece como "recusada" — recusa é só para elegível-mas-não-utilizável.
    expect(result.data?.sourcesRefused).toEqual([])
  })

  it('itemProducts UNKNOWN (undefined) nunca vira elegibilidade por omissão', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () => itemState({ itemProducts: undefined }),
    })

    await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(calls.cashDiscovered).toBe(0)
    expect(calls.custodyDiscovered).toBe(0)
  })

  it('produto recusado (PARTIAL_SUCCESS, isUpdated !== true) refuta só aquela fonte, custódia segue', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () =>
        itemState({
          executionStatus: 'PARTIAL_SUCCESS',
          products: {
            accounts: { isUpdated: false, lastUpdatedAt: undefined, warnings: [{ code: 'RATE_LIMIT', message: 'x' }] },
            transactions: { isUpdated: false, lastUpdatedAt: undefined, warnings: [] },
            investments: { isUpdated: true, lastUpdatedAt: ITEM_UPDATED_AT, warnings: [] },
            investmentTransactions: { isUpdated: true, lastUpdatedAt: ITEM_UPDATED_AT, warnings: [] },
          },
        }),
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(result.data?.sourcesRefused.sort()).toEqual(['ACCOUNTS', 'ACCOUNT_TRANSACTIONS'].sort())
    // Custódia segue: limitar um produto não pode derrubar o outro.
    expect(calls.scanned).toEqual(['INVESTMENT:inv-1'])
  })

  it('partial success sem limite no produto da fonte segue normalmente', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () =>
        itemState({
          executionStatus: 'PARTIAL_SUCCESS',
          products: {
            accounts: { isUpdated: true, lastUpdatedAt: ITEM_UPDATED_AT, warnings: ['SOME_OTHER_WARNING'].map((code) => ({ code, message: 'x' })) },
            transactions: { isUpdated: true, lastUpdatedAt: ITEM_UPDATED_AT, warnings: [] },
            investments: { isUpdated: true, lastUpdatedAt: ITEM_UPDATED_AT, warnings: [] },
            investmentTransactions: { isUpdated: true, lastUpdatedAt: ITEM_UPDATED_AT, warnings: [] },
          },
        }),
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(result.data?.sourcesRefused).toEqual([])
    expect(calls.scanned).toEqual(['ACCOUNT:acc-1', 'INVESTMENT:inv-1'])
  })

  it('leitura autoritativa de contas reconcilia a fotografia atual só quando ACCOUNTS é utilizável', async () => {
    let reconciledIds: string[] | undefined
    let reconciledVersion: Date | undefined
    const { gateway } = buildGateway({
      readCashSources: async () => [account('acc-1'), account('acc-2')],
      commitAccountsDiscovery: async (_itemId, accounts, versionAt) => {
        reconciledIds = accounts.map((a) => a.accountId)
        reconciledVersion = versionAt
        return true
      },
    })

    await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(reconciledIds).toEqual(['acc-1', 'acc-2'])
    expect(reconciledVersion).toEqual(new Date(ITEM_UPDATED_AT))
  })

  it('versão mais antiga que perde a corrida do commit de contas nunca impede a varredura de transações', async () => {
    const { gateway, calls } = buildGateway({
      commitAccountsDiscovery: async () => false,
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(result.error).toBeUndefined()
    // A varredura de transações roda independente do resultado do commit de descoberta — só o
    // avanço de ACCOUNTS em si é que não regride.
    expect(calls.scanned).toContain('ACCOUNT:acc-1')
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

  it('falha no meio de uma fonte não grava conclusão nem avança a marca d’água DAQUELA fonte, mas a fonte-base já concluída permanece', async () => {
    const { gateway, calls } = buildGateway({
      // eslint-disable-next-line require-yield
      scanSource: async function* (): AsyncGenerator<PersistedPage> {
        throw new ApplicationError('PLUGGY_TRANSACTIONS_UPSTREAM_ERROR', { status: 500 })
      },
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_TRANSACTIONS_UPSTREAM_ERROR')
    expect(calls.completed).toEqual([])
    // ACCOUNTS (fonte-base) já tinha concluído descoberta+reconciliação antes da varredura de
    // transações falhar — sua própria marca d'água avança independente (D4/D15): não é refeita à
    // toa na próxima tentativa. `ACCOUNT_TRANSACTIONS`/`INVESTMENTS`/`INVESTMENT_TRANSACTIONS`
    // nunca chegam a avançar (a exceção interrompe o resto do `execute` antes de processar custódia).
    expect(calls.advanced).toEqual([{ source: 'ACCOUNTS', versionAt: new Date(ITEM_UPDATED_AT) }])
  })

  it('PARTIAL_SUCCESS com isUpdated true e lastUpdatedAt ausente recusa nomeado, propagando o erro', async () => {
    const { gateway } = buildGateway({
      readCurrentItemState: async () =>
        itemState({
          executionStatus: 'PARTIAL_SUCCESS',
          products: { accounts: { isUpdated: true, lastUpdatedAt: undefined, warnings: [] } },
        }),
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_ITEM_PRODUCT_UPDATED_WITHOUT_LAST_UPDATED_AT')
  })

  it('item fora de SUCCESS/PARTIAL_SUCCESS não carrega nada', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () => itemState({ executionStatus: 'LOGIN_ERROR', lastUpdatedAt: undefined }),
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

  it('lease perdido antes de descobrir contas/investimentos recusa sem escanear nem reconciliar', async () => {
    const { gateway, calls } = buildGateway()

    const result = await buildInteractor(gateway).execute({
      origin: 'INTERNAL_DRAINER',
      itemId: ITEM_ID,
      leaseGuard: { isLost: () => true },
    })

    expect(result.error?.errorType).toBe('PLUGGY_ITEM_INGESTION_LEASE_LOST')
    expect(calls.cashDiscovered).toBe(0)
    expect(calls.custodyDiscovered).toBe(0)
    expect(calls.scanned).toEqual([])
    expect(calls.advanced).toEqual([])
  })

  // Revisão do PR #14: CREDIT_CARDS é o segundo produto de origem de ACCOUNTS (GET /accounts devolve
  // BANK e CREDIT juntos) — um Item habilitado só com CREDIT_CARDS (sem ACCOUNTS) ainda precisa
  // descobrir a conta de cartão e varrer suas transações; antes desta correção, ACCOUNT_TRANSACTIONS
  // nunca avançava porque dependia só de `ACCOUNTS.usable`, e ACCOUNTS nunca era sequer elegível.
  it('Item com CREDIT_CARDS + TRANSACTIONS, sem ACCOUNTS: conta CREDIT é descoberta e transações são varridas', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () => itemState({ itemProducts: ['CREDIT_CARDS', 'TRANSACTIONS'] }),
      readCashSources: async () => {
        calls.cashDiscovered++
        return [account('acc-credit')]
      },
    })

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(result.error).toBeUndefined()
    expect(calls.cashDiscovered).toBe(1)
    expect(calls.scanned).toEqual(['ACCOUNT:acc-credit'])
    expect(calls.advanced.map((a) => a.source).sort()).toEqual(['ACCOUNTS', 'ACCOUNT_TRANSACTIONS'].sort())
    expect(result.data?.sourcesRefused).toEqual([])
  })

  it('revisão PR #14: lease já perdido antes de qualquer chamada nunca dispara readCurrentItemState (fetchItem real)', async () => {
    let readCurrentItemStateCalled = false
    const { gateway } = buildGateway({
      readCurrentItemState: async () => {
        readCurrentItemStateCalled = true
        throw new Error('não deveria ser chamado com lease já perdido')
      },
    })

    const result = await buildInteractor(gateway).execute({
      origin: 'INTERNAL_DRAINER',
      itemId: ITEM_ID,
      leaseGuard: { isLost: () => true },
    })

    expect(result.error?.errorType).toBe('PLUGGY_ITEM_INGESTION_LEASE_LOST')
    expect(readCurrentItemStateCalled).toBe(false)
  })

  it('lease perdido logo após a primeira página de uma fonte interrompe antes de pedir a próxima, sem gravar conclusão', async () => {
    let secondPageRequested = false
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () => itemState({ itemProducts: ['ACCOUNTS', 'TRANSACTIONS'] }),
      readCashSources: async () => [account('acc-1')],
      scanSource: async function* (): AsyncGenerator<PersistedPage> {
        yield { count: 1, oldestAt: new Date('2026-05-01T00:00:00.000Z'), newestAt: new Date('2026-06-01T00:00:00.000Z') }
        secondPageRequested = true
        yield { count: 1, oldestAt: new Date('2026-05-01T00:00:00.000Z'), newestAt: new Date('2026-06-01T00:00:00.000Z') }
      },
    })
    // As três primeiras checagens (upfront no início de `execute`, antes de descobrir, antes de
    // reconciliar/avançar ACCOUNTS) encontram o lease ainda vivo; a quarta, logo após a 1ª página da
    // varredura, encontra a perda.
    let checks = 0
    const leaseGuard = {
      isLost: () => {
        checks++
        return checks > 3
      },
    }

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID, leaseGuard })

    expect(result.error?.errorType).toBe('PLUGGY_ITEM_INGESTION_LEASE_LOST')
    expect(secondPageRequested).toBe(false)
    expect(calls.completed).toEqual([])
  })

  it('sem leaseGuard, comportamento é o de sempre — nunca recusa por posse', async () => {
    const { gateway, calls } = buildGateway()

    const result = await buildInteractor(gateway).execute({ origin: 'INTERNAL_DRAINER', itemId: ITEM_ID })

    expect(result.error).toBeUndefined()
    expect(calls.scanned).toEqual(['ACCOUNT:acc-1', 'INVESTMENT:inv-1'])
  })
})
