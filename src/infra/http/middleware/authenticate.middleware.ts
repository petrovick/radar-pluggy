import type { NextFunction, Request, Response } from 'express'
import { ApplicationError } from '../../../shared/application-error.js'
import { verifyJwt } from '../../../shared/jwt-verifier.js'
import type { ScopedRequest } from './request-scope.middleware.js'
import type { Config } from '../../config/config.js'

export interface AuthenticatedRequest extends Request {
  personId?: number
}

const readSessionCookie = (req: Request): string | undefined =>
  req.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('radar_session='))?.slice('radar_session='.length)

// A sessão opaca vem do cookie e é introspectada pela API central. O caminho Bearer legado
// permanece apenas durante a janela dual de migração. `personId` nunca vem do corpo.
//
// O repositório sai do escopo da requisição, não do parâmetro: `createRequestScopeMiddleware` roda
// em `app.use` antes de qualquer rota, e resolver na raiz transformaria um registro `scoped` em
// singleton de processo.
export function createAuthenticateMiddleware(
  secret: string,
  introspection?: Config['sessionIntrospection'],
  fetchImpl: typeof fetch = fetch,
) {
  return async function authenticate(
    req: AuthenticatedRequest & ScopedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const sessionToken = readSessionCookie(req)
    if (sessionToken !== undefined) {
      if (!/^[0-9a-f]{64}$/.test(sessionToken) || !introspection) {
        res.status(401).json({ errorType: 'PLUGGY_CONNECTOR_UNAUTHORIZED' })
        return
      }
      if (req.container === undefined) {
        res.status(500).json({ errorType: 'PLUGGY_CONNECTOR_AUTHENTICATION_FAILED' })
        return
      }
      try {
        const response = await fetchImpl(introspection.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Radar-Service-Token': introspection.serviceToken },
          body: JSON.stringify({
            sessionToken,
            csrfToken: req.headers['x-csrf-token'] ?? null,
            origin: req.headers.origin ?? null,
          }),
          signal: AbortSignal.timeout(introspection.timeoutMs),
        })
        if (response.status === 401) {
          res.status(401).json({ errorType: 'PLUGGY_CONNECTOR_UNAUTHORIZED' })
          return
        }
        if (!response.ok) {
          res.status(503).json({ errorType: 'PLUGGY_CONNECTOR_AUTHENTICATION_UNAVAILABLE' })
          return
        }
        const result = await response.json() as { personId?: unknown; csrfValid?: unknown; originValid?: unknown }
        if (!Number.isInteger(result.personId) || (result.personId as number) < 1) {
          res.status(401).json({ errorType: 'PLUGGY_CONNECTOR_UNAUTHORIZED' })
          return
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
          (result.originValid !== true || result.csrfValid !== true)) {
          res.status(403).json({ errorType: 'PLUGGY_CONNECTOR_CSRF_REJECTED' })
          return
        }
        req.personId = result.personId as number
        next()
      } catch {
        res.status(503).json({ errorType: 'PLUGGY_CONNECTOR_AUTHENTICATION_UNAVAILABLE' })
      }
      return
    }

    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined

    if (!token) {
      res.status(401).json({ errorType: 'PLUGGY_CONNECTOR_UNAUTHORIZED' })
      return
    }

    if (req.container === undefined) {
      // Escopo ausente é erro de wiring (middleware de escopo fora de ordem), não recusa de quem
      // chamou: 500 nomeado, nunca 401 — 401 mandaria o cliente tentar outro token à toa.
      res.status(500).json({ errorType: 'PLUGGY_CONNECTOR_AUTHENTICATION_FAILED' })
      return
    }

    try {
      const claims = verifyJwt(token, secret)
      const personId = await req.container.resolve('personRep').findIdByUsername(claims.sub)
      if (personId === undefined) {
        res.status(401).json({ errorType: 'PLUGGY_CONNECTOR_UNAUTHORIZED' })
        return
      }

      req.personId = personId
      next()
    } catch (error) {
      if (error instanceof ApplicationError) {
        res.status(401).json({ errorType: 'PLUGGY_CONNECTOR_UNAUTHORIZED' })
        return
      }
      res.status(500).json({ errorType: 'PLUGGY_CONNECTOR_AUTHENTICATION_FAILED' })
    }
  }
}
