import type { Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { readPluggyAccountHandler } from '../../../src/adapters/handlers/read-pluggy-account.handler.js'
import type { AuthenticatedRequest } from '../../../src/infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../../src/infra/http/middleware/request-scope.middleware.js'
import type { ReadPluggyAccountOutput } from '../../../src/interactors/pluggy-account/read/read-pluggy-account.types.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

function fakeResponse(): Response {
  const res = {} as Response
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

function fakeRequest(
  execute: (input: unknown) => Promise<ReadPluggyAccountOutput>,
  personId: number | undefined,
): AuthenticatedRequest & ScopedRequest {
  return {
    personId,
    container: { resolve: () => ({ execute }) },
  } as unknown as AuthenticatedRequest & ScopedRequest
}

describe('readPluggyAccountHandler', () => {
  it('delega ao interactor com personId de req.personId e responde 200 com o array direto', async () => {
    const execute = vi.fn().mockResolvedValue({ data: [] })
    const res = fakeResponse()

    await readPluggyAccountHandler(fakeRequest(execute, 7), res)

    expect(execute).toHaveBeenCalledWith({ personId: 7 })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith([])
  })

  it('recusa do interactor responde 400 com errorType e extras', async () => {
    const execute = vi.fn().mockResolvedValue({ error: new ApplicationError('PLUGGY_ACCOUNT_READ_FAILED', { personId: 7 }) })
    const res = fakeResponse()

    await readPluggyAccountHandler(fakeRequest(execute, 7), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_ACCOUNT_READ_FAILED', extras: { personId: 7 } })
  })

  it('responde 500 nomeado quando req.personId está ausente, sem chamar o interactor', async () => {
    const execute = vi.fn()
    const res = fakeResponse()

    await readPluggyAccountHandler(fakeRequest(execute, undefined), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('responde 500 sem vazar detalhe quando o wiring falha ao resolver o caso de uso', async () => {
    const res = fakeResponse()
    const req = {
      personId: 7,
      container: {
        resolve: () => {
          throw new Error('registro ausente no container')
        },
      },
    } as unknown as AuthenticatedRequest & ScopedRequest

    await readPluggyAccountHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_ACCOUNT_READ_FAILED' })
  })
})
