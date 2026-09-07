import { describe, expect, it } from 'vitest'
import { drainPluggyWebhookEvents } from '../../../src/infra/worker/webhook-drainer.js'
import type { AppContainerInstance } from '../../../src/infra/bootstrap/register.js'
import { PluggyWebhookEvent } from '../../../src/entities/pluggy-webhook-event.js'
import { ApplicationError } from '../../../src/shared/application-error.js'
import { currentCallContext } from '../../../src/infra/tools/call-context.js'

const ITEM_ID = '00000000-0000-0000-0000-000000000001'
const LEASE = new Date('2026-09-03T10:10:00.000Z')

function event(id: number, tipo = 'item/updated', itemId = ITEM_ID) {
  return PluggyWebhookEvent.reconstitute({
    id,
    eventId: `evt-${id}`,
    itemId,
    event: tipo,
    state: 'PROCESSING',
    attempts: 1,
  })
}

type Calls = {
  ran: string[]
  succeeded: number[]
  released: { id: number; errorSummary: string }[]
  reclaims: number
  claimedExcluding: string[][]
  itemLeaseAcquired: { itemId: string; trigger: string }[]
  itemLeaseReleased: string[]
  markedInactive: string[]
  observationsRefreshed: string[]
  contextsSeen: { trigger: string | undefined; webhookEventId: string | undefined }[]
}

// A orquestração do webhook vive no worker (tasks.md 7.4) — então é aqui que ela é testada. O
// container é fake: cada iteração resolve o rep e os colaboradores do escopo, incluindo o lease de
// ingestão compartilhado que `runPluggyItemIngestion` também resolve por dentro.
function buildContainer(
  queue: (ReturnType<typeof event> | undefined)[],
  outcomes: {
    position?: unknown
    history?: unknown
    itemLeaseBusyFor?: Set<string>
  } = {},
) {
  const calls: Calls = {
    ran: [],
    succeeded: [],
    released: [],
    reclaims: 0,
    claimedExcluding: [],
    itemLeaseAcquired: [],
    itemLeaseReleased: [],
    markedInactive: [],
    observationsRefreshed: [],
    contextsSeen: [],
  }
  const recordContext = (): void => {
    const ctx = currentCallContext()
    calls.contextsSeen.push({ trigger: ctx?.trigger, webhookEventId: ctx?.webhookEventId })
  }
  let next = 0
  let fencingCounter = 0
  const busyFor = outcomes.itemLeaseBusyFor ?? new Set<string>()

  const itemLeaseRep = {
    tryAcquire: async (itemId: string, trigger: string) => {
      calls.itemLeaseAcquired.push({ itemId, trigger })
      if (busyFor.has(itemId)) return undefined
      fencingCounter++
      return fencingCounter
    },
    renew: async () => true,
    release: async (itemId: string) => {
      calls.itemLeaseReleased.push(itemId)
      return true
    },
  }

  const scope = {
    register: () => {},
    resolve: (key: string) => {
      if (key === 'logger') {
        return { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} }
      }
      if (key === 'pluggyWebhookEventRep') {
        return {
          reclaimExpiredLeases: async () => {
            calls.reclaims++
            return 0
          },
          claimNextPending: async (_now: Date, excludeItemIds: string[] = []) => {
            calls.claimedExcluding.push(excludeItemIds)
            const claimed = queue[next]
            next++
            return claimed ? { event: claimed, leaseToken: LEASE } : undefined
          },
          markSucceeded: async (id: number) => {
            calls.succeeded.push(id)
            return true
          },
          releaseToPending: async (id: number, errorSummary: string) => {
            calls.released.push({ id, errorSummary })
            return true
          },
        }
      }
      if (key === 'pluggyItemIngestionLeaseRep') {
        return itemLeaseRep
      }
      if (key === 'pluggyCredentialItemRep') {
        return {
          markInactive: async (itemId: string) => {
            recordContext()
            calls.markedInactive.push(itemId)
          },
        }
      }
      if (key === 'pluggyItemStateResolver') {
        return {
          read: async (itemId: string) => {
            recordContext()
            calls.observationsRefreshed.push(itemId)
            return {}
          },
        }
      }
      if (key === 'syncPluggyPositionInteractor') {
        return {
          execute: async () => {
            recordContext()
            calls.ran.push('position')
            return outcomes.position ?? { data: { synced: true, positionsSynced: 1 } }
          },
        }
      }
      return {
        execute: async () => {
          calls.ran.push('history')
          return outcomes.history ?? { data: { loaded: true, sourcesScanned: 1, transactionsObserved: 2, sourcesRefused: [] } }
        },
      }
    },
  }

  const container = { createScope: () => scope } as unknown as AppContainerInstance
  return { container, calls }
}

describe('drainPluggyWebhookEvents', () => {
  it('FULL_INGESTION: adquire o lease com o trigger recebido, roda posição e histórico, libera e marca sucesso', async () => {
    const { container, calls } = buildContainer([event(1), event(2), undefined])

    const processed = await drainPluggyWebhookEvents(container, 'WEBHOOK')

    expect(processed).toBe(2)
    expect(calls.ran).toEqual(['position', 'history', 'position', 'history'])
    expect(calls.succeeded).toEqual([1, 2])
    expect(calls.itemLeaseAcquired.every((a) => a.trigger === 'WEBHOOK')).toBe(true)
    expect(calls.itemLeaseReleased).toEqual([ITEM_ID, ITEM_ID])
  })

  it('trigger recebido nunca é fixado internamente: BOOT_RECOVERY aparece na aquisição do lease', async () => {
    const { container, calls } = buildContainer([event(1), undefined])

    await drainPluggyWebhookEvents(container, 'BOOT_RECOVERY')

    expect(calls.itemLeaseAcquired).toEqual([{ itemId: ITEM_ID, trigger: 'BOOT_RECOVERY' }])
  })

  it('tasks.md 8.8: runWithCallContext propaga trigger e webhookEventId até o trabalho de FULL_INGESTION', async () => {
    const { container, calls } = buildContainer([event(1), undefined])

    await drainPluggyWebhookEvents(container, 'WEBHOOK')

    expect(calls.contextsSeen).toEqual([{ trigger: 'WEBHOOK', webhookEventId: '1' }])
  })

  it('tasks.md 7.7/8.8: BOOT_RECOVERY chega ao contexto de chamada, distinto de WEBHOOK, na mesma função de drenagem', async () => {
    const { container, calls } = buildContainer([event(4, 'item/error'), undefined])

    await drainPluggyWebhookEvents(container, 'BOOT_RECOVERY')

    expect(calls.contextsSeen).toEqual([{ trigger: 'BOOT_RECOVERY', webhookEventId: '4' }])
  })

  it('TERMINAL também roda dentro do contexto de chamada, com o webhookEventId daquele evento', async () => {
    const { container, calls } = buildContainer([event(3, 'item/deleted'), undefined])

    await drainPluggyWebhookEvents(container, 'WEBHOOK')

    expect(calls.contextsSeen).toEqual([{ trigger: 'WEBHOOK', webhookEventId: '3' }])
  })

  it('devolve lease de EVENTO vencido à fila antes de cada claim', async () => {
    const { container, calls } = buildContainer([event(1), undefined])

    await drainPluggyWebhookEvents(container, 'WEBHOOK')

    expect(calls.reclaims).toBeGreaterThanOrEqual(1)
  })

  it('fila vazia não faz trabalho nenhum', async () => {
    const { container, calls } = buildContainer([undefined])

    const processed = await drainPluggyWebhookEvents(container, 'WEBHOOK')

    expect(processed).toBe(0)
    expect(calls.ran).toEqual([])
  })

  it('evento IGNORED é concluído sem carga, para não girar na fila', async () => {
    const { container, calls } = buildContainer([event(9, 'connector/status_updated'), undefined])

    const processed = await drainPluggyWebhookEvents(container, 'WEBHOOK')

    expect(processed).toBe(1)
    expect(calls.ran).toEqual([])
    expect(calls.succeeded).toEqual([9])
  })

  it('TERMINAL (item/deleted) marca o vínculo inativo sem tentar reler, nunca chama Position/History', async () => {
    const { container, calls } = buildContainer([event(3, 'item/deleted'), undefined])

    const processed = await drainPluggyWebhookEvents(container, 'WEBHOOK')

    expect(processed).toBe(1)
    expect(calls.markedInactive).toEqual([ITEM_ID])
    expect(calls.ran).toEqual([])
    expect(calls.succeeded).toEqual([3])
  })

  it('OBSERVATION_REFRESH (item/error) só releem o estado observado, sem lease nem Position/History', async () => {
    const { container, calls } = buildContainer([event(4, 'item/error'), undefined])

    const processed = await drainPluggyWebhookEvents(container, 'WEBHOOK')

    expect(processed).toBe(1)
    expect(calls.observationsRefreshed).toEqual([ITEM_ID])
    expect(calls.ran).toEqual([])
    expect(calls.itemLeaseAcquired).toEqual([])
  })

  it('lease de item ocupado: evento permanece pendente e a passada segue para candidato de item diferente', async () => {
    const outroItem = '00000000-0000-0000-0000-000000000002'
    const { container, calls } = buildContainer(
      [event(1, 'item/updated', ITEM_ID), event(2, 'item/updated', outroItem), undefined],
      { itemLeaseBusyFor: new Set([ITEM_ID]) },
    )

    const processed = await drainPluggyWebhookEvents(container, 'WEBHOOK')

    expect(calls.released).toEqual([{ id: 1, errorSummary: 'PLUGGY_ITEM_INGESTION_IN_PROGRESS' }])
    // O segundo claim exclui o item já sabido ocupado nesta passada.
    expect(calls.claimedExcluding[1]).toEqual([ITEM_ID])
    expect(processed).toBe(1)
    expect(calls.succeeded).toEqual([2])
  })

  it('falha na posição não impede o histórico (D15), mas marca falha parcial e para a passada', async () => {
    const { container, calls } = buildContainer([event(1), event(2)], {
      position: { error: new ApplicationError('PLUGGY_ITEMS_UPSTREAM_ERROR', { status: 500 }) },
    })

    const processed = await drainPluggyWebhookEvents(container, 'WEBHOOK')

    expect(processed).toBe(0)
    expect(calls.ran).toEqual(['position', 'history'])
    expect(calls.released).toEqual([{ id: 1, errorSummary: 'PLUGGY_ITEM_INGESTION_PARTIAL_FAILURE' }])
    expect(calls.itemLeaseReleased).toEqual([ITEM_ID])
    // Parou a passada em vez de insistir: o evento 2 não foi tocado.
    expect(calls.succeeded).toEqual([])
  })

  it('falha no histórico não impede a posição (D15), devolve à fila mesmo com a posição já sincronizada', async () => {
    const { container, calls } = buildContainer([event(1), undefined], {
      history: { error: new ApplicationError('PLUGGY_TRANSACTIONS_UPSTREAM_ERROR', { status: 502 }) },
    })

    await drainPluggyWebhookEvents(container, 'WEBHOOK')

    expect(calls.ran).toEqual(['position', 'history'])
    expect(calls.released).toEqual([{ id: 1, errorSummary: 'PLUGGY_ITEM_INGESTION_PARTIAL_FAILURE' }])
  })
})
