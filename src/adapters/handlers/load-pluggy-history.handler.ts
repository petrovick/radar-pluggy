import type { Response } from 'express'
import type { AuthenticatedRequest } from '../../infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../infra/http/middleware/request-scope.middleware.js'

// Carga histórica por decisão explícita do titular (tasks.md 6.3): primeira carga e recuperação. Não
// chama `PATCH /items` — a sincronização na Pluggy é dela (fronteira-pluggy, regra 7); aqui só se lê
// o que ela já coletou.
//
// Só traduz HTTP: resolve o interactor do escopo daquela requisição e devolve `{errorType, extras}`
// no erro, o mesmo contrato que o `oplab-radar-front` já lê. `itemId` vem da URL; `personId` nunca
// vem do corpo — quem autoriza é o middleware de autenticação, e o dono do item sai da credencial
// vinculada, dentro do impl.
export async function loadPluggyHistoryHandler(req: AuthenticatedRequest & ScopedRequest, res: Response): Promise<void> {
  try {
    if (req.personId === undefined || req.container === undefined) {
      res.status(500).json({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
      return
    }

    const itemId = req.params.itemId
    if (typeof itemId !== 'string' || itemId.trim().length === 0) {
      res.status(400).json({ errorType: 'PLUGGY_HISTORY_ITEM_ID_MISSING' })
      return
    }

    const interactor = req.container.resolve('loadPluggyHistoryInteractor')
    const { data, error } = await interactor.execute({ origin: 'USER', personId: req.personId, itemId })

    if (error) {
      res.status(400).json({ errorType: error.errorType, extras: error.details })
      return
    }

    res.status(200).json({ data })
  } catch {
    // O interactor já traduz erro em `{error}`; cair aqui é falha do próprio wiring/resolução.
    res.status(500).json({ errorType: 'PLUGGY_HISTORY_LOAD_FAILED' })
  }
}
