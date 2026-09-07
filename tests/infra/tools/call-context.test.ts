import { describe, expect, it } from 'vitest'
import { currentCallContext, nextPageOrdinal, runWithCallContext } from '../../../src/infra/tools/call-context.js'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('call-context', () => {
  it('fora de runWithCallContext, currentCallContext é undefined', () => {
    expect(currentCallContext()).toBeUndefined()
  })

  it('expõe trigger/webhookEventId/requestCorrelationId dentro do contexto', async () => {
    await runWithCallContext({ trigger: 'WEBHOOK', webhookEventId: 'evt-1', requestCorrelationId: 'corr-1' }, async () => {
      expect(currentCallContext()).toEqual({ trigger: 'WEBHOOK', webhookEventId: 'evt-1', requestCorrelationId: 'corr-1' })
    })
  })

  it('gera requestCorrelationId automaticamente quando ausente', async () => {
    await runWithCallContext({ trigger: 'BOOT_RECOVERY' }, async () => {
      const ctx = currentCallContext()
      expect(ctx?.requestCorrelationId).toBeDefined()
      expect(ctx?.requestCorrelationId.length).toBeGreaterThan(0)
    })
  })

  it('o contexto setado numa chamada não vaza para uma chamada concorrente não relacionada', async () => {
    const observed: (string | undefined)[] = []

    await Promise.all([
      runWithCallContext({ trigger: 'WEBHOOK', requestCorrelationId: 'a' }, async () => {
        await delay(10)
        observed.push(currentCallContext()?.requestCorrelationId)
      }),
      runWithCallContext({ trigger: 'MANUAL_HISTORY_LOAD', requestCorrelationId: 'b' }, async () => {
        observed.push(currentCallContext()?.requestCorrelationId)
      }),
    ])

    expect(observed.sort()).toEqual(['a', 'b'])
  })

  it('nextPageOrdinal incrementa por operação+recurso, reinicia em novo contexto', async () => {
    await runWithCallContext({ trigger: 'WEBHOOK' }, async () => {
      expect(nextPageOrdinal('FETCH_ACCOUNT_TRANSACTIONS', 'acc-1')).toBe(1)
      expect(nextPageOrdinal('FETCH_ACCOUNT_TRANSACTIONS', 'acc-1')).toBe(2)
      // Recurso diferente tem sua própria sequência.
      expect(nextPageOrdinal('FETCH_ACCOUNT_TRANSACTIONS', 'acc-2')).toBe(1)
    })

    await runWithCallContext({ trigger: 'WEBHOOK' }, async () => {
      // Novo contexto: reinicia, não herda o contador da execução anterior.
      expect(nextPageOrdinal('FETCH_ACCOUNT_TRANSACTIONS', 'acc-1')).toBe(1)
    })
  })

  it('nextPageOrdinal fora de qualquer contexto devolve undefined', () => {
    expect(nextPageOrdinal('FETCH_ACCOUNT_TRANSACTIONS', 'acc-1')).toBeUndefined()
  })
})
