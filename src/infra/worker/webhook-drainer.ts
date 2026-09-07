import { ApplicationError } from '../../shared/application-error.js'
import type { AppContainerInstance } from '../bootstrap/register.js'
import { createScope } from '../bootstrap/scope.js'
import { INGESTION_LEASE_TTL_MS, runPluggyItemIngestion } from './pluggy-item-ingestion.js'
import { runWithCallContext } from '../tools/call-context.js'
import type { PluggyWebhookEvent } from '../../entities/pluggy-webhook-event.js'
import type { PluggyWebhookEventRep } from '../../adapters/repositories/pluggy-webhook-event.rep.js'
import type { Logger } from '../tools/log/logger.js'

// Teto de eventos por drenagem: impede que uma fila grande prenda o processo indefinidamente numa
// única passada. O que sobrar fica `PENDING` e sai na drenagem seguinte (após a próxima notificação,
// no boot, ou pela rota manual) — nunca há cron (fronteira-pluggy, regra 7).
const MAX_EVENTS_PER_DRAIN = 50

// O worker: reivindica um evento por vez e o trata conforme sua categoria (design.md D28):
// `FULL_INGESTION` adquire o lease compartilhado de item (D16) e roda Position+History de forma
// independente (D15, `pluggy-item-ingestion.ts`); `OBSERVATION_REFRESH` só releem o estado observado
// via `PluggyItemStateResolver` — sem lease, sem sincronizar; `TERMINAL` marca o vínculo inativo sem
// tentar reler; `IGNORED` conclui sem trabalho.
//
// `trigger` é SEMPRE recebido por parâmetro, nunca fixado aqui dentro (design.md D23, correção desta
// rodada): o chamador HTTP passa `'WEBHOOK'`, o boot passa `'BOOT_RECOVERY'` — fixar um valor aqui
// faria toda recuperação do boot aparecer classificada como `WEBHOOK` em `radar_pluggy_calls`.
//
// Cada evento roda no seu próprio escopo de container — logo, na sua própria transação e com seu
// próprio contexto de log. O `leaseToken` devolvido pelo claim acompanha o evento até a conclusão:
// worker que perdeu o lease não sobrescreve o estado de quem o reivindicou depois.
export async function drainPluggyWebhookEvents(container: AppContainerInstance, trigger: string): Promise<number> {
  let processed = 0
  // Itens que esta MESMA passada já determinou ocupados pelo lease compartilhado — sem isso, devolver
  // um evento a PENDING por lease ocupado faria a iteração seguinte reivindicar o MESMO evento de
  // novo, girando no item preso em vez de seguir para um candidato de item diferente (tasks.md 7.4).
  const itemsBusyThisPass: string[] = []

  for (let i = 0; i < MAX_EVENTS_PER_DRAIN; i++) {
    const scope = createScope(container)
    const events = scope.resolve('pluggyWebhookEventRep')
    const logger = scope.resolve('logger')

    // Lease de EVENTO vencido volta a PENDING antes de qualquer claim: recupera evento cujo worker
    // morreu depois de reivindicar (tasks.md 7.2) — mecanismo distinto do lease de ITEM (D16).
    await events.reclaimExpiredLeases()

    const claim = await events.claimNextPending(new Date(), itemsBusyThisPass)
    if (!claim) {
      break
    }

    const { event, leaseToken } = claim
    const itemId = event.getItemId()
    logger.addContext({ messageType: 'DRAIN_PLUGGY_WEBHOOK_EVENT', itemId, event: event.getEvent(), trigger })

    // `runWithCallContext` (design.md D2/D31, tasks.md 8.8): `trigger` recebido do chamador
    // (`WEBHOOK` na rota HTTP, `BOOT_RECOVERY` no boot — nunca fixo aqui) e `webhookEventId` deste
    // evento atravessam até o `PluggyCallRecorder`, mesmo através do `PluggyConnectorClient`
    // singleton que vive fora do escopo Awilix deste evento.
    const outcome = await runWithCallContext({ trigger, webhookEventId: String(event.requireId()) }, () =>
      processClaimedEvent(container, scope, events, logger, event, leaseToken, trigger, itemsBusyThisPass),
    )

    if (outcome === 'stop') {
      break
    }
    if (outcome === 'processed') {
      processed++
    }
  }

  return processed
}

type ClaimOutcome = 'processed' | 'busy' | 'stop'

// Trabalho de UM evento já reivindicado — extraído para rodar inteiro dentro de `runWithCallContext`
// (o laço em si, com seu `continue`/`break`, fica em `drainPluggyWebhookEvents`).
async function processClaimedEvent(
  container: AppContainerInstance,
  scope: AppContainerInstance,
  events: PluggyWebhookEventRep,
  logger: Logger,
  event: PluggyWebhookEvent,
  leaseToken: Date,
  trigger: string,
  itemsBusyThisPass: string[],
): Promise<ClaimOutcome> {
  const itemId = event.getItemId()
  const category = event.categorize()

  if (category === 'IGNORED') {
    await events.markSucceeded(event.requireId(), leaseToken)
    logger.info('Evento ignorado (decisão deliberada), concluído sem trabalho')
    return 'processed'
  }

  if (category === 'TERMINAL') {
    try {
      // NUNCA chama fetchItem: o recurso já não existe na Pluggy (design.md D28).
      await scope.resolve('pluggyCredentialItemRep').markInactive(itemId, new Date())
      await events.markSucceeded(event.requireId(), leaseToken)
      logger.info('Item terminal, vínculo marcado inativo sem tentar reler')
      return 'processed'
    } catch (error) {
      await handleFailure(events, event.requireId(), leaseToken, error, logger, 'Falha ao marcar item terminal')
      return 'stop'
    }
  }

  if (category === 'OBSERVATION_REFRESH') {
    try {
      await scope.resolve('pluggyItemStateResolver').read(itemId)
      await events.markSucceeded(event.requireId(), leaseToken)
      logger.info('Estado observado atualizado (sem lease, sem sincronizar)')
      return 'processed'
    } catch (error) {
      await handleFailure(events, event.requireId(), leaseToken, error, logger, 'Falha ao atualizar estado observado')
      return 'stop'
    }
  }

  // FULL_INGESTION: adquire o lease compartilhado ANTES de qualquer trabalho — substitui o
  // subquery `busyItemIds` interno de `claimNextPending` como única fonte de exclusão mútua entre
  // qualquer trigger (design.md D16).
  const leaseRep = scope.resolve('pluggyItemIngestionLeaseRep')
  const fencingToken = await leaseRep.tryAcquire(itemId, trigger, INGESTION_LEASE_TTL_MS)
  if (fencingToken === undefined) {
    itemsBusyThisPass.push(itemId)
    await events.releaseToPending(event.requireId(), 'PLUGGY_ITEM_INGESTION_IN_PROGRESS', leaseToken)
    logger.info('Item já em ingestão por outro trigger, evento permanece pendente')
    return 'busy'
  }

  try {
    const result = await runPluggyItemIngestion(container, itemId, trigger, fencingToken)
    if (result.positionOk && result.historyOk) {
      await events.markSucceeded(event.requireId(), leaseToken)
      logger.info('Evento processado')
      return 'processed'
    }
    await events.releaseToPending(event.requireId(), 'PLUGGY_ITEM_INGESTION_PARTIAL_FAILURE', leaseToken)
    logger.error('Ingestão terminou com falha parcial, evento devolvido à fila', {
      positionOk: result.positionOk,
      historyOk: result.historyOk,
    })
    return 'stop'
  } catch (error) {
    await handleFailure(events, event.requireId(), leaseToken, error, logger, 'Ingestão lançou exceção inesperada')
    return 'stop'
  }
}

interface WebhookEventRepLike {
  releaseToPending(id: number, errorSummary: string, leaseToken: Date): Promise<boolean>
}

// Falha devolve o evento à fila com o erro resumido — a próxima drenagem tenta de novo. Sem retry
// aqui (padroes-de-engenharia, regra 3); para a passada em vez de insistir no mesmo evento que acabou
// de falhar.
async function handleFailure(
  events: WebhookEventRepLike,
  eventId: number,
  leaseToken: Date,
  error: unknown,
  logger: { error(message: string, extra?: unknown): void },
  message: string,
): Promise<void> {
  const errorType = error instanceof ApplicationError ? error.errorType : 'PLUGGY_WEBHOOK_PROCESSING_FAILED'
  await events.releaseToPending(eventId, errorType, leaseToken)
  logger.error(message, { errorType })
}

// Dispara a drenagem sem prender quem chamou. Usado depois de responder 2xx à Pluggy: a resposta não
// pode esperar a carga histórica inteira (limite de 5 segundos), e o trabalho já está persistido.
export function drainInBackground(container: AppContainerInstance, trigger: string, onError: (error: unknown) => void): void {
  void drainPluggyWebhookEvents(container, trigger).catch(onError)
}
