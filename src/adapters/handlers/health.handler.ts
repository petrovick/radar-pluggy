import type { Request, Response } from 'express'
import type { ScopedRequest } from '../../infra/http/middleware/request-scope.middleware.js'

// Único consumidor: `railway.json` → `healthcheckPath`. Sem JWT, de propósito — a plataforma não
// tem credencial de titular nenhuma para apresentar, e é ela quem decide se este deploy recebe
// tráfego (a nova versão só troca de lugar com a anterior depois de um 200 aqui).
export async function checkHealthHandler(req: Request & ScopedRequest, res: Response): Promise<void> {
  try {
    if (req.container === undefined) {
      res.status(500).json({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
      return
    }

    const { data, error } = await req.container.resolve('checkHealthInteractor').execute()

    if (error) {
      res.status(503).json({ errorType: error.errorType })
      return
    }

    res.status(200).json(data)
  } catch {
    res.status(503).json({ errorType: 'PLUGGY_CONNECTOR_DATABASE_UNAVAILABLE' })
  }
}
