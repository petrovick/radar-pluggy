import type { Response } from 'express'
import type { AppContainerInstance } from '../../infra/bootstrap/register.js'
import type { AuthenticatedRequest } from '../../infra/http/middleware/authenticate.middleware.js'
import type { ScopedRequest } from '../../infra/http/middleware/request-scope.middleware.js'
import { acquireLeaseWithHeartbeat } from '../../infra/worker/pluggy-item-ingestion.js'
import type { LeaseGuard } from '../../shared/lease-guard.js'
import { runWithCallContext } from '../../infra/tools/call-context.js'

// Carga manual por decisão explícita do titular (tasks.md 7.6, design.md D30): primeira carga e
// recuperação — de histórico e de posição, sob o MESMO lease de ingestão compartilhado (D16) que o
// webhook e a pré-carga do cadastro usam — nenhum dos três pode rodar ao mesmo tempo para o mesmo
// Item. Não chama `PATCH /items` — a sincronização na Pluggy é dela (fronteira-pluggy, regra 7); aqui
// só se lê o que ela já coletou.
//
// Existe porque nenhum dos dois roda sozinho no registro de credencial nem por cron: a única
// sincronização automática é o webhook (`item/updated`, ciclo da Pluggy), que pode demorar ou nunca
// chegar se o provisionamento do webhook falhar. Esta rota é o caminho manual equivalente ao que o
// drenador de webhook já faz (`infra/worker/webhook-drainer.ts`), chamável quantas vezes quiser — o
// portão de marca d'água de cada caso de uso torna a repetição barata quando nada mudou.
//
// A resposta espera só o histórico. `LoadPluggyHistoryInteractor` checa dono (`assertItemAccess`)
// antes de qualquer I/O — é o que prova que `itemId` pertence a `personId`. A sincronização de
// posição dispara DEPOIS de responder, via `runPositionInBackground` — mesma forma de fábrica de
// `createPluggyWebhookHandler` (container raiz + callback injetado, nunca `req.container`: aquele
// escopo é da requisição que já terminou, e reaproveitá-lo estenderia a memoização `.scoped()` do
// container para uma unidade de trabalho que não é mais a mesma — arquitetura-camadas, 2.2.1).
//
// O `fencingToken` do lease é capturado por closure e compartilhado entre a chamada síncrona de
// History e a continuação de Position — o lease só é liberado depois que Position concluir (D30):
// liberar logo após History reabriria a janela de corrida que o lease existe pra fechar (um webhook
// para o mesmo item poderia começar a processar enquanto Position ainda está em voo).
//
// Só traduz HTTP: resolve o interactor do escopo daquela requisição e devolve `{errorType, extras}`
// no erro. `itemId` vem da URL; `personId` nunca vem do corpo — quem autoriza é o middleware de
// autenticação.
export function createLoadPluggyHistoryHandler(
  container: AppContainerInstance,
  runPositionInBackground: (
    container: AppContainerInstance,
    itemId: string,
    leaseGuard: LeaseGuard,
    onSettled: () => void,
  ) => void,
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
      const personId = req.personId
      const reqContainer = req.container

      const itemId = req.params.itemId
      if (typeof itemId !== 'string' || itemId.trim().length === 0) {
        res.status(400).json({ errorType: 'PLUGGY_HISTORY_ITEM_ID_MISSING' })
        return
      }

      // Adquire o lease ANTES de abrir o contexto de chamada: `tryAcquire`/`renew`/`release` são
      // escrita própria (nunca uma chamada à Pluggy, nunca gravada em `radar_pluggy_calls`), então
      // não precisam do contexto — e mantém a garantia de que um lease já adquirido é sempre liberado
      // mesmo que o resto do wiring da requisição esteja quebrado (não depende de `resolve('requestId')`
      // ter sucesso).
      const leaseRep = reqContainer.resolve('pluggyItemIngestionLeaseRep')
      const lease = await acquireLeaseWithHeartbeat(leaseRep, itemId, 'MANUAL_HISTORY_LOAD', () => reqContainer.resolve('logger'))
      if (lease === undefined) {
        res.status(400).json({ errorType: 'PLUGGY_ITEM_INGESTION_IN_PROGRESS' })
        return
      }

      let released = false
      const release = async (): Promise<void> => {
        if (released) {
          return
        }
        released = true
        lease.stopHeartbeat()
        await leaseRep.release(itemId, lease.fencingToken)
      }

      // `runWithCallContext` (design.md D2/D23/D30): um único contexto cobre a chamada síncrona de
      // History E a continuação assíncrona de Position — `AsyncLocalStorage` propaga pela cadeia de
      // causalidade, não pelo retorno da função, então o `runPositionInBackground` disparado (sem
      // `await`) aqui dentro ainda herda `trigger`/`requestCorrelationId` no seu próprio `.then()`.
      // Tudo daqui pra baixo — inclusive resolver `requestId` — fica dentro do `try` que garante
      // liberar o lease já adquirido mesmo se o resto do wiring da requisição estiver quebrado.
      try {
        const requestCorrelationId = reqContainer.resolve('requestId')
        await runWithCallContext({ trigger: 'MANUAL_HISTORY_LOAD', requestCorrelationId }, async () => {
          const loadPluggyHistoryInteractor = reqContainer.resolve('loadPluggyHistoryInteractor')
          const history = await loadPluggyHistoryInteractor.execute({
            origin: 'USER',
            personId,
            itemId,
            leaseGuard: lease.guard,
          })

          if (history.error) {
            await release()
            res.status(400).json({ errorType: history.error.errorType, extras: history.error.details })
            return
          }

          res.status(200).json({ data: history.data })

          // Resposta já enviada: History concluiu, mas o lease e o heartbeat continuam vivos até
          // Position (disparado a seguir) também concluir — `release` só roda no `onSettled` abaixo.
          try {
            runPositionInBackground(container, itemId, lease.guard, () => {
              void release()
            })
          } catch {
            // Falha em DISPARAR o background (nunca no resultado dele, que `onSettled` cobre) ainda
            // precisa liberar o lease — a resposta já foi enviada de qualquer forma.
            void release()
          }
        })
      } catch (err) {
        await release()
        throw err
      }
    } catch {
      // O interactor já traduz erro em `{error}`; cair aqui é falha do próprio wiring/resolução.
      res.status(500).json({ errorType: 'PLUGGY_HISTORY_LOAD_FAILED' })
    }
  }
}
