import { describe, expect, it, vi } from 'vitest'
import { RegisterPluggyCredentialInteractor } from '../../../../src/interactors/pluggy-credential/register/register-pluggy-credential.interactor.js'
import type { RegisterPluggyCredentialGateway } from '../../../../src/interactors/pluggy-credential/register/register-pluggy-credential.types.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

function buildGateway(overrides: Partial<RegisterPluggyCredentialGateway> = {}): RegisterPluggyCredentialGateway {
  return {
    addContext: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    checkItemAvailable: vi.fn().mockResolvedValue(undefined),
    validateItemAccess: vi.fn().mockResolvedValue(undefined),
    saveCredentialWithItemLink: vi.fn().mockResolvedValue(7),
    provisionWebhook: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function buildInteractor(gateway: RegisterPluggyCredentialGateway): RegisterPluggyCredentialInteractor {
  return new RegisterPluggyCredentialInteractor({
    registerPluggyCredentialImpl: gateway,
  } as unknown as AppContainer)
}

describe('RegisterPluggyCredentialInteractor', () => {
  it('cadastra credencial, vincula item e provisiona webhook na ordem correta', async () => {
    const gateway = buildGateway()

    const { data, error } = await buildInteractor(gateway).execute({
      personId: 1,
      clientId: 'client-1',
      clientSecret: 'segredo',
      itemId: 'item-1',
    })

    expect(gateway.checkItemAvailable).toHaveBeenCalledWith('item-1')
    expect(gateway.validateItemAccess).toHaveBeenCalledWith({
      clientId: 'client-1',
      clientSecret: 'segredo',
      itemId: 'item-1',
    })
    expect(gateway.saveCredentialWithItemLink).toHaveBeenCalledWith({
      personId: 1,
      clientId: 'client-1',
      clientSecret: 'segredo',
      itemId: 'item-1',
    })
    expect(gateway.provisionWebhook).toHaveBeenCalledWith(7)
    expect(error).toBeUndefined()
    expect(data).toEqual({ credentialId: 7 })
  })

  it('recusa nomeando o campo quando itemId está vazio, sem chamar validações nem persistência', async () => {
    const gateway = buildGateway()

    const { data, error } = await buildInteractor(gateway).execute({
      personId: 1,
      clientId: 'client-1',
      clientSecret: 'segredo',
      itemId: '',
    })

    expect(data).toBeUndefined()
    expect(error).toBeInstanceOf(ApplicationError)
    expect(error?.errorType).toBe('PLUGGY_CREDENTIAL_FIELD_MISSING')
    expect(error?.details).toMatchObject({ field: 'itemId' })
    expect(gateway.checkItemAvailable).not.toHaveBeenCalled()
    expect(gateway.validateItemAccess).not.toHaveBeenCalled()
    expect(gateway.saveCredentialWithItemLink).not.toHaveBeenCalled()
  })

  it('recusa nomeando erro de entidade quando clientId está vazio, sem chamar validações nem persistência', async () => {
    const gateway = buildGateway()

    const { data, error } = await buildInteractor(gateway).execute({
      personId: 1,
      clientId: '   ',
      clientSecret: 'segredo',
      itemId: 'item-1',
    })

    expect(data).toBeUndefined()
    expect(error).toBeInstanceOf(ApplicationError)
    expect(error?.errorType).toBe('PLUGGY_CREDENTIAL_CLIENT_ID_MISSING')
    expect(gateway.checkItemAvailable).not.toHaveBeenCalled()
    expect(gateway.validateItemAccess).not.toHaveBeenCalled()
    expect(gateway.saveCredentialWithItemLink).not.toHaveBeenCalled()
  })

  it('recusa nomeando erro de entidade quando clientSecret está vazio, sem chamar validações nem persistência', async () => {
    const gateway = buildGateway()

    const { data, error } = await buildInteractor(gateway).execute({
      personId: 1,
      clientId: 'client-1',
      clientSecret: '',
      itemId: 'item-1',
    })

    expect(data).toBeUndefined()
    expect(error).toBeInstanceOf(ApplicationError)
    expect(error?.errorType).toBe('PLUGGY_CREDENTIAL_CLIENT_SECRET_MISSING')
    expect(gateway.checkItemAvailable).not.toHaveBeenCalled()
    expect(gateway.validateItemAccess).not.toHaveBeenCalled()
    expect(gateway.saveCredentialWithItemLink).not.toHaveBeenCalled()
  })

  it('recusa quando item já estiver vinculado no banco, sem chamar Pluggy nem persistir', async () => {
    const gateway = buildGateway({
      checkItemAvailable: vi.fn().mockRejectedValue(new ApplicationError('PLUGGY_CREDENTIAL_ITEM_ALREADY_LINKED', { itemId: 'item-1' })),
    })

    const { data, error } = await buildInteractor(gateway).execute({
      personId: 1,
      clientId: 'client-1',
      clientSecret: 'segredo',
      itemId: 'item-1',
    })

    expect(data).toBeUndefined()
    expect(error?.errorType).toBe('PLUGGY_CREDENTIAL_ITEM_ALREADY_LINKED')
    expect(gateway.validateItemAccess).not.toHaveBeenCalled()
    expect(gateway.saveCredentialWithItemLink).not.toHaveBeenCalled()
  })

  it('recusa quando validação de credencial ou acesso ao item na Pluggy falhar, sem persistir', async () => {
    const gateway = buildGateway({
      validateItemAccess: vi.fn().mockRejectedValue(new ApplicationError('PLUGGY_ITEM_NOT_FOUND', { itemId: 'item-1' })),
    })

    const { data, error } = await buildInteractor(gateway).execute({
      personId: 1,
      clientId: 'client-1',
      clientSecret: 'segredo',
      itemId: 'item-1',
    })

    expect(data).toBeUndefined()
    expect(error?.errorType).toBe('PLUGGY_ITEM_NOT_FOUND')
    expect(gateway.saveCredentialWithItemLink).not.toHaveBeenCalled()
    expect(gateway.provisionWebhook).not.toHaveBeenCalled()
  })

  it('recusa nomeada quando provisionar o webhook falha, mantendo credencial e vínculo já salvos para reconciliação', async () => {
    const gateway = buildGateway({
      provisionWebhook: vi.fn().mockRejectedValue(new ApplicationError('PLUGGY_WEBHOOK_URL_MISSING')),
    })

    const { data, error } = await buildInteractor(gateway).execute({
      personId: 1,
      clientId: 'client-1',
      clientSecret: 'segredo',
      itemId: 'item-1',
    })

    expect(data).toBeUndefined()
    expect(error?.errorType).toBe('PLUGGY_WEBHOOK_URL_MISSING')
    expect(gateway.saveCredentialWithItemLink).toHaveBeenCalled()
  })

  it('erro inesperado na persistência vira recusa nomeada', async () => {
    const gateway = buildGateway({
      saveCredentialWithItemLink: vi.fn().mockRejectedValue(new Error('queda de banco')),
    })

    const { data, error } = await buildInteractor(gateway).execute({
      personId: 1,
      clientId: 'client-1',
      clientSecret: 'segredo',
      itemId: 'item-1',
    })

    expect(data).toBeUndefined()
    expect(error?.errorType).toBe('PLUGGY_CREDENTIAL_REGISTRATION_FAILED')
    expect(gateway.provisionWebhook).not.toHaveBeenCalled()
  })
})
