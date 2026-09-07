import type { AppContainerInstance } from '../bootstrap/register.js'
import { createScope } from '../bootstrap/scope.js'
import type { Logger } from '../tools/log/logger.js'
import type { PluggyItemIngestionLeaseRep } from '../../adapters/repositories/pluggy-item-ingestion-lease.rep.js'
import type { LeaseGuard } from '../../shared/lease-guard.js'
import { currentCallContext, runWithCallContext } from '../tools/call-context.js'

// Prazo do lease e período de renovação (design.md D16) — curto o bastante pra um crash não deixar
// trabalho preso por muito tempo, longo o bastante pra uma carga histórica inteira caber dentro dele
// (o heartbeat renova bem antes de vencer, período = ttl / 3).
export const INGESTION_LEASE_TTL_MS = 10 * 60 * 1000
const HEARTBEAT_DIVISOR = 3

export interface AcquiredIngestionLease {
  fencingToken: number
  // Para o heartbeat — nunca libera o lease sozinho: liberar é decisão de quem detém o
  // `fencingToken`, chamada explicitamente depois (`PluggyItemIngestionLeaseRep.release`).
  stopHeartbeat: () => void
  // Reflete o heartbeat: `isLost() === true` assim que uma renovação devolve `false` (perda de
  // posse). Passado a `SyncPluggyPositionInteractor`/`LoadPluggyHistoryInteractor` para que nenhum
  // dos dois inicie página, chamada ou commit destrutivo novo depois da perda.
  guard: LeaseGuard
}

// Adquire o lease do Item e já inicia o heartbeat (renova a cada ttl/3, design.md D16) — usado tanto
// por `runPluggyItemIngestion` quanto pela rota manual (D30), que precisa manter o MESMO lease vivo
// entre a chamada síncrona de History e a continuação em background de Position.
//
// `resolveLogger` é uma função, nunca o `Logger` já resolvido: só é chamada DEPOIS que `tryAcquire`
// confirma a posse — resolver o logger antes disso (como argumento eager de quem chama) acoplaria a
// garantia "lease já adquirido é sempre liberado, mesmo com o resto do wiring quebrado" ao sucesso de
// um `resolve('logger')` que só serve para o log do heartbeat (mesma lição do `resolve('requestId')`
// em `load-pluggy-history.handler.ts`). E mesmo essa resolução tardia nunca pode derrubar um lease já
// adquirido: se `resolveLogger` falhar, cai num logger nulo — o heartbeat continua funcionando, só
// sem log, em vez de vazar um lease que nunca mais seria liberado.
export async function acquireLeaseWithHeartbeat(
  leaseRep: PluggyItemIngestionLeaseRep,
  itemId: string,
  trigger: string,
  resolveLogger: () => Logger,
): Promise<AcquiredIngestionLease | undefined> {
  const fencingToken = await leaseRep.tryAcquire(itemId, trigger, INGESTION_LEASE_TTL_MS)
  if (fencingToken === undefined) {
    return undefined
  }

  const heartbeat = startHeartbeat(leaseRep, itemId, fencingToken, safeResolveLogger(resolveLogger))
  return { fencingToken, stopHeartbeat: heartbeat.stop, guard: heartbeat.guard }
}

const NOOP_LOGGER: Logger = { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} }

function safeResolveLogger(resolveLogger: () => Logger): Logger {
  try {
    return resolveLogger()
  } catch {
    return NOOP_LOGGER
  }
}

export interface PluggyItemIngestionResult {
  // `false` só quando o lease já estava ocupado por outro trigger — nada foi tentado.
  attempted: boolean
  positionOk: boolean
  historyOk: boolean
}

// Substitui a orquestração ad hoc do PR #12 (`load-pluggy-item-in-background.ts`): unidade de
// ingestão de um Item — Position e History rodam de forma INDEPENDENTE (design.md D15), nenhum é
// condicionado ao resultado do outro, sob um lease exclusivo do Item (D16) que se renova sozinho
// enquanto o trabalho durar.
//
// `preAcquiredFencingToken` existe para `webhook-drainer.ts` (tasks.md 7.4): o drenador precisa
// adquirir o lease ELE MESMO, antes de marcar o evento `PROCESSING` (pra decidir se deixa o evento
// `PENDING` e segue pro próximo candidato) — chamar esta função de novo tentaria adquirir o lease uma
// segunda vez e falharia, porque o próprio drenador já o detém. Passando o token já obtido, esta
// função pula a aquisição (e o heartbeat próprio, que o chamador já iniciou) e assume só a execução
// independente + liberação.
export function runPluggyItemIngestion(
  container: AppContainerInstance,
  itemId: string,
  trigger: string,
  preAcquiredFencingToken?: number,
): Promise<PluggyItemIngestionResult> {
  // `runWithCallContext` (design.md D2/D23, tasks.md 8.8): reaproveita o contexto do chamador quando
  // já existir (`webhook-drainer.ts` já abre um, com `webhookEventId` da linha, em volta de TODA a
  // categoria — inclusive `FULL_INGESTION` — nunca sobreposto aqui). Sem contexto ativo (pré-carga do
  // cadastro, `CREDENTIAL_REGISTRATION_PRELOAD`), abre um novo só com o `trigger` recebido — nunca um
  // valor fixo internamente.
  return currentCallContext() !== undefined
    ? executeIngestion(container, itemId, trigger, preAcquiredFencingToken)
    : runWithCallContext({ trigger }, () => executeIngestion(container, itemId, trigger, preAcquiredFencingToken))
}

async function executeIngestion(
  container: AppContainerInstance,
  itemId: string,
  trigger: string,
  preAcquiredFencingToken: number | undefined,
): Promise<PluggyItemIngestionResult> {
  const scope = createScope(container)
  const leaseRep: PluggyItemIngestionLeaseRep = scope.resolve('pluggyItemIngestionLeaseRep')
  const logger: Logger = scope.resolve('logger')
  logger.addContext({ messageType: 'PLUGGY_ITEM_INGESTION', itemId, trigger })

  const lease =
    preAcquiredFencingToken !== undefined
      ? (() => {
          const heartbeat = startHeartbeat(leaseRep, itemId, preAcquiredFencingToken, logger)
          return { fencingToken: preAcquiredFencingToken, stopHeartbeat: heartbeat.stop, guard: heartbeat.guard }
        })()
      : await acquireLeaseWithHeartbeat(leaseRep, itemId, trigger, () => logger)

  if (lease === undefined) {
    logger.info('Lease de ingestão ocupado por outro trigger, ingestão não iniciada')
    return { attempted: false, positionOk: false, historyOk: false }
  }

  try {
    const positionOk = await runIndependently(
      () => scope.resolve('syncPluggyPositionInteractor').execute({ itemId, leaseGuard: lease.guard }),
      logger,
      'Sincronização de posição',
    )
    const historyOk = await runIndependently(
      () => scope.resolve('loadPluggyHistoryInteractor').execute({ origin: 'INTERNAL_DRAINER', itemId, leaseGuard: lease.guard }),
      logger,
      'Carga de histórico',
    )

    return { attempted: true, positionOk, historyOk }
  } finally {
    // Libera SEMPRE — sucesso, falha ou exceção não tratada (design.md D16/pluggy-ingestion-coordination).
    lease.stopHeartbeat()
    await leaseRep.release(itemId, lease.fencingToken)
  }
}

// Invariante exigido para esta implementação: `renew() === false` (posse perdida — outro trigger
// reivindicou o lease vencido) marca `lost`, nunca reencaminhado como exceção — o heartbeat não deve
// derrubar quem o iniciou, só sinalizar. Uma renovação que REJEITA (erro de rede/banco) também marca
// `lost` (revisão do PR #14): sem saber se o lease ainda é nosso, tratar como perdido é o lado seguro
// do erro — nunca um `unhandled rejection` silencioso. Uma vez perdido, permanece perdido: mesmo que
// uma renovação seguinte tenha sucesso ou falhe por outro motivo, não há como voltar a possuir o
// `fencingToken` antigo com confiança.
function startHeartbeat(
  leaseRep: PluggyItemIngestionLeaseRep,
  itemId: string,
  fencingToken: number,
  logger: Logger,
): { stop: () => void; guard: LeaseGuard } {
  let lost = false
  const heartbeat = setInterval(() => {
    leaseRep
      .renew(itemId, fencingToken, INGESTION_LEASE_TTL_MS)
      .then((renewed) => {
        if (!renewed) {
          lost = true
          logger.warn('Renovação de lease de ingestão recusada — outro trigger já assumiu, posse perdida', {
            itemId,
            fencingToken,
          })
        }
      })
      .catch((err: unknown) => {
        lost = true
        logger.warn('Renovação de lease de ingestão falhou — posse tratada como perdida por segurança', {
          itemId,
          fencingToken,
          err,
        })
      })
  }, Math.floor(INGESTION_LEASE_TTL_MS / HEARTBEAT_DIVISOR))
  return { stop: () => clearInterval(heartbeat), guard: { isLost: () => lost } }
}

// Nunca lança: uma exceção inesperada de um lado não pode impedir o outro lado de ser tentado
// (design.md D15) — captura tanto a recusa nomeada (`{error}`) quanto uma exceção que escapasse do
// próprio interactor.
async function runIndependently(
  execute: () => Promise<{ error?: unknown }>,
  logger: Logger,
  label: string,
): Promise<boolean> {
  try {
    const result = await execute()
    if (result.error) {
      logger.error(`${label} falhou`, { error: result.error })
      return false
    }
    return true
  } catch (err) {
    logger.error(`${label} lançou uma exceção inesperada`, { err })
    return false
  }
}
