import { ApplicationError } from '../../shared/application-error.js'
import type { AppContainerInstance } from '../bootstrap/register.js'
import { createScope } from '../bootstrap/scope.js'

// Teto de eventos por drenagem: impede que uma fila grande prenda o processo indefinidamente numa
// única passada. O que sobrar fica `PENDING` e sai na drenagem seguinte (após a próxima notificação,
// no boot, ou pela rota manual) — nunca há cron (fronteira-pluggy, regra 7).
const MAX_EVENTS_PER_DRAIN = 50

// O worker: reivindica um evento por vez e, quando ele é aplicável, chama a sincronização de posição e
// a carga de histórico daquele item. É `tasks.md` 7.3 ao pé da letra — "o worker ... relê o item e
// chama posição/histórico" —, e é aqui, não num caso de uso, porque orquestrar outros casos de uso
// não caberia no construtor de um interactor sem quebrar a regra 2.1 de `arquitetura-camadas`
// (achado do arquiteto-pluggy-connector, que recusou a versão anterior com três colaboradores).
//
// Cada evento roda no seu próprio escopo de container — logo, na sua própria transação e com seu
// próprio contexto de log. O `leaseToken` devolvido pelo claim acompanha o evento até a conclusão:
// worker que perdeu o lease não sobrescreve o estado de quem o reivindicou depois.
export async function drainPluggyWebhookEvents(container: AppContainerInstance): Promise<number> {
  let processed = 0

  for (let i = 0; i < MAX_EVENTS_PER_DRAIN; i++) {
    const scope = createScope(container)
    const events = scope.resolve('pluggyWebhookEventRep')
    const logger = scope.resolve('logger')

    // Lease vencido volta a `PENDING` antes de qualquer claim: é o que recupera evento cujo worker
    // morreu depois de reivindicar (tasks.md 7.2).
    await events.reclaimExpiredLeases()

    const claim = await events.claimNextPending()
    if (!claim) {
      break
    }

    const { event, leaseToken } = claim
    const itemId = event.getItemId()
    logger.addContext({ messageType: 'DRAIN_PLUGGY_WEBHOOK_EVENT', itemId, event: event.getEvent() })

    // Evento que não dispara carga (`item/error`, `connector/status_updated`, ...) é reconhecido e
    // concluído sem trabalho: não é erro, é evento que não nos diz respeito. Quem decide isso é a
    // entidade (`isApplicable`), não este laço. Deixá-lo na fila faria a drenagem girar nele.
    if (!event.isApplicable()) {
      await events.markSucceeded(event.requireId(), leaseToken)
      logger.info('Evento não aplicável, concluído sem carga')
      processed++
      continue
    }

    try {
      // O payload nunca é dado: quem relê o item na Pluggy são os dois casos de uso chamados aqui
      // (fronteira-pluggy, regra 8).
      const position = await scope.resolve('syncPluggyPositionInteractor').execute({ itemId })
      if (position.error) {
        throw position.error
      }

      // Posição antes de histórico porque a posição é a fotografia que o portão de marca d'água do
      // item já governa; o histórico depende do mesmo item relido e é a parte longa.
      const history = await scope.resolve('loadPluggyHistoryInteractor').execute({ origin: 'INTERNAL_DRAINER', itemId })
      if (history.error) {
        throw history.error
      }

      await events.markSucceeded(event.requireId(), leaseToken)
      logger.info('Evento processado')
      processed++
    } catch (error) {
      // Falha devolve o evento à fila com o erro resumido — a próxima drenagem tenta de novo. Sem
      // retry aqui (padroes-de-engenharia, regra 3), e para a passada em vez de insistir no mesmo
      // evento que acabou de falhar.
      const errorType = error instanceof ApplicationError ? error.errorType : 'PLUGGY_WEBHOOK_PROCESSING_FAILED'
      await events.releaseToPending(event.requireId(), errorType, leaseToken)
      logger.error('Evento devolvido à fila após falha', { errorType })
      break
    }
  }

  return processed
}

// Dispara a drenagem sem prender quem chamou. Usado depois de responder 2xx à Pluggy: a resposta não
// pode esperar a carga histórica inteira (limite de 5 segundos), e o trabalho já está persistido.
export function drainInBackground(container: AppContainerInstance, onError: (error: unknown) => void): void {
  void drainPluggyWebhookEvents(container).catch(onError)
}
