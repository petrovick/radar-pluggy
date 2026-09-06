import type { Response } from 'express'
import { describe, expect, it } from 'vitest'
import { loadPluggyHistoryHandler } from '../../../src/adapters/handlers/load-pluggy-history.handler.js'
import type { AuthenticatedRequest } from '../../../src/infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../../src/infra/http/middleware/request-scope.middleware.js'
import { ApplicationError } from '../../../src/shared/application-error.js'
import type { LoadPluggyHistoryOutput } from '../../../src/interactors/pluggy-history/load/load-pluggy-history.types.js'

function buildResponse() {
  const sent: { status?: number; body?: unknown } = {}
  const res = {
    status(code: number) {
      sent.status = code
      return this
    },
    json(body: unknown) {
      sent.body = body
      return this
    },
  } as unknown as Response
  return { res, sent }
}

function buildRequest(
  output: LoadPluggyHistoryOutput,
  overrides: { personId?: number | undefined; itemId?: string } = {},
): AuthenticatedRequest & ScopedRequest {
  return {
    personId: 'personId' in overrides ? overrides.personId : 7,
    params: { itemId: overrides.itemId ?? 'item-1' },
    container: {
      resolve: () => ({ execute: async () => output }),
    },
  } as unknown as AuthenticatedRequest & ScopedRequest

}

describe('loadPluggyHistoryHandler', () => {
  it('devolve 200 com o resultado da carga', async () => {
    const { res, sent } = buildResponse()
    const data = { loaded: true, sourcesScanned: 2, transactionsObserved: 41, sourcesRefused: [] }

    await loadPluggyHistoryHandler(buildRequest({ data }), res)

    expect(sent.status).toBe(200)
    expect(sent.body).toEqual({ data })
  })

  it('recusa nomeada do caso de uso vira 400 com {errorType, extras}', async () => {
    const { res, sent } = buildResponse()
    const error = new ApplicationError('PLUGGY_CREDENTIAL_ITEM_NOT_LINKED', { itemId: 'item-1' })

    await loadPluggyHistoryHandler(buildRequest({ error }), res)

    expect(sent.status).toBe(400)
    expect(sent.body).toEqual({
      errorType: 'PLUGGY_CREDENTIAL_ITEM_NOT_LINKED',
      extras: { itemId: 'item-1' },
    })
  })

  it('itemId ausente na rota recusa nomeando o campo, sem chamar o caso de uso', async () => {
    const { res, sent } = buildResponse()

    await loadPluggyHistoryHandler(buildRequest({}, { itemId: '  ' }), res)

    expect(sent.status).toBe(400)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_HISTORY_ITEM_ID_MISSING' })
  })

  it('sem personId responde 500 sem vazar detalhe — a rota nunca deveria ser alcançável assim', async () => {
    const { res, sent } = buildResponse()

    await loadPluggyHistoryHandler(buildRequest({}, { personId: undefined }), res)

    expect(sent.status).toBe(500)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
  })

  it('erro inesperado no wiring vira 500 controlado, nunca stack trace', async () => {
    const { res, sent } = buildResponse()
    const req = {
      personId: 7,
      params: { itemId: 'item-1' },
      container: {
        resolve: () => {
          throw new Error('registro ausente no container')
        },
      },
    } as unknown as AuthenticatedRequest & ScopedRequest

    await loadPluggyHistoryHandler(req, res)

    expect(sent.status).toBe(500)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_HISTORY_LOAD_FAILED' })
  })

  it('repassa origin USER e personId do JWT ao interactor, ignorando personId no corpo', async () => {
    const { res } = buildResponse()
    let executedInput: unknown

    const req = {
      personId: 42,
      params: { itemId: 'item-1' },
      body: { personId: 999 }, // tentativa de bypass via body
      container: {
        resolve: () => ({
          execute: async (input: unknown) => {
            executedInput = input
            return { data: { loaded: true, sourcesScanned: 0, transactionsObserved: 0, sourcesRefused: [] } }
          },
        }),
      },
    } as unknown as AuthenticatedRequest & ScopedRequest

    await loadPluggyHistoryHandler(req, res)

    expect(executedInput).toEqual({
      origin: 'USER',
      personId: 42,
      itemId: 'item-1',
    })
  })
})
