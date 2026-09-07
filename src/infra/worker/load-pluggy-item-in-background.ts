import type { AppContainerInstance } from '../bootstrap/register.js'
import { createScope } from '../bootstrap/scope.js'

// Dispara sincronização de posição e, só quando ela tiver sucesso, a carga de histórico — mesma
// ordem de `webhook-drainer.ts` (posição antes de histórico: a posição é a fotografia que o portão de
// marca d'água do item já governa) — numa unidade de trabalho própria, sem bloquear quem chamou.
//
// Gatilho: o cadastro de credencial não pode mais depender só do webhook para o primeiro carregamento
// — o item já existe na Pluggy quando a credencial é salva, mas `item/created`/`item/updated` pode
// demorar minutos para chegar, ou nem chegar a tempo se o webhook ainda não estava provisionado no
// instante em que a Pluggy tentou notificar. Isto é só o pré-carregamento; o webhook continua sendo o
// gatilho de recorrência (D7).
//
// Falha aqui nunca sobe ao titular — a resposta do cadastro já foi enviada, e o caminho de correção
// (o próprio webhook, quando chegar, e `POST /webhooks/pluggy/reconcile`) já existe. `onError` só loga.
export function loadPluggyItemInBackground(
  rootContainer: AppContainerInstance,
  personId: number,
  itemId: string,
  onError: (error: unknown) => void,
): void {
  try {
    const scope = createScope(rootContainer)
    void scope
      .resolve('syncPluggyPositionInteractor')
      .execute({ itemId })
      .then((position) => {
        if (position.error) {
          onError(position.error)
          return undefined
        }
        return scope.resolve('loadPluggyHistoryInteractor').execute({ origin: 'USER', personId, itemId })
      })
      .then((history) => {
        if (history?.error) {
          onError(history.error)
        }
      })
      .catch(onError)
  } catch (err) {
    onError(err)
  }
}
