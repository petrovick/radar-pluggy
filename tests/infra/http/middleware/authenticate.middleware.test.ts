import { createHmac } from 'node:crypto'
import type { Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { createAuthenticateMiddleware, type AuthenticatedRequest } from '../../../../src/infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../../../src/infra/http/middleware/request-scope.middleware.js'
import type { PersonRep } from '../../../../src/adapters/repositories/person.rep.js'

const SECRET = 'a-secret-with-at-least-32-characters!!'

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function signToken(payload: Record<string, unknown>, secret = SECRET): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

// O middleware resolve `personRep` do escopo da requisição, montado por
// `createRequestScopeMiddleware` antes das rotas — o fake reproduz só isso.
function fakeRequest(
  authorization: string | undefined,
  personRep: PersonRep | undefined,
): AuthenticatedRequest & ScopedRequest {
  return {
    headers: { authorization },
    ...(personRep === undefined ? {} : { container: { resolve: () => personRep } }),
  } as unknown as AuthenticatedRequest & ScopedRequest
}

function fakePersonRep(findIdByUsername: PersonRep['findIdByUsername']): PersonRep {
  return { findIdByUsername } as unknown as PersonRep
}

function fakeResponse(): Response {
  const res = {} as Response
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

describe('createAuthenticateMiddleware', () => {
  it('resolve personId e chama next quando o token é válido e o username existe', async () => {
    const people = fakePersonRep(vi.fn().mockResolvedValue(7))
    const middleware = createAuthenticateMiddleware(SECRET)

    const token = signToken({ sub: 'usuario-exemplo', exp: Math.floor(Date.now() / 1000) + 3600 })
    const req = fakeRequest(`Bearer ${token}`, people)
    const res = fakeResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(people.findIdByUsername).toHaveBeenCalledWith('usuario-exemplo')
    expect(req.personId).toBe(7)
    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('responde 401 genérico sem header de autorização', async () => {
    const people = fakePersonRep(vi.fn())
    const middleware = createAuthenticateMiddleware(SECRET)

    const req = fakeRequest(undefined, people)
    const res = fakeResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CONNECTOR_UNAUTHORIZED' })
    expect(next).not.toHaveBeenCalled()
    expect(people.findIdByUsername).not.toHaveBeenCalled()
  })

  it('responde 401 genérico com assinatura inválida, sem revelar o motivo', async () => {
    const people = fakePersonRep(vi.fn())
    const middleware = createAuthenticateMiddleware(SECRET)

    const token = signToken({ sub: 'usuario-exemplo', exp: Math.floor(Date.now() / 1000) + 3600 }, 'segredo-errado-32-caracteres!!!')
    const req = fakeRequest(`Bearer ${token}`, people)
    const res = fakeResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CONNECTOR_UNAUTHORIZED' })
    expect(next).not.toHaveBeenCalled()
  })

  it('responde 401 genérico quando o username do token não corresponde a nenhuma pessoa', async () => {
    const people = fakePersonRep(vi.fn().mockResolvedValue(undefined))
    const middleware = createAuthenticateMiddleware(SECRET)

    const token = signToken({ sub: 'fantasma', exp: Math.floor(Date.now() / 1000) + 3600 })
    const req = fakeRequest(`Bearer ${token}`, people)
    const res = fakeResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(req.personId).toBeUndefined()
    expect(next).not.toHaveBeenCalled()
  })

  it('responde 500 nomeado (não o 401 genérico) quando a leitura de people falha de forma inesperada', async () => {
    const people = fakePersonRep(vi.fn().mockRejectedValue(new Error('conexão caiu')))
    const middleware = createAuthenticateMiddleware(SECRET)

    const token = signToken({ sub: 'usuario-exemplo', exp: Math.floor(Date.now() / 1000) + 3600 })
    const req = fakeRequest(`Bearer ${token}`, people)
    const res = fakeResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CONNECTOR_AUTHENTICATION_FAILED' })
    expect(next).not.toHaveBeenCalled()
  })

  it('responde 500 nomeado quando o escopo da requisição não chegou — é erro de wiring, não recusa', async () => {
    const middleware = createAuthenticateMiddleware(SECRET)

    const token = signToken({ sub: 'usuario-exemplo', exp: Math.floor(Date.now() / 1000) + 3600 })
    const req = fakeRequest(`Bearer ${token}`, undefined)
    const res = fakeResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    // 401 aqui mandaria o cliente tentar outro token à toa; o token dele está correto.
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ errorType: 'PLUGGY_CONNECTOR_AUTHENTICATION_FAILED' })
    expect(next).not.toHaveBeenCalled()
  })

  it('responde 401 quando o token expirou', async () => {
    const people = fakePersonRep(vi.fn())
    const middleware = createAuthenticateMiddleware(SECRET)

    const token = signToken({ sub: 'usuario-exemplo', exp: Math.floor(Date.now() / 1000) - 10 })
    const req = fakeRequest(`Bearer ${token}`, people)
    const res = fakeResponse()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })
})
