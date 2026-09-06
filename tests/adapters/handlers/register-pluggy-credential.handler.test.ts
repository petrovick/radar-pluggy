import type { Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { registerPluggyCredentialHandler } from '../../../src/adapters/handlers/register-pluggy-credential.handler.js'
import type { AuthenticatedRequest } from '../../../src/infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../../src/infra/http/middleware/request-scope.middleware.js'
import type { RegisterPluggyCredentialOutput } from '../../../src/interactors/pluggy-credential/register/register-pluggy-credential.types.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

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

describe('registerPluggyCredentialHandler', () => {
  it('delega ao interactor com personId de req.personId (nunca do corpo), e responde 201 com o id', async () => {
    const execute = vi.fn().mockResolvedValue({ data: { credentialId: 7 } })
    const res = fakeResponse()

    await registerPluggyCredentialHandler(
      fakeRequest(execute, 1, { clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' }),
      res,
    )

    expect(execute).toHaveBeenCalledWith({ personId: 1, clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' })
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ id: 7 })
  })

  it('ignora um personId enviado no corpo — usa só req.personId', async () => {
    const execute = vi.fn().mockResolvedValue({ data: { credentialId: 7 } })
    const res = fakeResponse()

    // personId: 999 no corpo simula uma tentativa de se passar por outra pessoa — precisa ser
    // ignorado, porque o body não é mais lido pra esse campo.
    await registerPluggyCredentialHandler(
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

    await registerPluggyCredentialHandler(fakeRequest(execute, 1, { clientId: 'client-1', clientSecret: 'segredo' }), res)

    expect(execute).toHaveBeenCalledWith({ personId: 1, clientId: 'client-1', clientSecret: 'segredo', itemId: '' })
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CREDENTIAL_FIELD_MISSING', extras: { field: 'itemId' } })
  })

  it('responde 500 nomeado quando req.personId está ausente, sem chamar o interactor', async () => {
    const execute = vi.fn()
    const res = fakeResponse()

    await registerPluggyCredentialHandler(
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

    await registerPluggyCredentialHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CREDENTIAL_REGISTRATION_FAILED' })
  })

  it('resposta sem data e sem error vira 500, nunca 201 com id ausente', async () => {
    const execute = vi.fn().mockResolvedValue({})
    const res = fakeResponse()

    await registerPluggyCredentialHandler(
      fakeRequest(execute, 1, { clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' }),
      res,
    )

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CREDENTIAL_REGISTRATION_FAILED' })
  })
})
