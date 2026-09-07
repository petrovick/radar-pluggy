import type { Response } from 'express'
import { describe, expect, it } from 'vitest'
import { createLoadPluggyHistoryHandler } from '../../../src/adapters/handlers/load-pluggy-history.handler.js'
import type { AppContainerInstance } from '../../../src/infra/bootstrap/register.js'
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

const DEFAULT_HISTORY: LoadPluggyHistoryOutput = {
  data: { loaded: true, sourcesScanned: 2, transactionsObserved: 41, sourcesRefused: [] },
}

const rootContainer = {} as AppContainerInstance

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

describe('createLoadPluggyHistoryHandler', () => {
  it('responde 200 com o resultado do histórico e só então dispara syncPosition', async () => {
    const { res, sent } = buildResponse()
    const order: string[] = []
    let syncArgs: [AppContainerInstance, string] | undefined

    const originalJson = res.json.bind(res)
    res.json = ((body: unknown) => {
      order.push('respondeu')
      return originalJson(body)
    }) as Response['json']

    const handler = createLoadPluggyHistoryHandler(rootContainer, (container, itemId) => {
      order.push('syncPosition')
      syncArgs = [container, itemId]
    })

    await handler(buildRequest(DEFAULT_HISTORY), res)

    expect(sent.status).toBe(200)
    expect(sent.body).toEqual({ data: DEFAULT_HISTORY.data })
    // A ordem é o requisito: a resposta não pode esperar a sincronização de posição.
    expect(order).toEqual(['respondeu', 'syncPosition'])
    expect(syncArgs).toEqual([rootContainer, 'item-1'])
  })

  it('recusa nomeada do histórico vira 400 com {errorType, extras}, sem disparar syncPosition', async () => {
    const { res, sent } = buildResponse()
    const error = new ApplicationError('PLUGGY_CREDENTIAL_ITEM_NOT_LINKED', { itemId: 'item-1' })
    let synced = false

    const handler = createLoadPluggyHistoryHandler(rootContainer, () => {
      synced = true
    })

    await handler(buildRequest({ error }), res)

    expect(sent.status).toBe(400)
    expect(sent.body).toEqual({
      errorType: 'PLUGGY_CREDENTIAL_ITEM_NOT_LINKED',
      extras: { itemId: 'item-1' },
    })
    // Dono não confirmado: sincronizar posição gastaria I/O num item que pode não ser da pessoa.
    expect(synced).toBe(false)
  })

  it('erro lançado por syncPosition não derruba a resposta já enviada', async () => {
    const { res, sent } = buildResponse()
    const handler = createLoadPluggyHistoryHandler(rootContainer, () => {
      throw new Error('syncPosition não deveria propagar')
    })

    await expect(handler(buildRequest(DEFAULT_HISTORY), res)).resolves.toBeUndefined()
    expect(sent.status).toBe(200)
    expect(sent.body).toEqual({ data: DEFAULT_HISTORY.data })
  })

  it('itemId ausente na rota recusa nomeando o campo, sem chamar o caso de uso nem syncPosition', async () => {
    const { res, sent } = buildResponse()
    let synced = false
    const handler = createLoadPluggyHistoryHandler(rootContainer, () => {
      synced = true
    })

    await handler(buildRequest(DEFAULT_HISTORY, { itemId: '  ' }), res)

    expect(sent.status).toBe(400)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_HISTORY_ITEM_ID_MISSING' })
    expect(synced).toBe(false)
  })

  it('sem personId responde 500 sem vazar detalhe — a rota nunca deveria ser alcançável assim', async () => {
    const { res, sent } = buildResponse()
    const handler = createLoadPluggyHistoryHandler(rootContainer, () => {})

    await handler(buildRequest(DEFAULT_HISTORY, { personId: undefined }), res)

    expect(sent.status).toBe(500)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
  })

  it('erro inesperado no wiring do histórico vira 500 controlado, nunca stack trace', async () => {
    const { res, sent } = buildResponse()
    const handler = createLoadPluggyHistoryHandler(rootContainer, () => {})
    const req = {
      personId: 7,
      params: { itemId: 'item-1' },
      container: {
        resolve: () => {
          throw new Error('registro ausente no container')
        },
      },
    } as unknown as AuthenticatedRequest & ScopedRequest

    await handler(req, res)

    expect(sent.status).toBe(500)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_HISTORY_LOAD_FAILED' })
  })

  it('repassa origin USER e personId do JWT ao interactor, ignorando personId no corpo', async () => {
    const { res } = buildResponse()
    let executedInput: unknown
    const handler = createLoadPluggyHistoryHandler(rootContainer, () => {})

    const req = {
      personId: 42,
      params: { itemId: 'item-1' },
      body: { personId: 999 }, // tentativa de bypass via body
      container: {
        resolve: () => ({
          execute: async (input: unknown) => {
            executedInput = input
            return DEFAULT_HISTORY
          },
        }),
      },
    } as unknown as AuthenticatedRequest & ScopedRequest

    await handler(req, res)

    expect(executedInput).toEqual({ origin: 'USER', personId: 42, itemId: 'item-1' })
  })
})
