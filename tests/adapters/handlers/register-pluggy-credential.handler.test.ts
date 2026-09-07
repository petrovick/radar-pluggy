import type { Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { createRegisterPluggyCredentialHandler } from '../../../src/adapters/handlers/register-pluggy-credential.handler.js'
import type { AppContainerInstance } from '../../../src/infra/bootstrap/register.js'
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

const rootContainer = {} as AppContainerInstance

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

describe('createRegisterPluggyCredentialHandler', () => {
  it('delega ao interactor com personId de req.personId (nunca do corpo), responde 201 e só então dispara loadItem', async () => {
    const execute = vi.fn().mockResolvedValue({ data: { credentialId: 7 } })
    const res = fakeResponse()
    const order: string[] = []
    let loadArgs: [AppContainerInstance, number, string] | undefined

    res.json = vi.fn().mockImplementation(() => {
      order.push('respondeu')
      return res
    })

    const handler = createRegisterPluggyCredentialHandler(rootContainer, (container, personId, itemId) => {
      order.push('loadItem')
      loadArgs = [container, personId, itemId]
    })

    await handler(fakeRequest(execute, 1, { clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' }), res)

    expect(execute).toHaveBeenCalledWith({ personId: 1, clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' })
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ id: 7 })
    // A ordem é o requisito: a resposta não pode esperar o pré-carregamento.
    expect(order).toEqual(['respondeu', 'loadItem'])
    expect(loadArgs).toEqual([rootContainer, 1, 'item-1'])
  })

  it('ignora um personId enviado no corpo — usa só req.personId', async () => {
    const execute = vi.fn().mockResolvedValue({ data: { credentialId: 7 } })
    const res = fakeResponse()
    const handler = createRegisterPluggyCredentialHandler(rootContainer, () => {})

    await handler(
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
    let loaded = false
    const handler = createRegisterPluggyCredentialHandler(rootContainer, () => {
      loaded = true
    })

    await handler(fakeRequest(execute, 1, { clientId: 'client-1', clientSecret: 'segredo' }), res)

    expect(execute).toHaveBeenCalledWith({ personId: 1, clientId: 'client-1', clientSecret: 'segredo', itemId: '' })
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CREDENTIAL_FIELD_MISSING', extras: { field: 'itemId' } })
    // Recusa de negócio: não há item cadastrado, então não há o que pré-carregar.
    expect(loaded).toBe(false)
  })

  it('responde 500 nomeado quando req.personId está ausente, sem chamar o interactor nem loadItem', async () => {
    const execute = vi.fn()
    const res = fakeResponse()
    let loaded = false
    const handler = createRegisterPluggyCredentialHandler(rootContainer, () => {
      loaded = true
    })

    await handler(fakeRequest(execute, undefined, { clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' }), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
    expect(execute).not.toHaveBeenCalled()
    expect(loaded).toBe(false)
  })

  it('responde 500 sem vazar detalhe quando o wiring falha ao resolver o caso de uso, sem loadItem', async () => {
    const res = fakeResponse()
    let loaded = false
    const handler = createRegisterPluggyCredentialHandler(rootContainer, () => {
      loaded = true
    })
    const req = {
      personId: 1,
      body: { clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' },
      container: {
        resolve: () => {
          throw new Error('registro ausente no container')
        },
      },
    } as unknown as AuthenticatedRequest & ScopedRequest

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CREDENTIAL_REGISTRATION_FAILED' })
    expect(loaded).toBe(false)
  })

  it('resposta sem data e sem error vira 500, nunca 201 com id ausente, sem loadItem', async () => {
    const execute = vi.fn().mockResolvedValue({})
    const res = fakeResponse()
    let loaded = false
    const handler = createRegisterPluggyCredentialHandler(rootContainer, () => {
      loaded = true
    })

    await handler(fakeRequest(execute, 1, { clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' }), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CREDENTIAL_REGISTRATION_FAILED' })
    expect(loaded).toBe(false)
  })

  it('erro lançado por loadItem não derruba a resposta 201 já enviada', async () => {
    const execute = vi.fn().mockResolvedValue({ data: { credentialId: 7 } })
    const res = fakeResponse()
    const handler = createRegisterPluggyCredentialHandler(rootContainer, () => {
      throw new Error('loadItem não deveria propagar')
    })

    await expect(
      handler(fakeRequest(execute, 1, { clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' }), res),
    ).resolves.toBeUndefined()

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ id: 7 })
  })
})
