import type { NextFunction, Request, Response } from 'express'
import { ApplicationError } from '../../../shared/application-error.js'
import { verifyJwt } from '../../../shared/jwt-verifier.js'
import type { ScopedRequest } from './request-scope.middleware.js'

export interface AuthenticatedRequest extends Request {
  personId?: number
}

// Único middleware de autenticação do serviço: extrai o Bearer, verifica o mesmo JWT que o
// oplab-radar-api emite (segredo combinado por variável de ambiente) e resolve `personId` a partir
// do username (`sub`), lendo `people` (fronteira-pluggy regra 13: só leitura). Nunca confia em
// `personId` vindo do corpo da requisição — é exatamente o que este middleware existe para evitar.
// Resposta genérica em qualquer recusa (token ausente, assinatura inválida, expirado, username sem
// pessoa correspondente): não expõe qual delas foi, pra não ajudar quem está tentando adivinhar.
//
// O repositório sai do escopo da requisição, não do parâmetro: `createRequestScopeMiddleware` roda
// em `app.use` antes de qualquer rota, e resolver na raiz transformaria um registro `scoped` em
// singleton de processo.
export function createAuthenticateMiddleware(secret: string) {
  return async function authenticate(
    req: AuthenticatedRequest & ScopedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
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
