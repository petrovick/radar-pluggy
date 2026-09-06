import { createHmac, timingSafeEqual } from 'node:crypto'
import { ApplicationError } from './application-error.js'

export interface JwtClaims {
  sub: string
  exp: number
}

// Mesmo algoritmo hand-rolled do oplab-radar-api (JwtHandler.verify): HS256 sem lib externa,
// header.body em base64url, assinatura HMAC-SHA256, comparação em tempo constante (mesmo
// raciocínio da regra 9 de fronteira-pluggy, aplicado aqui ao segredo entre serviços). O segredo é
// o mesmo valor configurado em `config.http.jwtSecret` no oplab-radar-api — combinado por variável
// de ambiente entre os dois serviços, nunca gerado aqui.
export function verifyJwt(token: string, secret: string): JwtClaims {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new ApplicationError('JWT_MALFORMED')
  }
  const [header, body, signature] = parts as [string, string, string]

  const expectedSignature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new ApplicationError('JWT_SIGNATURE_INVALID')
  }

  let claims: unknown
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString())
  } catch {
    throw new ApplicationError('JWT_MALFORMED')
  }

  if (
    typeof claims !== 'object' ||
    claims === null ||
    typeof (claims as Record<string, unknown>).sub !== 'string' ||
    typeof (claims as Record<string, unknown>).exp !== 'number'
  ) {
    throw new ApplicationError('JWT_MALFORMED')
  }

  const { sub, exp } = claims as { sub: string; exp: number }
  if (exp < Math.floor(Date.now() / 1000)) {
    throw new ApplicationError('JWT_EXPIRED')
  }

  return { sub, exp }
}
