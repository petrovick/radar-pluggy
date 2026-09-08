import { describe, expect, it, vi } from 'vitest'
import { ReadPluggyPositionInteractor } from '../../../../src/interactors/pluggy-position/read/read-pluggy-position.interactor.js'
import type {
  PluggyPositionView,
  ReadPluggyPositionGateway,
} from '../../../../src/interactors/pluggy-position/read/read-pluggy-position.types.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

const POSITION: PluggyPositionView = {
  investmentId: 'inv-1',
  type: 'EQUITY',
  subtype: 'STOCK',
  name: 'PETR4',
  code: 'PETR4',
  isin: 'BRPETRACNPR6',
  currencyCode: 'BRL',
  balance: '100.00',
  quantity: '10.00000000',
  value: '10.00000000',
  amountOriginal: null,
  amount: '100.00',
  taxes: null,
  taxes2: null,
  amountWithdrawal: '100.00',
  amountProfit: null,
  status: 'ACTIVE',
  quotaDate: '2026-08-01T00:00:00.000Z',
  dueDate: null,
  issueDate: null,
  purchaseDate: '2024-01-01T00:00:00.000Z',
  issuer: null,
  issuerCnpj: null,
  rate: null,
  rateType: null,
  fixedAnnualRate: null,
  lastMonthRate: null,
  annualRate: null,
  lastTwelveMonthsRate: null,
  institutionName: 'Corretora Exemplo',
  institutionNumber: null,
  sourceInstitutionName: 'BTG Pactual',
  number: null,
  owner: null,
  metadata: null,
}

function buildGateway(overrides: Partial<ReadPluggyPositionGateway> = {}): ReadPluggyPositionGateway {
  return {
    addContext: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    readItemIdsForPerson: vi.fn().mockResolvedValue(['item-1']),
    readPositionsByItemIds: vi.fn().mockResolvedValue([POSITION]),
    ...overrides,
  }
}

function buildInteractor(gateway: ReadPluggyPositionGateway): ReadPluggyPositionInteractor {
  return new ReadPluggyPositionInteractor({ readPluggyPositionImpl: gateway } as unknown as AppContainer)
}

describe('ReadPluggyPositionInteractor', () => {
  it('devolve as posições de todos os itens vinculados à pessoa', async () => {
    const gateway = buildGateway()

    const { data, error } = await buildInteractor(gateway).execute({ personId: 5 })

    expect(gateway.readItemIdsForPerson).toHaveBeenCalledWith(5)
    expect(gateway.readPositionsByItemIds).toHaveBeenCalledWith(['item-1'])
    expect(error).toBeUndefined()
    expect(data).toEqual([POSITION])
  })

  it('pessoa sem item vinculado devolve lista vazia, nunca recusa', async () => {
    const gateway = buildGateway({ readItemIdsForPerson: vi.fn().mockResolvedValue([]) })

    const { data, error } = await buildInteractor(gateway).execute({ personId: 9 })

    expect(data).toEqual([])
    expect(error).toBeUndefined()
    // Sem item, não há por que ler posição nenhuma.
    expect(gateway.readPositionsByItemIds).not.toHaveBeenCalled()
  })

  it('erro inesperado vira recusa nomeada, nunca escapa por throw', async () => {
    const gateway = buildGateway({
      readItemIdsForPerson: vi.fn().mockRejectedValue(new Error('conexão caiu')),
    })

    const { error } = await buildInteractor(gateway).execute({ personId: 9 })

    expect(error).toBeInstanceOf(ApplicationError)
    expect(error?.errorType).toBe('PLUGGY_POSITION_READ_FAILED')
  })
})
