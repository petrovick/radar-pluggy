import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyJwt } from '../../src/shared/jwt-verifier.js'
import { ApplicationError } from '../../src/shared/application-error.js'

const SECRET = 'a-secret-with-at-least-32-characters!!'

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

// Mesma assinatura que JwtHandler.sign faz no oplab-radar-api — reimplementada aqui só pro teste
// gerar um token real, não pra reaproveitar produção.
function signToken(payload: Record<string, unknown>, secret = SECRET): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

describe('verifyJwt', () => {
  it('devolve sub e exp de um token assinado corretamente', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    const token = signToken({ sub: 'usuario-exemplo', exp })

    expect(verifyJwt(token, SECRET)).toEqual({ sub: 'usuario-exemplo', exp })
  })

  it('recusa com JWT_SIGNATURE_INVALID quando o segredo não bate', () => {
    const token = signToken({ sub: 'usuario-exemplo', exp: Math.floor(Date.now() / 1000) + 3600 })

    expect(() => verifyJwt(token, 'outro-segredo-com-32-caracteres!')).toThrow(ApplicationError)
    try {
      verifyJwt(token, 'outro-segredo-com-32-caracteres!')
    } catch (error) {
      expect((error as ApplicationError).errorType).toBe('JWT_SIGNATURE_INVALID')
    }
  })

  it('recusa com JWT_EXPIRED quando exp já passou', () => {
    const token = signToken({ sub: 'usuario-exemplo', exp: Math.floor(Date.now() / 1000) - 10 })

    try {
      verifyJwt(token, SECRET)
      expect.unreachable()
    } catch (error) {
      expect((error as ApplicationError).errorType).toBe('JWT_EXPIRED')
    }
  })

  it('recusa com JWT_MALFORMED quando o token não tem três partes', () => {
    try {
      verifyJwt('token-invalido', SECRET)
      expect.unreachable()
    } catch (error) {
      expect((error as ApplicationError).errorType).toBe('JWT_MALFORMED')
    }
  })

  it('recusa com JWT_MALFORMED quando falta sub ou exp no payload', () => {
    const token = signToken({ sub: 'usuario-exemplo' })

    try {
      verifyJwt(token, SECRET)
      expect.unreachable()
    } catch (error) {
      expect((error as ApplicationError).errorType).toBe('JWT_MALFORMED')
    }
  })
})
