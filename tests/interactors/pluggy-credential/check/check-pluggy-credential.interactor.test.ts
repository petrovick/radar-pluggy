import { describe, expect, it, vi } from 'vitest'
import { CheckPluggyCredentialInteractor } from '../../../../src/interactors/pluggy-credential/check/check-pluggy-credential.interactor.js'
import type { CheckPluggyCredentialGateway } from '../../../../src/interactors/pluggy-credential/check/check-pluggy-credential.types.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

function buildGateway(overrides: Partial<CheckPluggyCredentialGateway> = {}): CheckPluggyCredentialGateway {
  return {
    addContext: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    readCredentialIds: vi.fn().mockResolvedValue([1]),
    readLinkedItemIds: vi.fn().mockResolvedValue(['item-1']),
    ...overrides,
  }
}

function buildInteractor(gateway: CheckPluggyCredentialGateway): CheckPluggyCredentialInteractor {
  return new CheckPluggyCredentialInteractor({
    checkPluggyCredentialImpl: gateway,
  } as unknown as AppContainer)
}

describe('CheckPluggyCredentialInteractor', () => {
  it('não recusa quando a pessoa tem credencial com ao menos um item vinculado', async () => {
    const gateway = buildGateway({
      readCredentialIds: vi.fn().mockResolvedValue([1, 2]),
      readLinkedItemIds: vi.fn().mockResolvedValue(['item-1', 'item-2']),
    })

    const { data, error } = await buildInteractor(gateway).execute({ personId: 5 })

    expect(gateway.readCredentialIds).toHaveBeenCalledWith(5)
    // Os itemIds lidos são insumo da decisão, não resposta: o caso de uso responde "está pronta?",
    // e quem quiser a lista chama outro caso de uso.
    expect(gateway.readLinkedItemIds).toHaveBeenCalledWith([1, 2])
    expect(error).toBeUndefined()
    expect(data).toEqual({})
  })

  it('recusa nomeando a pessoa quando ela não tem nenhuma credencial cadastrada', async () => {
    const gateway = buildGateway({ readCredentialIds: vi.fn().mockResolvedValue([]) })

    const { data, error } = await buildInteractor(gateway).execute({ personId: 9 })

    expect(data).toBeUndefined()
    expect(error).toBeInstanceOf(ApplicationError)
    expect(error?.errorType).toBe('PLUGGY_CREDENTIAL_NOT_FOUND_FOR_PERSON')
    expect(error?.details).toMatchObject({ personId: 9 })
    // A segunda leitura nem acontece: "sem credencial" já é resposta final.
    expect(gateway.readLinkedItemIds).not.toHaveBeenCalled()
  })

  it('recusa com outro errorType quando ela tem credencial mas nenhum itemId associado', async () => {
    const gateway = buildGateway({ readLinkedItemIds: vi.fn().mockResolvedValue([]) })

    const { data, error } = await buildInteractor(gateway).execute({ personId: 9 })

    expect(data).toBeUndefined()
    // As duas ausências são distinguíveis de propósito: quem chama precisa saber se falta cadastrar
    // credencial ou se falta vincular item a uma credencial que já existe.
    expect(error?.errorType).toBe('PLUGGY_CREDENTIAL_ITEM_ID_NOT_FOUND_FOR_PERSON')
    expect(error?.details).toMatchObject({ personId: 9 })
  })

  it('erro inesperado vira recusa nomeada, nunca escapa por throw', async () => {
    const gateway = buildGateway({
      readCredentialIds: vi.fn().mockRejectedValue(new Error('conexão caiu')),
    })

    const { error } = await buildInteractor(gateway).execute({ personId: 9 })

    expect(error?.errorType).toBe('PLUGGY_CREDENTIAL_CHECK_FAILED')
  })
})
