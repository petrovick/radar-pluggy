import type { Response } from 'express'
import { describe, expect, it } from 'vitest'
import { createLoadPluggyHistoryHandler } from '../../../src/adapters/handlers/load-pluggy-history.handler.js'
import type { AppContainerInstance } from '../../../src/infra/bootstrap/register.js'
import type { AuthenticatedRequest } from '../../../src/infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../../src/infra/http/middleware/request-scope.middleware.js'
import { ApplicationError } from '../../../src/shared/application-error.js'
import type { LoadPluggyHistoryOutput } from '../../../src/interactors/pluggy-history/load/load-pluggy-history.types.js'
import { currentCallContext } from '../../../src/infra/tools/call-context.js'

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

type LeaseCalls = { acquired: { itemId: string; trigger: string }[]; released: { itemId: string; fencingToken: number }[] }

function buildRequest(
  output: LoadPluggyHistoryOutput,
  overrides: {
    personId?: number | undefined
    itemId?: string
    leaseBusy?: boolean
    body?: Record<string, unknown>
  } = {},
): { req: AuthenticatedRequest & ScopedRequest; leaseCalls: LeaseCalls } {
  const leaseCalls: LeaseCalls = { acquired: [], released: [] }
  let fencingCounter = 0

  const req = {
    personId: 'personId' in overrides ? overrides.personId : 7,
    params: { itemId: overrides.itemId ?? 'item-1' },
    body: overrides.body,
    container: {
      resolve: (key: string) => {
        if (key === 'pluggyItemIngestionLeaseRep') {
          return {
            tryAcquire: async (itemId: string, trigger: string) => {
              leaseCalls.acquired.push({ itemId, trigger })
              if (overrides.leaseBusy) return undefined
              fencingCounter++
              return fencingCounter
            },
            renew: async () => true,
            release: async (itemId: string, fencingToken: number) => {
              leaseCalls.released.push({ itemId, fencingToken })
              return true
            },
          }
        }
        if (key === 'requestId') {
          return 'req-correlation-1'
        }
        return { execute: async () => output }
      },
    },
  } as unknown as AuthenticatedRequest & ScopedRequest

  return { req, leaseCalls }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createLoadPluggyHistoryHandler', () => {
  it('adquire o lease de ingestão antes de qualquer trabalho, com trigger MANUAL_HISTORY_LOAD', async () => {
    const { res } = buildResponse()
    const { req, leaseCalls } = buildRequest(DEFAULT_HISTORY)
    const handler = createLoadPluggyHistoryHandler(rootContainer, () => {})

    await handler(req, res)

    expect(leaseCalls.acquired).toEqual([{ itemId: 'item-1', trigger: 'MANUAL_HISTORY_LOAD' }])
  })

  it('lease ocupado recusa nomeado, sem chamar o caso de uso nem a sincronização de posição', async () => {
    const { res, sent } = buildResponse()
    const { req } = buildRequest(DEFAULT_HISTORY, { leaseBusy: true })
    let synced = false
    const handler = createLoadPluggyHistoryHandler(rootContainer, () => {
      synced = true
    })

    await handler(req, res)

    expect(sent.status).toBe(400)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_ITEM_INGESTION_IN_PROGRESS' })
    expect(synced).toBe(false)
  })

  it('responde 200 com o resultado do histórico e só então dispara a sincronização de posição', async () => {
    const { res, sent } = buildResponse()
    const { req } = buildRequest(DEFAULT_HISTORY)
    const order: string[] = []
    let syncArgs: [AppContainerInstance, string] | undefined

    const originalJson = res.json.bind(res)
    res.json = ((body: unknown) => {
      order.push('respondeu')
      return originalJson(body)
    }) as Response['json']

    const handler = createLoadPluggyHistoryHandler(rootContainer, (container, itemId, _leaseGuard, onSettled) => {
      order.push('syncPosition')
      syncArgs = [container, itemId]
      onSettled()
    })

    await handler(req, res)

    expect(sent.status).toBe(200)
    expect(sent.body).toEqual({ data: DEFAULT_HISTORY.data })
    // A ordem é o requisito: a resposta não pode esperar a sincronização de posição.
    expect(order).toEqual(['respondeu', 'syncPosition'])
    expect(syncArgs).toEqual([rootContainer, 'item-1'])
  })

  it('tasks.md 8.8/D30: History e o disparo de Position rodam sob trigger=MANUAL_HISTORY_LOAD, mesmo requestCorrelationId', async () => {
    const { res } = buildResponse()
    let historyContext: { trigger: string | undefined; requestCorrelationId: string | undefined } | undefined
    let positionContext: { trigger: string | undefined; requestCorrelationId: string | undefined } | undefined
    const req = {
      personId: 7,
      params: { itemId: 'item-1' },
      container: {
        resolve: (key: string) => {
          if (key === 'pluggyItemIngestionLeaseRep') {
            return { tryAcquire: async () => 1, renew: async () => true, release: async () => true }
          }
          if (key === 'requestId') {
            return 'req-correlation-1'
          }
          return {
            execute: async () => {
              const ctx = currentCallContext()
              historyContext = { trigger: ctx?.trigger, requestCorrelationId: ctx?.requestCorrelationId }
              return DEFAULT_HISTORY
            },
          }
        },
      },
    } as unknown as AuthenticatedRequest & ScopedRequest
    const handler = createLoadPluggyHistoryHandler(rootContainer, () => {
      const ctx = currentCallContext()
      positionContext = { trigger: ctx?.trigger, requestCorrelationId: ctx?.requestCorrelationId }
    })

    await handler(req, res)

    expect(historyContext).toEqual({ trigger: 'MANUAL_HISTORY_LOAD', requestCorrelationId: 'req-correlation-1' })
    expect(positionContext).toEqual({ trigger: 'MANUAL_HISTORY_LOAD', requestCorrelationId: 'req-correlation-1' })
  })

  it('libera o lease só depois que a sincronização de posição concluir (onSettled), nunca antes (D30)', async () => {
    const { res } = buildResponse()
    const { req, leaseCalls } = buildRequest(DEFAULT_HISTORY)
    let settle: (() => void) | undefined

    const handler = createLoadPluggyHistoryHandler(rootContainer, (_container, _itemId, _leaseGuard, onSettled) => {
      settle = onSettled
    })

    await handler(req, res)

    expect(leaseCalls.released).toEqual([])

    settle?.()
    await flushMicrotasks()

    expect(leaseCalls.released).toEqual([{ itemId: 'item-1', fencingToken: 1 }])
  })

  it('recusa nomeada do histórico vira 400 com {errorType, extras}, libera o lease, sem disparar sincronização', async () => {
    const { res, sent } = buildResponse()
    const error = new ApplicationError('PLUGGY_CREDENTIAL_ITEM_NOT_LINKED', { itemId: 'item-1' })
    const { req, leaseCalls } = buildRequest({ error })
    let synced = false

    const handler = createLoadPluggyHistoryHandler(rootContainer, () => {
      synced = true
    })

    await handler(req, res)

    expect(sent.status).toBe(400)
    expect(sent.body).toEqual({
      errorType: 'PLUGGY_CREDENTIAL_ITEM_NOT_LINKED',
      extras: { itemId: 'item-1' },
    })
    // Dono não confirmado: sincronizar posição gastaria I/O num item que pode não ser da pessoa.
    expect(synced).toBe(false)
    expect(leaseCalls.released).toEqual([{ itemId: 'item-1', fencingToken: 1 }])
  })

  it('erro lançado ao DISPARAR a sincronização de posição não derruba a resposta já enviada, e libera o lease', async () => {
    const { res, sent } = buildResponse()
    const { req, leaseCalls } = buildRequest(DEFAULT_HISTORY)
    const handler = createLoadPluggyHistoryHandler(rootContainer, () => {
      throw new Error('syncPosition não deveria propagar')
    })

    await expect(handler(req, res)).resolves.toBeUndefined()
    expect(sent.status).toBe(200)
    expect(sent.body).toEqual({ data: DEFAULT_HISTORY.data })
    expect(leaseCalls.released).toEqual([{ itemId: 'item-1', fencingToken: 1 }])
  })

  it('itemId ausente na rota recusa nomeando o campo, sem chamar o caso de uso nem a sincronização', async () => {
    const { res, sent } = buildResponse()
    const { req } = buildRequest(DEFAULT_HISTORY, { itemId: '  ' })
    let synced = false
    const handler = createLoadPluggyHistoryHandler(rootContainer, () => {
      synced = true
    })

    await handler(req, res)

    expect(sent.status).toBe(400)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_HISTORY_ITEM_ID_MISSING' })
    expect(synced).toBe(false)
  })

  it('sem personId responde 500 sem vazar detalhe — a rota nunca deveria ser alcançável assim', async () => {
    const { res, sent } = buildResponse()
    const { req } = buildRequest(DEFAULT_HISTORY, { personId: undefined })
    const handler = createLoadPluggyHistoryHandler(rootContainer, () => {})

    await handler(req, res)

    expect(sent.status).toBe(500)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
  })

  it('erro inesperado no wiring do histórico vira 500 controlado, nunca stack trace, e libera o lease', async () => {
    const { res, sent } = buildResponse()
    const handler = createLoadPluggyHistoryHandler(rootContainer, () => {})
    const leaseCalls: LeaseCalls = { acquired: [], released: [] }
    const req = {
      personId: 7,
      params: { itemId: 'item-1' },
      container: {
        resolve: (key: string) => {
          if (key === 'pluggyItemIngestionLeaseRep') {
            return {
              tryAcquire: async () => {
                leaseCalls.acquired.push({ itemId: 'item-1', trigger: 'MANUAL_HISTORY_LOAD' })
                return 1
              },
              renew: async () => true,
              release: async (itemId: string, fencingToken: number) => {
                leaseCalls.released.push({ itemId, fencingToken })
                return true
              },
            }
          }
          throw new Error('registro ausente no container')
        },
      },
    } as unknown as AuthenticatedRequest & ScopedRequest

    await handler(req, res)

    expect(sent.status).toBe(500)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_HISTORY_LOAD_FAILED' })
    expect(leaseCalls.released).toEqual([{ itemId: 'item-1', fencingToken: 1 }])
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
        resolve: (key: string) => {
          if (key === 'pluggyItemIngestionLeaseRep') {
            return { tryAcquire: async () => 1, renew: async () => true, release: async () => true }
          }
          return {
            execute: async (input: unknown) => {
              executedInput = input
              return DEFAULT_HISTORY
            },
          }
        },
      },
    } as unknown as AuthenticatedRequest & ScopedRequest

    await handler(req, res)

    expect(executedInput).toMatchObject({ origin: 'USER', personId: 42, itemId: 'item-1' })
  })
})
