import { describe, expect, it } from 'vitest'
import { drainPluggyWebhookEvents } from '../../../src/infra/worker/webhook-drainer.js'
import type { AppContainerInstance } from '../../../src/infra/bootstrap/register.js'
import { PluggyWebhookEvent } from '../../../src/entities/pluggy-webhook-event.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

const ITEM_ID = '00000000-0000-0000-0000-000000000001'
const LEASE = new Date('2026-09-03T10:10:00.000Z')

function event(id: number, tipo = 'item/updated') {
  return PluggyWebhookEvent.reconstitute({
    id,
    eventId: `evt-${id}`,
    itemId: ITEM_ID,
    event: tipo,
    state: 'PROCESSING',
    attempts: 1,
  })
}

type Calls = { ran: string[]; succeeded: number[]; released: { id: number; errorSummary: string }[]; reclaims: number }

// A orquestração do webhook vive AQUI, no worker (tasks.md 7.3) — então é aqui que ela é testada.
// O container é fake: cada iteração resolve o rep e os dois casos de uso do escopo.
function buildContainer(
  queue: (ReturnType<typeof event> | undefined)[],
  outcomes: { position?: unknown; history?: unknown } = {},
) {
  const calls: Calls = { ran: [], succeeded: [], released: [], reclaims: 0 }
  let next = 0

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
          claimNextPending: async () => {
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
      if (key === 'syncPluggyPositionInteractor') {
        return {
          execute: async () => {
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
  it('processa cada evento aplicável rodando posição e depois histórico', async () => {
    const { container, calls } = buildContainer([event(1), event(2), undefined])

    const processed = await drainPluggyWebhookEvents(container)

    expect(processed).toBe(2)
    expect(calls.ran).toEqual(['position', 'history', 'position', 'history'])
    expect(calls.succeeded).toEqual([1, 2])
  })

  it('devolve lease vencido à fila antes de cada claim', async () => {
    const { container, calls } = buildContainer([event(1), undefined])

    await drainPluggyWebhookEvents(container)

    expect(calls.reclaims).toBeGreaterThanOrEqual(1)
  })

  it('fila vazia não faz trabalho nenhum', async () => {
    const { container, calls } = buildContainer([undefined])

    const processed = await drainPluggyWebhookEvents(container)

    expect(processed).toBe(0)
    expect(calls.ran).toEqual([])
  })

  it('evento não aplicável é concluído sem carga, para não girar na fila', async () => {
    const { container, calls } = buildContainer([event(9, 'item/error'), undefined])

    const processed = await drainPluggyWebhookEvents(container)

    expect(processed).toBe(1)
    expect(calls.ran).toEqual([])
    expect(calls.succeeded).toEqual([9])
  })

  it('falha na posição devolve o evento à fila, não tenta o histórico e para a passada', async () => {
    const { container, calls } = buildContainer([event(1), event(2)], {
      position: { error: new ApplicationError('PLUGGY_ITEMS_UPSTREAM_ERROR', { status: 500 }) },
    })

    const processed = await drainPluggyWebhookEvents(container)

    expect(processed).toBe(0)
    expect(calls.ran).toEqual(['position'])
    expect(calls.released).toEqual([{ id: 1, errorSummary: 'PLUGGY_ITEMS_UPSTREAM_ERROR' }])
    // Parou a passada em vez de insistir: o evento 2 não foi tocado.
    expect(calls.succeeded).toEqual([])
  })

  it('falha no histórico devolve à fila mesmo com a posição já sincronizada', async () => {
    const { container, calls } = buildContainer([event(1), undefined], {
      history: { error: new ApplicationError('PLUGGY_TRANSACTIONS_UPSTREAM_ERROR', { status: 502 }) },
    })

    await drainPluggyWebhookEvents(container)

    expect(calls.ran).toEqual(['position', 'history'])
    expect(calls.released).toEqual([{ id: 1, errorSummary: 'PLUGGY_TRANSACTIONS_UPSTREAM_ERROR' }])
  })

  it('erro inesperado devolve à fila com resumo genérico', async () => {
    const { container, calls } = buildContainer([event(1), undefined], {
      position: Promise.reject(new Error('socket hang up')),
    })

    await drainPluggyWebhookEvents(container)

    expect(calls.released).toEqual([{ id: 1, errorSummary: 'PLUGGY_WEBHOOK_PROCESSING_FAILED' }])
  })
})
