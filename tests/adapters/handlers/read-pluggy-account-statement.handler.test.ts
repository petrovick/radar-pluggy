import type { Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { readPluggyAccountStatementHandler } from '../../../src/adapters/handlers/read-pluggy-account-statement.handler.js'
import type { AuthenticatedRequest } from '../../../src/infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../../src/infra/http/middleware/request-scope.middleware.js'
import type { ReadPluggyAccountStatementOutput } from '../../../src/interactors/pluggy-account-transaction/read/read-pluggy-account-statement.types.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

function fakeResponse(): Response {
  const res = {} as Response
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

function fakeRequest(
  execute: (input: unknown) => Promise<ReadPluggyAccountStatementOutput>,
  personId: number | undefined,
  params: Record<string, string>,
  query: Record<string, unknown>,
): AuthenticatedRequest & ScopedRequest {
  return {
    personId,
    params,
    query,
    container: { resolve: () => ({ execute }) },
  } as unknown as AuthenticatedRequest & ScopedRequest
}

const STATEMENT = { bill: { availableCreditLimit: null, creditLimit: null, minimumPayment: null, dueDate: null }, transactions: [] }

describe('readPluggyAccountStatementHandler', () => {
  it('delega ao interactor com personId, accountId da URL e billMonth da query', async () => {
    const execute = vi.fn().mockResolvedValue({ data: STATEMENT })
    const res = fakeResponse()

    await readPluggyAccountStatementHandler(
      fakeRequest(execute, 7, { accountId: 'acc-1' }, { billMonth: '2026-09' }),
      res,
    )

    expect(execute).toHaveBeenCalledWith({ personId: 7, accountId: 'acc-1', billMonth: '2026-09' })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(STATEMENT)
  })

  it('billMonth ausente na query responde 400 nomeado, sem chamar o interactor', async () => {
    const execute = vi.fn()
    const res = fakeResponse()

    await readPluggyAccountStatementHandler(fakeRequest(execute, 7, { accountId: 'acc-1' }, {}), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_ACCOUNT_STATEMENT_BILL_MONTH_MISSING' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('recusa do interactor (ex.: conta de outra pessoa) responde 400 com errorType e extras', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ error: new ApplicationError('PLUGGY_ACCOUNT_UNAUTHORIZED', { accountId: 'acc-1' }) })
    const res = fakeResponse()

    await readPluggyAccountStatementHandler(
      fakeRequest(execute, 7, { accountId: 'acc-1' }, { billMonth: '2026-09' }),
      res,
    )

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_ACCOUNT_UNAUTHORIZED', extras: { accountId: 'acc-1' } })
  })

  it('responde 500 nomeado quando req.personId está ausente, sem chamar o interactor', async () => {
    const execute = vi.fn()
    const res = fakeResponse()

    await readPluggyAccountStatementHandler(
      fakeRequest(execute, undefined, { accountId: 'acc-1' }, { billMonth: '2026-09' }),
      res,
    )

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('responde 500 sem vazar detalhe quando o wiring falha ao resolver o caso de uso', async () => {
    const res = fakeResponse()
    const req = {
      personId: 7,
      params: { accountId: 'acc-1' },
      query: { billMonth: '2026-09' },
      container: {
        resolve: () => {
          throw new Error('registro ausente no container')
        },
      },
    } as unknown as AuthenticatedRequest & ScopedRequest

    await readPluggyAccountStatementHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_ACCOUNT_STATEMENT_READ_FAILED' })
  })
})
