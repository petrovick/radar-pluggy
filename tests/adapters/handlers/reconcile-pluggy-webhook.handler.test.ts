import type { Response } from 'express'
import { describe, expect, it } from 'vitest'
import { reconcilePluggyWebhookHandler } from '../../../src/adapters/handlers/reconcile-pluggy-webhook.handler.js'
import type { AuthenticatedRequest } from '../../../src/infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../../src/infra/http/middleware/request-scope.middleware.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

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

function buildRequest(output: unknown, overrides: { personId?: number | undefined } = {}) {
  return {
    personId: 'personId' in overrides ? overrides.personId : 7,
    container: { resolve: () => ({ execute: async () => output }) },
  } as unknown as AuthenticatedRequest & ScopedRequest
}

describe('reconcilePluggyWebhookHandler', () => {
  it('devolve 200 com o resumo do que foi provisionado', async () => {
    const { res, sent } = buildResponse()
    const data = { provisioned: 2, updated: 1, failed: 0 }

    await reconcilePluggyWebhookHandler(buildRequest({ data }), res)

    expect(sent.status).toBe(200)
    expect(sent.body).toEqual({ data })
  })

  it('recusa nomeada vira 400 com {errorType, extras}', async () => {
    const { res, sent } = buildResponse()
    const error = new ApplicationError('PLUGGY_WEBHOOK_URL_MISSING', { esperado: 'https' })

    await reconcilePluggyWebhookHandler(buildRequest({ error }), res)

    expect(sent.status).toBe(400)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_WEBHOOK_URL_MISSING', extras: { esperado: 'https' } })
  })

  it('sem personId responde 500 — a rota fica atrás do middleware de autenticação', async () => {
    const { res, sent } = buildResponse()

    await reconcilePluggyWebhookHandler(buildRequest({}, { personId: undefined }), res)

    expect(sent.status).toBe(500)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
  })

  it('erro inesperado no wiring vira 500 controlado, nunca stack trace', async () => {
    const { res, sent } = buildResponse()
    const req = {
      personId: 7,
      container: {
        resolve: () => {
          throw new Error('registro ausente no container')
        },
      },
    } as unknown as AuthenticatedRequest & ScopedRequest

    await reconcilePluggyWebhookHandler(req, res)

    expect(sent.status).toBe(500)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_WEBHOOK_RECONCILIATION_FAILED' })
  })

  it('repassa personId autenticado do JWT ao interactor', async () => {
    const { res } = buildResponse()
    let executedInput: unknown

    const req = {
      personId: 42,
      container: {
        resolve: () => ({
          execute: async (input: unknown) => {
            executedInput = input
            return { data: { provisioned: 1, updated: 0, failed: 0 } }
          },
        }),
      },
    } as unknown as AuthenticatedRequest & ScopedRequest

    await reconcilePluggyWebhookHandler(req, res)

    expect(executedInput).toEqual({ personId: 42 })
  })
})
