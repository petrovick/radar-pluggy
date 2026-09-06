import type { Request, Response } from 'express'
import { describe, expect, it } from 'vitest'
import { checkHealthHandler } from '../../../src/adapters/handlers/health.handler.js'
import type { ScopedRequest } from '../../../src/infra/http/middleware/request-scope.middleware.js'
import { ApplicationError } from '../../../src/shared/application-error.js'
import type { CheckHealthOutput } from '../../../src/interactors/health/check/check-health.types.js'

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

function buildRequest(output: CheckHealthOutput, hasContainer = true): Request & ScopedRequest {
  return {
    container: hasContainer ? { resolve: () => ({ execute: async () => output }) } : undefined,
  } as unknown as Request & ScopedRequest
}

describe('checkHealthHandler', () => {
  it('devolve 200 quando o caso de uso confirma que o processo está saudável', async () => {
    const { res, sent } = buildResponse()

    await checkHealthHandler(buildRequest({ data: { running: true } }), res)

    expect(sent.status).toBe(200)
    expect(sent.body).toEqual({ running: true })
  })

  it('recusa nomeada do caso de uso vira 503', async () => {
    const { res, sent } = buildResponse()
    const error = new ApplicationError('PLUGGY_CONNECTOR_DATABASE_UNAVAILABLE')

    await checkHealthHandler(buildRequest({ error }), res)

    expect(sent.status).toBe(503)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_CONNECTOR_DATABASE_UNAVAILABLE' })
  })

  it('sem escopo de requisição responde 500 sem vazar detalhe', async () => {
    const { res, sent } = buildResponse()

    await checkHealthHandler(buildRequest({}, false), res)

    expect(sent.status).toBe(500)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
  })

  it('erro inesperado no wiring vira 503 controlado, nunca stack trace', async () => {
    const { res, sent } = buildResponse()
    const req = {
      container: {
        resolve: () => {
          throw new Error('registro ausente no container')
        },
      },
    } as unknown as Request & ScopedRequest

    await checkHealthHandler(req, res)

    expect(sent.status).toBe(503)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_CONNECTOR_DATABASE_UNAVAILABLE' })
  })
})
