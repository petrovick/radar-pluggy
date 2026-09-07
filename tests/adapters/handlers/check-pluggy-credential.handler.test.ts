import type { Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { checkPluggyCredentialHandler } from '../../../src/adapters/handlers/check-pluggy-credential.handler.js'
import type { AuthenticatedRequest } from '../../../src/infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../../src/infra/http/middleware/request-scope.middleware.js'
import type { CheckPluggyCredentialOutput } from '../../../src/interactors/pluggy-credential/check/check-pluggy-credential.types.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

function fakeResponse(): Response {
  const res = {} as Response
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

function fakeRequest(
  execute: (input: unknown) => Promise<CheckPluggyCredentialOutput>,
  personId: number | undefined,
): AuthenticatedRequest & ScopedRequest {
  return {
    personId,
    container: { resolve: () => ({ execute }) },
  } as unknown as AuthenticatedRequest & ScopedRequest
}

describe('checkPluggyCredentialHandler', () => {
  it('delega ao interactor com personId de req.personId e responde 200 hasCredential:true em sucesso', async () => {
    const execute = vi.fn().mockResolvedValue({ data: {} })
    const res = fakeResponse()

    await checkPluggyCredentialHandler(fakeRequest(execute, 1), res)

    expect(execute).toHaveBeenCalledWith({ personId: 1 })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ hasCredential: true })
  })

  it('pessoa sem nenhuma credencial cadastrada vira 200 hasCredential:false, não erro HTTP', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ error: new ApplicationError('PLUGGY_CREDENTIAL_NOT_FOUND_FOR_PERSON', { personId: 1 }) })
    const res = fakeResponse()

    await checkPluggyCredentialHandler(fakeRequest(execute, 1), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ hasCredential: false })
  })

  it('pessoa com credencial mas sem itemId vinculado vira 200 hasCredential:false, não erro HTTP', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ error: new ApplicationError('PLUGGY_CREDENTIAL_ITEM_ID_NOT_FOUND_FOR_PERSON', { personId: 1 }) })
    const res = fakeResponse()

    await checkPluggyCredentialHandler(fakeRequest(execute, 1), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ hasCredential: false })
  })

  it('falha inesperada do interactor (banco fora do ar) vira 500 nomeado, nunca hasCredential:false', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ error: new ApplicationError('PLUGGY_CREDENTIAL_CHECK_FAILED', { personId: 1 }) })
    const res = fakeResponse()

    await checkPluggyCredentialHandler(fakeRequest(execute, 1), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      errorType: 'PLUGGY_CREDENTIAL_CHECK_FAILED',
      extras: { personId: 1 },
    })
  })

  it('responde 500 nomeado quando req.personId está ausente, sem chamar o interactor', async () => {
    const execute = vi.fn()
    const res = fakeResponse()

    await checkPluggyCredentialHandler(fakeRequest(execute, undefined), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('responde 500 sem vazar detalhe quando o wiring falha ao resolver o caso de uso', async () => {
    const res = fakeResponse()
    const req = {
      personId: 1,
      container: {
        resolve: () => {
          throw new Error('registro ausente no container')
        },
      },
    } as unknown as AuthenticatedRequest & ScopedRequest

    await checkPluggyCredentialHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CREDENTIAL_STATUS_CHECK_FAILED' })
  })
})
