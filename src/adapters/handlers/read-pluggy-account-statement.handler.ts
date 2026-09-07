import type { Response } from 'express'
import type { AuthenticatedRequest } from '../../infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../infra/http/middleware/request-scope.middleware.js'

// Único ponto de entrada externo do extrato de cartão por fatura
// (`GET /accounts/:accountId/transactions?billMonth=AAAA-MM`) — só traduz request/response HTTP, a
// leitura e a checagem de dono moram no interactor resolvido do escopo. `personId` nunca vem do
// corpo/query — vem de `req.personId`, resolvido pelo middleware de autenticação a partir do JWT.
export async function readPluggyAccountStatementHandler(
  req: AuthenticatedRequest & ScopedRequest,
  res: Response,
): Promise<void> {
  try {
    if (req.personId === undefined || req.container === undefined) {
      res.status(500).json({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
      return
    }

    const accountId = req.params.accountId
    if (typeof accountId !== 'string' || accountId.trim().length === 0) {
      res.status(400).json({ errorType: 'PLUGGY_ACCOUNT_STATEMENT_ACCOUNT_ID_MISSING' })
      return
    }

    const billMonth = req.query.billMonth
    if (typeof billMonth !== 'string' || billMonth.trim().length === 0) {
      res.status(400).json({ errorType: 'PLUGGY_ACCOUNT_STATEMENT_BILL_MONTH_MISSING' })
      return
    }

    const interactor = req.container.resolve('readPluggyAccountStatementInteractor')
    const { data, error } = await interactor.execute({ personId: req.personId, accountId, billMonth })

    if (error) {
      res.status(400).json({ errorType: error.errorType, extras: error.details })
      return
    }

    res.status(200).json(data)
  } catch {
    res.status(500).json({ errorType: 'PLUGGY_ACCOUNT_STATEMENT_READ_FAILED' })
  }
}
