import type { Response } from 'express'
import type { AuthenticatedRequest } from '../../infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../infra/http/middleware/request-scope.middleware.js'

// Operação autenticada e explícita (tasks.md 7.4): provisiona ou corrige o webhook das credenciais
// já cadastradas. Idempotente, e nunca roda por cron — quem decide rodar é o titular.
export async function reconcilePluggyWebhookHandler(
  req: AuthenticatedRequest & ScopedRequest,
  res: Response,
): Promise<void> {
  try {
    if (req.personId === undefined || req.container === undefined) {
      res.status(500).json({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
      return
    }

    const interactor = req.container.resolve('reconcilePluggyWebhookInteractor')
    const { data, error } = await interactor.execute({ personId: req.personId })

    if (error) {
      res.status(400).json({ errorType: error.errorType, extras: error.details })
      return
    }

    res.status(200).json({ data })
  } catch {
    res.status(500).json({ errorType: 'PLUGGY_WEBHOOK_RECONCILIATION_FAILED' })
  }
}
