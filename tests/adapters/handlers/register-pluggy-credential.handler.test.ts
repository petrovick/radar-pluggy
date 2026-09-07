import type { Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { createRegisterPluggyCredentialHandler } from '../../../src/adapters/handlers/register-pluggy-credential.handler.js'
import type { AppContainerInstance } from '../../../src/infra/bootstrap/register.js'
import type { AuthenticatedRequest } from '../../../src/infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../../src/infra/http/middleware/request-scope.middleware.js'
import type { RegisterPluggyCredentialOutput } from '../../../src/interactors/pluggy-credential/register/register-pluggy-credential.types.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

const fakeRootContainer = {} as AppContainerInstance

function fakeResponse(): Response {
  const res = {} as Response
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

function fakeRequest(
  execute: (input: unknown) => Promise<RegisterPluggyCredentialOutput>,
  personId: number | undefined,
  body: Record<string, unknown>,
): AuthenticatedRequest & ScopedRequest {
  return {
    personId,
    body,
    container: { resolve: () => ({ execute }) },
  } as unknown as AuthenticatedRequest & ScopedRequest
}

function buildHandler(preloadItem: (container: AppContainerInstance, itemId: string) => void = () => {}) {
  return createRegisterPluggyCredentialHandler(fakeRootContainer, preloadItem)
}

describe('registerPluggyCredentialHandler', () => {
  it('delega ao interactor com personId de req.personId (nunca do corpo), e responde 201 com o id', async () => {
    const execute = vi.fn().mockResolvedValue({ data: { credentialId: 7 } })
    const res = fakeResponse()

    await buildHandler()(
      fakeRequest(execute, 1, { clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' }),
      res,
    )

    expect(execute).toHaveBeenCalledWith({ personId: 1, clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' })
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ id: 7 })
  })

  it('dispara a pré-carga do item SÓ depois de responder, sem bloquear o 201 (tasks.md 7.5)', async () => {
    const execute = vi.fn().mockResolvedValue({ data: { credentialId: 7 } })
    const res = fakeResponse()
    const preloadCalls: string[] = []
    const order: string[] = []
    res.json = vi.fn().mockImplementation(() => {
      order.push('json')
      return res
    })

    await buildHandler((_container, itemId) => {
      order.push('preload')
      preloadCalls.push(itemId)
    })(fakeRequest(execute, 1, { clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' }), res)

    expect(preloadCalls).toEqual(['item-1'])
    expect(order).toEqual(['json', 'preload'])
  })

  it('erro do interactor nunca dispara a pré-carga', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ error: new ApplicationError('PLUGGY_CREDENTIAL_CLIENT_ID_ALREADY_REGISTERED') })
    const res = fakeResponse()
    const preloadCalls: string[] = []

    await buildHandler((_container, itemId) => preloadCalls.push(itemId))(
      fakeRequest(execute, 1, { clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' }),
      res,
    )

    expect(preloadCalls).toEqual([])
  })

  it('ignora um personId enviado no corpo — usa só req.personId', async () => {
    const execute = vi.fn().mockResolvedValue({ data: { credentialId: 7 } })
    const res = fakeResponse()

    // personId: 999 no corpo simula uma tentativa de se passar por outra pessoa — precisa ser
    // ignorado, porque o body não é mais lido pra esse campo.
    await buildHandler()(
      fakeRequest(execute, 1, { personId: 999, clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' }),
      res,
    )

    expect(execute).toHaveBeenCalledWith({ personId: 1, clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' })
  })

  it('converte campo ausente/não-string em string vazia antes de chamar o interactor', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ error: new ApplicationError('PLUGGY_CREDENTIAL_FIELD_MISSING', { field: 'itemId' }) })
    const res = fakeResponse()

    await buildHandler()(fakeRequest(execute, 1, { clientId: 'client-1', clientSecret: 'segredo' }), res)

    expect(execute).toHaveBeenCalledWith({ personId: 1, clientId: 'client-1', clientSecret: 'segredo', itemId: '' })
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CREDENTIAL_FIELD_MISSING', extras: { field: 'itemId' } })
  })

  it('responde 500 nomeado quando req.personId está ausente, sem chamar o interactor', async () => {
    const execute = vi.fn()
    const res = fakeResponse()

    await buildHandler()(
      fakeRequest(execute, undefined, { clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' }),
      res,
    )

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('responde 500 sem vazar detalhe quando o wiring falha ao resolver o caso de uso', async () => {
    const res = fakeResponse()
    const req = {
      personId: 1,
      body: { clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' },
      container: {
        resolve: () => {
          throw new Error('registro ausente no container')
        },
      },
    } as unknown as AuthenticatedRequest & ScopedRequest

    await buildHandler()(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CREDENTIAL_REGISTRATION_FAILED' })
  })

  it('resposta sem data e sem error vira 500, nunca 201 com id ausente', async () => {
    const execute = vi.fn().mockResolvedValue({})
    const res = fakeResponse()

    await buildHandler()(
      fakeRequest(execute, 1, { clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' }),
      res,
    )

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CREDENTIAL_REGISTRATION_FAILED' })
  })
})
