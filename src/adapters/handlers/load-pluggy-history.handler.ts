import type { Response } from 'express'
import type { AppContainerInstance } from '../../infra/bootstrap/register.js'
import type { AuthenticatedRequest } from '../../infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../infra/http/middleware/request-scope.middleware.js'

// Carga manual por decisão explícita do titular (tasks.md 6.3): primeira carga e recuperação — de
// histórico e de posição. Não chama `PATCH /items` — a sincronização na Pluggy é dela
// (fronteira-pluggy, regra 7); aqui só se lê o que ela já coletou.
//
// Existe porque nenhum dos dois roda sozinho no registro de credencial nem por cron: a única
// sincronização automática é o webhook (`item/updated`, ciclo da Pluggy), que pode demorar ou nunca
// chegar se o provisionamento do webhook falhar. Esta rota é o caminho manual equivalente ao que o
// drenador de webhook já faz (`infra/worker/webhook-drainer.ts`), chamável quantas vezes quiser — o
// portão de marca d'água de cada caso de uso torna a repetição barata quando nada mudou.
//
// A resposta espera só o histórico. `LoadPluggyHistoryInteractor` checa dono (`assertItemAccess`)
// antes de qualquer I/O — é o que prova que `itemId` pertence a `personId`. A sincronização de
// posição dispara DEPOIS de responder, via `syncPosition` — mesma forma de fábrica de
// `createPluggyWebhookHandler` (container raiz + callback injetado, nunca `req.container`: aquele
// escopo é da requisição que já terminou, e reaproveitá-lo estenderia a memoização `.scoped()` do
// container para uma unidade de trabalho que não é mais a mesma — arquitetura-camadas, 2.2.1).
// Dono já confirmado pelo passo anterior; falha no disparo em background é responsabilidade de
// `syncPosition`, nunca desta função.
//
// Só traduz HTTP: resolve o interactor do escopo daquela requisição e devolve `{errorType, extras}`
// no erro. `itemId` vem da URL; `personId` nunca vem do corpo — quem autoriza é o middleware de
// autenticação.
export function createLoadPluggyHistoryHandler(
  container: AppContainerInstance,
  syncPosition: (container: AppContainerInstance, itemId: string) => void,
) {
  return async function loadPluggyHistoryHandler(
    req: AuthenticatedRequest & ScopedRequest,
    res: Response,
  ): Promise<void> {
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

      const loadPluggyHistoryInteractor = req.container.resolve('loadPluggyHistoryInteractor')
      const history = await loadPluggyHistoryInteractor.execute({ origin: 'USER', personId: req.personId, itemId })

      if (history.error) {
        res.status(400).json({ errorType: history.error.errorType, extras: history.error.details })
        return
      }

      res.status(200).json({ data: history.data })

      // Resposta já enviada: `syncPosition` tem seu próprio try/catch interno e não deveria
      // lançar de forma síncrona, mas este `try` é a garantia de que, mesmo se o callback
      // injetado violar esse contrato, a falha nunca volta a chamar `res` (o `catch` externo
      // chamaria `res.status(500)` depois do 200 já enviado).
      try {
        syncPosition(container, itemId)
      } catch {
        // Nada mais a fazer — a resposta já foi enviada.
      }
    } catch {
      // O interactor já traduz erro em `{error}`; cair aqui é falha do próprio wiring/resolução.
      res.status(500).json({ errorType: 'PLUGGY_HISTORY_LOAD_FAILED' })
    }
  }
}
