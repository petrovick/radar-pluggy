import { describe, expect, it, vi } from 'vitest'
import { ReadPluggyAccountInteractor } from '../../../../src/interactors/pluggy-account/read/read-pluggy-account.interactor.js'
import type {
  PluggyAccountView,
  ReadPluggyAccountGateway,
} from '../../../../src/interactors/pluggy-account/read/read-pluggy-account.types.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

const ACCOUNT: PluggyAccountView = {
  accountId: 'acc-1',
  type: 'CREDIT',
  subtype: 'CREDIT_CARD',
  name: 'Cartão Exemplo',
}

function buildGateway(overrides: Partial<ReadPluggyAccountGateway> = {}): ReadPluggyAccountGateway {
  return {
    addContext: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    readItemIdsForPerson: vi.fn().mockResolvedValue(['item-1']),
    readAccountsByItemIds: vi.fn().mockResolvedValue([ACCOUNT]),
    ...overrides,
  }
}

function buildInteractor(gateway: ReadPluggyAccountGateway): ReadPluggyAccountInteractor {
  return new ReadPluggyAccountInteractor({ readPluggyAccountImpl: gateway } as unknown as AppContainer)
}

describe('ReadPluggyAccountInteractor', () => {
  it('devolve as contas de todos os itens vinculados à pessoa', async () => {
    const gateway = buildGateway()

    const { data, error } = await buildInteractor(gateway).execute({ personId: 5 })

    expect(gateway.readItemIdsForPerson).toHaveBeenCalledWith(5)
    expect(gateway.readAccountsByItemIds).toHaveBeenCalledWith(['item-1'])
    expect(error).toBeUndefined()
    expect(data).toEqual([ACCOUNT])
  })

  it('pessoa sem item vinculado devolve lista vazia, nunca recusa', async () => {
    const gateway = buildGateway({ readItemIdsForPerson: vi.fn().mockResolvedValue([]) })

    const { data, error } = await buildInteractor(gateway).execute({ personId: 9 })

    expect(data).toEqual([])
    expect(error).toBeUndefined()
    expect(gateway.readAccountsByItemIds).not.toHaveBeenCalled()
  })

  it('erro inesperado vira recusa nomeada, nunca escapa por throw', async () => {
    const gateway = buildGateway({
      readItemIdsForPerson: vi.fn().mockRejectedValue(new Error('conexão caiu')),
    })

    const { error } = await buildInteractor(gateway).execute({ personId: 9 })

    expect(error).toBeInstanceOf(ApplicationError)
    expect(error?.errorType).toBe('PLUGGY_ACCOUNT_READ_FAILED')
  })
})
