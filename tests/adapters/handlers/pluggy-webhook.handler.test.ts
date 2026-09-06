import type { Request, Response } from 'express'
import { describe, expect, it } from 'vitest'
import { createPluggyWebhookHandler } from '../../../src/adapters/handlers/pluggy-webhook.handler.js'
import type { AppContainerInstance } from '../../../src/infra/bootstrap/register.js'
import type { ScopedRequest } from '../../../src/infra/http/middleware/request-scope.middleware.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

const ITEM_ID = '00000000-0000-0000-0000-000000000001'

function buildResponse() {
  const sent: { status?: number; body?: unknown; at?: number } = {}
  const res = {
    status(code: number) {
      sent.status = code
      return this
    },
    json(body: unknown) {
      sent.body = body
      sent.at = Date.now()
      return this
    },
  } as unknown as Response
  return { res, sent }
}

function buildRequest(output: unknown, secret = 'segredo'): Request & ScopedRequest {
  return {
    headers: { 'x-pluggy-connector-secret': secret },
    body: { eventId: 'evt-1', itemId: ITEM_ID, event: 'item/updated' },
    container: { resolve: () => ({ execute: async () => output }) },
  } as unknown as Request & ScopedRequest
}

const container = {} as AppContainerInstance

describe('createPluggyWebhookHandler', () => {
  it('responde 202 com o evento já aceito e só então dispara a drenagem', async () => {
    const order: string[] = []
    const { res, sent } = buildResponse()
    const handler = createPluggyWebhookHandler(container, () => {
      order.push('drain')
    })

    const originalJson = res.json.bind(res)
    res.json = ((body: unknown) => {
      order.push('respondeu')
      return originalJson(body)
    }) as Response['json']

    await handler(buildRequest({ data: { accepted: true, alreadyKnown: false } }), res)

    expect(sent.status).toBe(202)
    // A ordem é o requisito: a Pluggy exige 2xx em menos de 5 segundos, e a carga não cabe nisso.
    expect(order).toEqual(['respondeu', 'drain'])
  })

  it('notificação não confiável responde 401 e não drena', async () => {
    let drained = false
    const { res, sent } = buildResponse()
    const handler = createPluggyWebhookHandler(container, () => {
      drained = true
    })

    await handler(buildRequest({ error: new ApplicationError('PLUGGY_WEBHOOK_NOT_TRUSTED') }, 'errado'), res)

    expect(sent.status).toBe(401)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_WEBHOOK_NOT_TRUSTED' })
    expect(drained).toBe(false)
  })

  it('payload incompleto responde 400, sem revelar nada sobre o item', async () => {
    const { res, sent } = buildResponse()
    const handler = createPluggyWebhookHandler(container, () => {})

    await handler(buildRequest({ error: new ApplicationError('PLUGGY_WEBHOOK_EVENT_ID_MISSING') }), res)

    expect(sent.status).toBe(400)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_WEBHOOK_EVENT_ID_MISSING' })
  })

  it('falha nossa responde 503 para a Pluggy reentregar, nunca 400 que descarta o evento', async () => {
    const { res, sent } = buildResponse()
    const handler = createPluggyWebhookHandler(container, () => {})

    // Banco fora do ar na leitura da credencial. A recusa acontece ANTES de o evento chegar à inbox,
    // então 400 aqui perderia o evento de vez: 4xx diz à Pluggy que não vale reentregar.
    await handler(buildRequest({ error: new ApplicationError('PLUGGY_WEBHOOK_ACCEPT_FAILED', { itemId: ITEM_ID }) }), res)

    expect(sent.status).toBe(503)
  })

  it('errorType interno não vai no corpo de uma resposta a chamador não autenticado', async () => {
    const { res, sent } = buildResponse()
    const handler = createPluggyWebhookHandler(container, () => {})

    await handler(
      buildRequest({ error: new ApplicationError('PLUGGY_CREDENTIAL_ENCRYPTION_KEY_MISSING') }),
      res,
    )

    expect(sent.status).toBe(503)
    // Diria a quem chamou como este serviço está configurado.
    expect(sent.body).toEqual({ errorType: 'PLUGGY_WEBHOOK_ACCEPT_FAILED' })
  })

  it('recusa nova e não classificada é retentável por default — errar para o lado de reentregar', async () => {
    const { res, sent } = buildResponse()
    const handler = createPluggyWebhookHandler(container, () => {})

    await handler(buildRequest({ error: new ApplicationError('PLUGGY_WEBHOOK_ALGO_QUE_AINDA_NAO_EXISTE') }), res)

    expect(sent.status).toBe(503)
  })

  it('reentrega do mesmo evento também responde 2xx — reconhecer é o que impede a Pluggy de insistir', async () => {
    const { res, sent } = buildResponse()
    const handler = createPluggyWebhookHandler(container, () => {})

    await handler(buildRequest({ data: { accepted: true, alreadyKnown: true } }), res)

    expect(sent.status).toBe(202)
    expect(sent.body).toEqual({ data: { accepted: true, alreadyKnown: true } })
  })

  it('sem header de segredo, o caso de uso recebe string vazia e recusa — nunca undefined vazando', async () => {
    let received: { providedSecret?: string } = {}
    const { res } = buildResponse()
    const handler = createPluggyWebhookHandler(container, () => {})

    const req = {
      headers: {},
      body: { eventId: 'evt-1', itemId: ITEM_ID, event: 'item/updated' },
      container: {
        resolve: () => ({
          execute: async (input: { providedSecret?: string }) => {
            received = input
            return { error: new ApplicationError('PLUGGY_WEBHOOK_NOT_TRUSTED') }
          },
        }),
      },
    } as unknown as Request & ScopedRequest

    await handler(req, res)

    expect(received.providedSecret).toBe('')
  })

  it('erro inesperado responde 500 controlado, nunca stack trace', async () => {
    const { res, sent } = buildResponse()
    const handler = createPluggyWebhookHandler(container, () => {})

    const req = {
      headers: {},
      body: {},
      container: {
        resolve: () => {
          throw new Error('registro ausente')
        },
      },
    } as unknown as Request & ScopedRequest

    await handler(req, res)

    expect(sent.status).toBe(500)
    expect(sent.body).toEqual({ errorType: 'PLUGGY_WEBHOOK_ACCEPT_FAILED' })
  })
})
