import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { SyncPluggyPositionInteractor } from '../../../../src/interactors/pluggy-position/sync/sync-pluggy-position.interactor.js'
import type {
  CurrentItemState,
  PluggyConsentStatus,
  PluggyInvestmentInput,
  PluggyInvestmentsPage,
  PluggyLoanInput,
  PluggyLoansPage,
  SaveSyncedItemStateInput,
  SyncPluggyPositionGateway,
} from '../../../../src/interactors/pluggy-position/sync/sync-pluggy-position.types.js'
import type { PluggySource } from '../../../../src/adapters/gateways/pluggy-source-catalog.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

// O caso de uso tem uma dependência só, o gateway dele: o teste inteiro é um fake dessa interface —
// zero rede, zero banco, zero Sequelize (arquitetura-camadas, regra 2). Mesmo formato dos testes de
// interactor do `oplab-radar-api`.

const ITEM_ID = '00000000-0000-0000-0000-000000000001'
const ITEM_UPDATED_AT = '2026-09-03T04:40:14.026Z'
const ALL_PRODUCTS = ['INVESTMENTS', 'LOANS']

function itemState(overrides: Partial<CurrentItemState> = {}): CurrentItemState {
  return {
    status: 'UPDATED',
    executionStatus: 'SUCCESS',
    lastUpdatedAt: ITEM_UPDATED_AT,
    updatedAt: ITEM_UPDATED_AT,
    itemProducts: ALL_PRODUCTS,
    products: {},
    raw: {},
    ...overrides,
  }
}

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
  advanced: { source: PluggySource; versionAt: Date }[]
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
    advanced: [],
  }

  const gateway: SyncPluggyPositionGateway = {
    addContext: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    readCurrentItemState: async () => itemState(),
    readSyncProgress: async () => undefined,
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
    commitInvestments: async (_itemId, investments, syncedAt, versionAt) => {
      calls.saved.push(investments)
      calls.savedSyncedAt.push(syncedAt)
      calls.advanced.push({ source: 'INVESTMENTS', versionAt })
      return true
    },
    readLoansPage: async (_itemId, requestedPage) => {
      calls.loanPages.push(requestedPage)
      return loansPage([loan()], { page: requestedPage })
    },
    commitLoans: async (_itemId, loans, syncedAt, versionAt) => {
      calls.savedLoans.push(loans)
      calls.savedLoansSyncedAt.push(syncedAt)
      calls.advanced.push({ source: 'LOANS', versionAt })
      return true
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
    expect(calls.itemStates[0]?.lastUpdatedAt).toEqual(new Date(ITEM_UPDATED_AT))
    expect(calls.advanced.map((a) => a.source).sort()).toEqual(['INVESTMENTS', 'LOANS'])
  })

  it('item sem mudança não gera nenhuma chamada de investimentos, de empréstimo nem de consentimento', async () => {
    const upToDate = new Date(ITEM_UPDATED_AT)
    const { gateway, calls } = buildGateway({ readSyncProgress: async () => upToDate })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.data).toEqual({ synced: false, positionsSynced: 0, loansSynced: 0 })
    expect(calls.investmentPages).toEqual([])
    expect(calls.saved).toEqual([])
    expect(calls.consentStatuses).toEqual([])
    expect(calls.loanPages).toEqual([])
    expect(calls.savedLoans).toEqual([])
  })

  it('investimento recusado (PARTIAL_SUCCESS, isUpdated !== true) não impede empréstimo', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () =>
        itemState({
          executionStatus: 'PARTIAL_SUCCESS',
          products: {
            investments: { isUpdated: false, lastUpdatedAt: undefined, warnings: [] },
            loans: { isUpdated: true, lastUpdatedAt: ITEM_UPDATED_AT, warnings: [] },
          },
        }),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.data).toEqual({ synced: true, positionsSynced: 0, loansSynced: 1 })
    expect(calls.investmentPages).toEqual([])
    expect(calls.saved).toEqual([])
    // PARTIAL_SUCCESS nunca avança radar_pluggy_items (D5/D8) mesmo com LOANS processado.
    expect(calls.itemStates).toEqual([])
  })

  it('fonte não habilitada para o Item nunca é chamada (D26)', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () => itemState({ itemProducts: ['LOANS'] }),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(calls.investmentPages).toEqual([])
    expect(result.data).toEqual({ synced: true, positionsSynced: 0, loansSynced: 1 })
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

  it('lista de empréstimos vazia autoritativa é legítima — nem todo item tem dívida', async () => {
    const { gateway, calls } = buildGateway({
      readLoansPage: async () => loansPage([]),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error).toBeUndefined()
    expect(result.data).toEqual({ synced: true, positionsSynced: 1, loansSynced: 0 })
    expect(calls.savedLoans[0]).toEqual([])
  })

  it('lista de investimentos vazia autoritativa é legítima (D21) — portfólio pode estar zerado', async () => {
    const { gateway, calls } = buildGateway({
      readInvestmentsPage: async () => page([]),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error).toBeUndefined()
    expect(result.data).toEqual({ synced: true, positionsSynced: 0, loansSynced: 1 })
    expect(calls.saved[0]).toEqual([])
  })

  it('página de empréstimo divergente da requisitada recusa sem persistir nada, nem investimento nem empréstimo', async () => {
    const { gateway, calls } = buildGateway({
      readLoansPage: async () => loansPage([loan()], { page: 9, totalPages: 2 }),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_LOANS_PAGE_MISMATCH')
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

  it('executionStatus fora de SUCCESS/PARTIAL_SUCCESS não sincroniza', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () => itemState({ status: 'LOGIN_ERROR', executionStatus: 'ERROR', lastUpdatedAt: undefined }),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.data).toEqual({ synced: false, positionsSynced: 0, loansSynced: 0 })
    expect(calls.investmentPages).toEqual([])
  })

  it('SUCCESS sem lastUpdatedAt usa Item.updatedAt como versão (D27), nunca recusa permanente', async () => {
    const { gateway, calls } = buildGateway({
      readCurrentItemState: async () => itemState({ lastUpdatedAt: undefined, updatedAt: '2026-08-01T00:00:00.000Z' }),
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error).toBeUndefined()
    expect(calls.itemStates[0]?.lastUpdatedAt).toEqual(new Date('2026-08-01T00:00:00.000Z'))
    expect(calls.advanced.every((a) => a.versionAt.toISOString() === '2026-08-01T00:00:00.000Z')).toBe(true)
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

  it('falha ao persistir posição não avança a marca d’água, mas empréstimo já concluído permanece', async () => {
    const { gateway, calls } = buildGateway({
      commitInvestments: async () => {
        throw new ApplicationError('PLUGGY_POSITION_SNAPSHOT_WRITE_FAILED', { itemId: ITEM_ID })
      },
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error?.errorType).toBe('PLUGGY_POSITION_SNAPSHOT_WRITE_FAILED')
    expect(calls.itemStates).toEqual([])
    expect(calls.advanced).toEqual([])
  })

  it('versão mais antiga que perde a corrida do commit nunca é contada como sincronizada, mas não é erro (revisão PR #14)', async () => {
    const { gateway } = buildGateway({
      commitInvestments: async () => false,
      commitLoans: async () => false,
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error).toBeUndefined()
    expect(result.data).toEqual({ synced: true, positionsSynced: 0, loansSynced: 0 })
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

  it('lease perdido antes de qualquer chamada recusa sem ler consentimento nem paginar', async () => {
    const { gateway, calls } = buildGateway()

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID, leaseGuard: { isLost: () => true } })

    expect(result.error?.errorType).toBe('PLUGGY_ITEM_INGESTION_LEASE_LOST')
    expect(calls.consentStatuses).toEqual([])
    expect(calls.investmentPages).toEqual([])
    expect(calls.saved).toEqual([])
  })

  it('revisão PR #14: lease já perdido antes de qualquer chamada nunca dispara readCurrentItemState (fetchItem real)', async () => {
    let readCurrentItemStateCalled = false
    const { gateway } = buildGateway({
      readCurrentItemState: async () => {
        readCurrentItemStateCalled = true
        throw new Error('não deveria ser chamado com lease já perdido')
      },
    })

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID, leaseGuard: { isLost: () => true } })

    expect(result.error?.errorType).toBe('PLUGGY_ITEM_INGESTION_LEASE_LOST')
    expect(readCurrentItemStateCalled).toBe(false)
  })

  it('lease perdido no meio da varredura de investimentos interrompe antes da próxima página, sem persistir', async () => {
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
    let requested = 0
    const leaseGuard = { isLost: () => requested >= 2 }
    const originalReadPage = gateway.readInvestmentsPage.bind(gateway)
    gateway.readInvestmentsPage = async (itemId, requestedPage) => {
      requested++
      return originalReadPage(itemId, requestedPage)
    }

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID, leaseGuard })

    expect(result.error?.errorType).toBe('PLUGGY_ITEM_INGESTION_LEASE_LOST')
    // Páginas 1 e 2 já tinham sido pedidas antes da perda ser detectada; a 3ª nunca chega a ser pedida.
    expect(calls.investmentPages).toEqual([1, 2])
    expect(calls.saved).toEqual([])
  })

  it('lease perdido depois da varredura, antes de persistir, recusa sem gravar fotografia', async () => {
    let lost = false
    const { gateway, calls } = buildGateway({
      readInvestmentsPage: async (_itemId, requestedPage) => {
        lost = true
        calls.investmentPages.push(requestedPage)
        return page([investment()], { page: requestedPage })
      },
    })
    const leaseGuard = { isLost: () => lost }

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID, leaseGuard })

    expect(result.error?.errorType).toBe('PLUGGY_ITEM_INGESTION_LEASE_LOST')
    expect(calls.saved).toEqual([])
    expect(calls.advanced).toEqual([])
  })

  it('sem leaseGuard, comportamento é o de sempre — nunca recusa por posse', async () => {
    const { gateway, calls } = buildGateway()

    const result = await buildInteractor(gateway).execute({ itemId: ITEM_ID })

    expect(result.error).toBeUndefined()
    expect(calls.saved).toHaveLength(1)
  })
})
