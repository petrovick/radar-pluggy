import type { NextFunction, Request, Response } from 'express'
import type { AppContainerInstance } from '../../bootstrap/register.js'
import { createScope } from '../../bootstrap/scope.js'

// Um escopo de container por request — mesmo papel do `request-id.ts` no `oplab-radar-api`. É o que
// dá a cada requisição o seu próprio detentor de transação e o seu próprio logger com contexto:
// duas requisições simultâneas nunca compartilham transação (ver `bootstrap/scope.ts`).
export interface ScopedRequest extends Request {
  container?: AppContainerInstance
}

export function createRequestScopeMiddleware(container: AppContainerInstance) {
  return function attachRequestScope(req: ScopedRequest, _res: Response, next: NextFunction): void {
    const requestId = req.headers['x-request-id']
    req.container = createScope(container, typeof requestId === 'string' ? requestId : undefined)
    next()
  }
}
