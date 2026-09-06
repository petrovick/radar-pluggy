import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { SyncPluggyPositionInteractor } from '../../../../src/interactors/pluggy-position/sync/sync-pluggy-position.interactor.js'
import type {
  PluggyConsentStatus,
  PluggyInvestmentInput,
  PluggyInvestmentsPage,
  PluggyLoanInput,
  PluggyLoansPage,
  SaveSyncedItemStateInput,
  SyncPluggyPositionGateway,
} from '../../../../src/interactors/pluggy-position/sync/sync-pluggy-position.types.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

// O caso de uso tem uma dependência só, o gateway dele: o teste inteiro é um fake dessa interface —
// zero rede, zero banco, zero Sequelize (arquitetura-camadas, regra 2). Mesmo formato dos testes de
// interactor do `oplab-radar-api`.

const ITEM_ID = '00000000-0000-0000-0000-000000000001'

function investment(overrides: Partial<PluggyInvestmentInput> = {}): PluggyInvestmentInput {
  return {
    investmentId: 'inv-1',
    itemId: ITEM_ID,
    type: 'EQUITY',
    subtype: 'STOCK',
    name: 'VIVT3',
    code: 'VIVT3',
    isin: 'BRVIVTACNOR0',
    currencyCode: 'BRL',
    balance: new Decimal('304.50'),
    quantity: new Decimal('10'),
    amountOriginal: undefined,
    value: new Decimal('30.45'),
    amount: new Decimal('304.50'),
    quotaDate: new Date('2026-09-03T03:00:00.000Z'),
    status: 'ACTIVE',
    institutionName: undefined,
    institutionNumber: undefined,
    issuerCnpj: undefined,
    number: undefined,
    amountWithdrawal: undefined,
    amountProfit: undefined,
    dueDate: undefined,
    issuer: undefined,
    issueDate: undefined,
    purchaseDate: undefined,
    rate: undefined,
    rateType: undefined,
    fixedAnnualRate: undefined,
    lastMonthRate: undefined,
    annualRate: undefined,
    lastTwelveMonthsRate: undefined,
    owner: undefined,
    metadata: undefined,
    raw: {},
    ...overrides,
  }
}

function page(results: PluggyInvestmentInput[], overrides: Partial<PluggyInvestmentsPage> = {}): PluggyInvestmentsPage {
  return { results, page: 1, total: results.length, totalPages: 1, ...overrides }
}

// Lado passivo (empréstimo) — mesma forma de `investment()`/`page()`, mesmo portão.
function loan(overrides: Partial<PluggyLoanInput> = {}): PluggyLoanInput {
  return {
    loanId: 'loan-1',
    itemId: ITEM_ID,
    contractNumber: '12345',
    productName: 'Crédito Pessoal',
    type: 'CREDITO_PESSOAL_SEM_CONSIGNACAO',
    kind: 'LOAN',
    collectedAt: new Date('2026-09-03T03:00:00.000Z'),
    contractDate: new Date('2026-01-01T00:00:00.000Z'),
    settlementDate: undefined,
    contractAmount: new Decimal('10000.00'),
    currencyCode: 'BRL',
    dueDate: new Date('2028-01-01T00:00:00.000Z'),
    totalInstallments: 24,
    paidInstallments: 5,
    dueInstallments: 19,
    pastDueInstallments: 0,
    outstandingBalance: new Decimal('8000.00'),
    ipocCode: undefined,
    disbursementDates: undefined,
    firstInstallmentDueDate: undefined,
    cet: undefined,
    installmentPeriodicity: undefined,
    installmentPeriodicityAdditionalInfo: undefined,
    amortizationScheduled: undefined,
    amortizationScheduledAdditionalInfo: undefined,
    cnpjConsignee: undefined,
    interestRates: undefined,
    contractedFees: undefined,
    contractedFinanceCharges: undefined,
    warranties: undefined,
    installments: undefined,
    payments: undefined,
    raw: {},
    ...overrides,
  }
}

function loansPage(results: PluggyLoanInput[], overrides: Partial<PluggyLoansPage> = {}): PluggyLoansPage {
  return { results, page: 1, total: results.length, totalPages: 1, ...overrides }
}

type Calls = {
  investmentPages: number[]
  saved: PluggyInvestmentInput[][]
  savedSyncedAt: Date[]
  itemStates: SaveSyncedItemStateInput[]
  consentStatuses: PluggyConsentStatus[]
  loanPages: number[]
  savedLoans: PluggyLoanInput[][]
  savedLoansSyncedAt: Date[]
}

function buildGateway(overrides: Partial<SyncPluggyPositionGateway> = {}): {
  gateway: SyncPluggyPositionGateway
  calls: Calls
} {
  const calls: Calls = {
    investmentPages: [],
    saved: [],
    savedSyncedAt: [],
    itemStates: [],
    consentStatuses: [],
    loanPages: [],
    savedLoans: [],
    savedLoansSyncedAt: [],
  }

  const gateway: SyncPluggyPositionGateway = {
    addContext: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    readCurrentItemState: async () => ({
      status: 'UPDATED',
      executionStatus: 'SUCCESS',
      lastUpdatedAt: '2026-09-03T04:40:14.026Z',
      raw: {},
    }),
    readConsentStatus: async () => ({
      kind: 'ACTIVE',
      consentId: 'consent-1',
      grantedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: undefined,
      revokedAt: undefined,
      products: undefined,
      openFinancePermissionsGranted: undefined,
      raw: {},
    }),
    saveConsentStatus: async (_itemId, status) => {
      calls.consentStatuses.push(status)
    },
    readInvestmentsPage: async (_itemId, requestedPage) => {
      calls.investmentPages.push(requestedPage)
      return page([investment()], { page: requestedPage })
    },
    readLastSyncedItemState: async () => undefined,
    savePositionsWithSnapshots: async (investments, syncedAt) => {
      calls.saved.push(investments)
      calls.savedSyncedAt.push(syncedAt)
    },
    readLoansPage: async (_itemId, requestedPage) => {
      calls.loanPages.push(requestedPage)
      return loansPage([loan()], { page: requestedPage })
    },
    saveLoansWithSnapshots: async (loans, syncedAt) => {
      calls.savedLoans.push(loans)
      calls.savedLoansSyncedAt.push(syncedAt)
    },
    saveSyncedItemState: async (input) => {
      calls.itemStates.push(input)
    },
    ...overrides,
  }

  return { gateway, calls }
}

const buildInteractor = (gateway: SyncPluggyPositionGateway) =>
  new SyncPluggyPositionInteractor({ syncPluggyPositionImpl: gateway } as unknown as AppContainer)

describe('SyncPluggyPositionInteractor', () => {
  it('sincroniza, persiste tudo (investimento e empréstimo) e só então avança a marca d’água', async () => {
    const { gateway, calls } = buildGateway()

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error).toBeUndefined()
    expect(result.data).toEqual({ synced: true, positionsSynced: 1, loansSynced: 1 })
    expect(calls.saved).toHaveLength(1)
    expect(calls.savedLoans).toHaveLength(1)
    expect(calls.itemStates).toHaveLength(1)
    expect(calls.itemStates[0]?.lastUpdatedAt).toEqual(new Date('2026-09-03T04:40:14.026Z'))
  })

  it('item sem mudança não gera nenhuma chamada de investimentos, de empréstimo nem de consentimento', async () => {
    const { gateway, calls } = buildGateway({
      readLastSyncedItemState: async () => ({ getLastUpdatedAt: () => new Date('2026-09-03T04:40:14.026Z') }),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.data).toEqual({ synced: false, positionsSynced: 0, loansSynced: 0 })
    expect(calls.investmentPages).toEqual([])
    expect(calls.saved).toEqual([])
    expect(calls.consentStatuses).toEqual([])
    expect(calls.loanPages).toEqual([])
    expect(calls.savedLoans).toEqual([])
  })

  it('portão aberto persiste empréstimos junto com investimentos, com o mesmo syncedAt', async () => {
    const { gateway, calls } = buildGateway()

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error).toBeUndefined()
    expect(calls.loanPages).toEqual([1])
    expect(calls.savedLoans).toHaveLength(1)
    expect(calls.savedLoans[0]).toHaveLength(1)
    expect(calls.savedLoans[0]?.[0]?.loanId).toBe('loan-1')
    // A regra que o nome do teste anuncia: a mesma instância de syncedAt vai para as duas
    // persistências — se o interactor gerar dois `new Date()` distintos, esta asserção acusa.
    expect(calls.savedSyncedAt).toHaveLength(1)
    expect(calls.savedLoansSyncedAt[0]).toEqual(calls.savedSyncedAt[0])
  })

  it('percorre todas as páginas de empréstimo e persiste todos', async () => {
    const { gateway, calls } = buildGateway({
      readLoansPage: async (_itemId, requestedPage) => {
        calls.loanPages.push(requestedPage)
        return loansPage([loan({ loanId: `loan-${requestedPage}` })], {
          page: requestedPage,
          totalPages: 2,
          total: 2,
        })
      },
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error).toBeUndefined()
    expect(calls.loanPages).toEqual([1, 2])
    expect(calls.savedLoans[0]).toHaveLength(2)
  })

  it('lista de empréstimos vazia com portão aberto é legítima — nem todo item tem dívida', async () => {
    const { gateway, calls } = buildGateway({
      readLoansPage: async () => loansPage([]),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error).toBeUndefined()
    expect(result.data).toEqual({ synced: true, positionsSynced: 1, loansSynced: 0 })
    expect(calls.savedLoans[0]).toEqual([])
  })

  it('página de empréstimo divergente da requisitada recusa sem persistir nada, nem investimento nem empréstimo', async () => {
    const { gateway, calls } = buildGateway({
      readLoansPage: async () => loansPage([loan()], { page: 9, totalPages: 2 }),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_LOANS_PAGE_MISMATCH')
    expect(calls.saved).toEqual([])
    expect(calls.savedLoans).toEqual([])
    expect(calls.itemStates).toEqual([])
  })

  it('totalPages de empréstimo mudando durante a varredura recusa sem persistir nada', async () => {
    let call = 0
    const { gateway, calls } = buildGateway({
      readLoansPage: async (_itemId, requestedPage) => {
        call++
        return loansPage([loan()], { page: requestedPage, totalPages: call === 1 ? 3 : 5 })
      },
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_LOANS_TOTAL_PAGES_CHANGED')
    expect(calls.saved).toEqual([])
    expect(calls.savedLoans).toEqual([])
    expect(calls.itemStates).toEqual([])
  })

  it('consentimento expirado recusa nomeado antes de gastar chamada de investimentos', async () => {
    const { gateway, calls } = buildGateway({
      readConsentStatus: async () => ({
        kind: 'EXPIRED',
        consentId: 'consent-1',
        grantedAt: new Date('2025-01-01T00:00:00.000Z'),
        expiresAt: new Date('2026-01-01T00:00:00.000Z'),
        revokedAt: undefined,
        products: undefined,
        openFinancePermissionsGranted: undefined,
        raw: {},
      }),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_CONSENT_EXPIRED')
    expect(calls.investmentPages).toEqual([])
    expect(calls.saved).toEqual([])
    expect(calls.itemStates).toEqual([])
    expect(calls.consentStatuses).toHaveLength(1)
  })

  it('consentimento revogado recusa nomeado antes de gastar chamada de investimentos', async () => {
    const { gateway, calls } = buildGateway({
      readConsentStatus: async () => ({
        kind: 'REVOKED',
        consentId: 'consent-1',
        grantedAt: new Date('2025-01-01T00:00:00.000Z'),
        expiresAt: undefined,
        revokedAt: new Date('2026-02-01T00:00:00.000Z'),
        products: undefined,
        openFinancePermissionsGranted: undefined,
        raw: {},
      }),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_CONSENT_REVOKED')
    expect(calls.investmentPages).toEqual([])
    expect(calls.saved).toEqual([])
    expect(calls.itemStates).toEqual([])
  })

  it('sem nenhum consentimento registrado recusa nomeado antes de gastar chamada de investimentos', async () => {
    const { gateway, calls } = buildGateway({
      readConsentStatus: async () => ({ kind: 'NOT_FOUND' }),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_CONSENT_NOT_FOUND')
    expect(calls.investmentPages).toEqual([])
    expect(calls.saved).toEqual([])
    expect(calls.itemStates).toEqual([])
  })

  it('executionStatus diferente de SUCCESS não sincroniza', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () => ({ status: 'UPDATING', executionStatus: 'PARTIAL_SUCCESS', lastUpdatedAt: undefined, raw: {} }),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.data).toEqual({ synced: false, positionsSynced: 0, loansSynced: 0 })
    expect(calls.investmentPages).toEqual([])
  })

  it('SUCCESS sem lastUpdatedAt é recusa nomeada, não portão fechado em silêncio', async () => {
    const { gateway } = buildGateway({
      readCurrentItemState: async () => ({ status: 'UPDATED', executionStatus: 'SUCCESS', lastUpdatedAt: undefined, raw: {} }),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.data).toBeUndefined()
    expect(result.error).toBeInstanceOf(ApplicationError)
    expect(result.error?.errorType).toBe('PLUGGY_ITEM_SUCCESS_WITHOUT_LAST_UPDATED_AT')
  })

  it('percorre todas as páginas e persiste a carteira inteira', async () => {
    const { gateway, calls } = buildGateway({
      readInvestmentsPage: async (_itemId, requestedPage) => {
        calls.investmentPages.push(requestedPage)
        return page([investment({ investmentId: `inv-${requestedPage}` })], {
          page: requestedPage,
          totalPages: 3,
          total: 3,
        })
      },
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(calls.investmentPages).toEqual([1, 2, 3])
    expect(result.data).toEqual({ synced: true, positionsSynced: 3, loansSynced: 1 })
  })

  it('página devolvida diferente da requisitada recusa sem persistir', async () => {
    const { gateway, calls } = buildGateway({
      readInvestmentsPage: async () => page([investment()], { page: 9, totalPages: 2 }),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_INVESTMENTS_PAGE_MISMATCH')
    expect(calls.saved).toEqual([])
    expect(calls.itemStates).toEqual([])
  })

  it('totalPages mudando durante a varredura recusa sem persistir', async () => {
    let call = 0
    const { gateway, calls } = buildGateway({
      readInvestmentsPage: async (_itemId, requestedPage) => {
        call++
        return page([investment()], { page: requestedPage, totalPages: call === 1 ? 3 : 5 })
      },
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_INVESTMENTS_TOTAL_PAGES_CHANGED')
    expect(calls.saved).toEqual([])
    expect(calls.itemStates).toEqual([])
  })

  it('lista vazia com portão aberto é recusa nomeada, sem apagar posição existente', async () => {
    const { gateway, calls } = buildGateway({
      readInvestmentsPage: async () => page([]),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_INVESTMENTS_EMPTY_WITH_SUCCESS_STATUS')
    expect(calls.saved).toEqual([])
    expect(calls.itemStates).toEqual([])
  })

  it('falha ao persistir não avança a marca d’água', async () => {
    const { gateway, calls } = buildGateway({
      savePositionsWithSnapshots: async () => {
        throw new ApplicationError('PLUGGY_POSITION_SNAPSHOT_WRITE_FAILED', { itemId: ITEM_ID })
      },
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_POSITION_SNAPSHOT_WRITE_FAILED')
    expect(calls.itemStates).toEqual([])
  })

  it('erro inesperado vira erro nomeado do caso de uso, nunca vaza o erro cru', async () => {
    const { gateway } = buildGateway({
      readCurrentItemState: async () => {
        throw new Error('socket hang up')
      },
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error).toBeInstanceOf(ApplicationError)
    expect(result.error?.errorType).toBe('PLUGGY_POSITION_SYNC_FAILED')
  })

  it('erro inesperado ao ler consentimento também vira erro nomeado do caso de uso', async () => {
    const { gateway } = buildGateway({
      readConsentStatus: async () => {
        throw new Error('socket hang up')
      },
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error).toBeInstanceOf(ApplicationError)
    expect(result.error?.errorType).toBe('PLUGGY_POSITION_SYNC_FAILED')
  })
})
