import type { Response } from 'express'
import type { AuthenticatedRequest } from '../../infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../infra/http/middleware/request-scope.middleware.js'

// Único ponto de entrada externo do portfolio consolidado (`GET /portfolio`) — só traduz
// request/response HTTP, a leitura mora no interactor resolvido do escopo. `personId` nunca vem do
// corpo/query — vem de `req.personId`, resolvido pelo middleware de autenticação a partir do JWT.
export async function readPluggyPositionHandler(
  req: AuthenticatedRequest & ScopedRequest,
  res: Response,
): Promise<void> {
  try {
    if (req.personId === undefined || req.container === undefined) {
      res.status(500).json({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
      return
    }

    const interactor = req.container.resolve('readPluggyPositionInteractor')
    const { data, error } = await interactor.execute({ personId: req.personId })

    if (error) {
      res.status(400).json({ errorType: error.errorType, extras: error.details })
      return
    }

    // Corpo é o array em si, não `{data}`: `PluggyPortfolioApi.getPortfolio()` (oplab-radar-front)
    // devolve `Promise<PluggyPosition[]>` direto, sem envelope pra desembrulhar.
    res.status(200).json(data)
  } catch {
    res.status(500).json({ errorType: 'PLUGGY_POSITION_READ_FAILED' })
  }
}
