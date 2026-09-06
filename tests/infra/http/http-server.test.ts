import { createHmac } from 'node:crypto'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createHttpServer } from '../../../src/infra/http/http-server.js'
import type { AppContainerInstance } from '../../../src/infra/bootstrap/register.js'
import type { RegisterPluggyCredentialOutput } from '../../../src/interactors/pluggy-credential/register/register-pluggy-credential.types.js'
import type { CheckHealthOutput } from '../../../src/interactors/health/check/check-health.types.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

const SECRET = 'a-secret-with-at-least-32-characters!!'

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function signToken(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const signature = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

const validToken = signToken({ sub: 'usuario-exemplo', exp: Math.floor(Date.now() / 1000) + 3600 })

// Prova que a rota registrada em createHttpServer é alcançável por uma chamada HTTP real, de ponta a
// ponta (Express + express.json() + middleware de escopo + middleware de autenticação + o handler) —
// não só que o handler funciona isolado.
describe('createHttpServer', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()))
      server = undefined
    }
  })

  // Container falso com o mínimo que as rotas resolvem do escopo: o repositório de pessoa que o
  // middleware de autenticação usa e o caso de uso de cadastro. Nenhum banco é tocado.
  function fakeContainer(options: {
    personId?: number | undefined
    register?: () => Promise<RegisterPluggyCredentialOutput>
    checkHealth?: () => Promise<CheckHealthOutput>
  }): AppContainerInstance {
    const registrations: Record<string, unknown> = {
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      personRep: { findIdByUsername: async () => ('personId' in options ? options.personId : 1) },
      registerPluggyCredentialInteractor: {
        execute: options.register ?? (async () => ({ data: { credentialId: 9 } })),
      },
      checkHealthInteractor: { execute: options.checkHealth ?? (async () => ({ data: { running: true } })) },
    }
    const scope = {
      register: () => {},
      resolve: (key: string) => registrations[key],
    }
    return { createScope: () => scope } as unknown as AppContainerInstance
  }

  function listen(container: AppContainerInstance) {
    const app = createHttpServer({ jwtSecret: SECRET, container })
    return new Promise<number>((resolve) => {
      server = app.listen(0, () => {
        const address = server?.address()
        resolve(typeof address === 'object' && address ? address.port : 0)
      })
    })
  }

  it('GET /healthcheck responde 200 sem Authorization — é a plataforma quem chama, não um titular', async () => {
    const port = await listen(fakeContainer({}))

    const response = await fetch(`http://127.0.0.1:${port}/healthcheck`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ running: true })
  })

  it('GET /healthcheck com banco indisponível responde 503, nunca 200', async () => {
    const port = await listen(
      fakeContainer({
        checkHealth: async () => ({ error: new ApplicationError('PLUGGY_CONNECTOR_DATABASE_UNAVAILABLE') }),
      }),
    )

    const response = await fetch(`http://127.0.0.1:${port}/healthcheck`)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ errorType: 'PLUGGY_CONNECTOR_DATABASE_UNAVAILABLE' })
  })

  it('POST /credentials sem Authorization responde 401, sem chamar o interactor', async () => {
    let called = false
    const port = await listen(
      fakeContainer({
        register: async () => {
          called = true
          return { data: { credentialId: 9 } }
        },
      }),
    )

    const response = await fetch(`http://127.0.0.1:${port}/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' }),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ errorType: 'PLUGGY_CONNECTOR_UNAUTHORIZED' })
    expect(called).toBe(false)
  })

  it('POST /credentials com token válido cadastra e responde 201 com o id', async () => {
    const port = await listen(fakeContainer({}))

    const response = await fetch(`http://127.0.0.1:${port}/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${validToken}` },
      body: JSON.stringify({ clientId: 'client-1', clientSecret: 'segredo', itemId: 'item-1' }),
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ id: 9 })
  })

  it('POST /credentials sem itemId responde 400 nomeando o campo, via requisição HTTP real', async () => {
    const port = await listen(
      fakeContainer({
        register: async () => ({
          error: new ApplicationError('PLUGGY_CREDENTIAL_FIELD_MISSING', { field: 'itemId' }),
        }),
      }),
    )

    const response = await fetch(`http://127.0.0.1:${port}/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${validToken}` },
      body: JSON.stringify({ clientId: 'client-1', clientSecret: 'segredo' }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ errorType: 'PLUGGY_CREDENTIAL_FIELD_MISSING', extras: { field: 'itemId' } })
  })

  it('POST /credentials com JSON malformado responde {errorType} controlado, nunca HTML com stack trace', async () => {
    const port = await listen(fakeContainer({}))

    const response = await fetch(`http://127.0.0.1:${port}/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${validToken}` },
      body: '{ isso não é json',
    })

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = await response.text()
    expect(body).not.toContain('SyntaxError')
    expect(body).not.toContain('node_modules')
    expect(JSON.parse(body)).toEqual({ errorType: 'PLUGGY_CONNECTOR_MALFORMED_JSON' })
  })
})
