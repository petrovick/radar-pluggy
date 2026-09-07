import { describe, expect, it } from 'vitest'
import { instrumentPluggyClient } from '../../../src/adapters/gateways/pluggy-call-instrumentation.js'
import { runWithCallContext } from '../../../src/infra/tools/call-context.js'
import type { PluggyCallEvent, PluggyCallRecorder } from '../../../src/adapters/gateways/pluggy-call-recorder.js'

type FakeClient = Record<string, (...args: unknown[]) => Promise<unknown>>

function fakeRecorder(): { recorder: PluggyCallRecorder; events: PluggyCallEvent[] } {
  const events: PluggyCallEvent[] = []
  return { recorder: { record: (event: PluggyCallEvent) => events.push(event) } as unknown as PluggyCallRecorder, events }
}

describe('instrumentPluggyClient (D3)', () => {
  it('chamada bem-sucedida gera exatamente uma linha, com item/connector do alvo e resourceId do argumento real', async () => {
    const { recorder, events } = fakeRecorder()
    const client: FakeClient = { fetchItem: async (id) => ({ id }) }
    const instrumented = instrumentPluggyClient(client, { itemId: 'item-1', connectorId: 201 }, recorder)

    await runWithCallContext({ trigger: 'WEBHOOK', requestCorrelationId: 'corr-1' }, () => instrumented.fetchItem!('item-1'))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      operation: 'FETCH_ITEM',
      callScope: 'SNAPSHOT_READ',
      outcome: 'SUCCEEDED',
      itemId: 'item-1',
      connectorId: 201,
      resourceType: 'ITEM',
      resourceId: 'item-1',
      trigger: 'WEBHOOK',
      requestCorrelationId: 'corr-1',
    })
  })

  it('falha gera outcome FAILED com failureKind classificado (reaproveita classifyPluggyCallFailure)', async () => {
    const { recorder, events } = fakeRecorder()
    const notFound = { response: { statusCode: 404 } }
    const client: FakeClient = {
      fetchItem: async () => {
        throw notFound
      },
    }
    const instrumented = instrumentPluggyClient(client, { itemId: 'item-1', connectorId: undefined }, recorder)

    await expect(runWithCallContext({ trigger: 'WEBHOOK' }, () => instrumented.fetchItem!('item-1'))).rejects.toBe(notFound)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ outcome: 'FAILED', failureKind: 'CLIENT_ERROR', httpStatus: 404 })
  })

  it('o método real é chamado exatamente uma vez — nunca duplicado pela instrumentação', async () => {
    let calls = 0
    const client: FakeClient = {
      fetchItem: async () => {
        calls++
        return {}
      },
    }
    const instrumented = instrumentPluggyClient(client, { itemId: 'item-1', connectorId: undefined }, recorderThatIgnores())

    await runWithCallContext({ trigger: 'WEBHOOK' }, () => instrumented.fetchItem!('item-1'))

    expect(calls).toBe(1)
  })

  it('método sem entrada na tabela passa direto, sem gerar nenhum registro', async () => {
    const { recorder, events } = fakeRecorder()
    const client: FakeClient = { someUninstrumentedMethod: async () => 'ok' }
    const instrumented = instrumentPluggyClient(client, { itemId: undefined, connectorId: undefined }, recorder)

    await expect(instrumented.someUninstrumentedMethod!()).resolves.toBe('ok')
    expect(events).toEqual([])
  })

  it('page_ordinal incrementa corretamente numa varredura cursor-based, particionado por recurso', async () => {
    const { recorder, events } = fakeRecorder()
    const client: FakeClient = { fetchTransactionsCursor: async (accountId) => ({ accountId }) }
    const instrumented = instrumentPluggyClient(client, { itemId: 'item-1', connectorId: undefined }, recorder)

    await runWithCallContext({ trigger: 'WEBHOOK' }, async () => {
      await instrumented.fetchTransactionsCursor!('acc-1', {})
      await instrumented.fetchTransactionsCursor!('acc-1', {})
      await instrumented.fetchTransactionsCursor!('acc-2', {})
    })

    expect(events.map((e) => e.pageOrdinal)).toEqual([1, 2, 1])
  })

  it('nunca persiste campo fora do schema de PluggyCallEvent — corpo de resposta nunca vaza pro registro', async () => {
    const { recorder, events } = fakeRecorder()
    const client: FakeClient = { fetchItem: async () => ({ secret: 'nao-deveria-aparecer', balance: 999 }) }
    const instrumented = instrumentPluggyClient(client, { itemId: 'item-1', connectorId: undefined }, recorder)

    await runWithCallContext({ trigger: 'WEBHOOK' }, () => instrumented.fetchItem!('item-1'))

    const keys = Object.keys(events[0] ?? {})
    expect(keys).not.toContain('secret')
    expect(keys).not.toContain('balance')
    expect(keys).not.toContain('body')
    expect(keys).not.toContain('response')
  })

  const cases: [string, unknown[], string, string][] = [
    ['fetchItem', ['item-1'], 'FETCH_ITEM', 'SNAPSHOT_READ'],
    ['fetchInvestments', ['item-1', undefined, { page: 1, pageSize: 30 }], 'FETCH_INVESTMENTS', 'SNAPSHOT_READ'],
    ['fetchLoans', ['item-1', { page: 1, pageSize: 30 }], 'FETCH_LOANS', 'SNAPSHOT_READ'],
    ['fetchConsents', ['item-1', { page: 1, pageSize: 30 }], 'FETCH_CONSENTS', 'SNAPSHOT_READ'],
    ['fetchAccountsPage', ['item-1', 1, 30], 'FETCH_ACCOUNTS', 'SNAPSHOT_READ'],
    ['fetchInvestmentTransactions', ['inv-1', { page: 1, pageSize: 30 }], 'FETCH_INVESTMENT_TRANSACTIONS', 'SNAPSHOT_READ'],
    ['fetchWebhook', ['wh-1'], 'FETCH_WEBHOOKS', 'PLATFORM_CONFIG'],
    ['createWebhook', ['all', 'https://x', {}], 'CREATE_WEBHOOK', 'PLATFORM_CONFIG'],
    ['updateWebhook', ['wh-1', {}], 'UPDATE_WEBHOOK', 'PLATFORM_CONFIG'],
  ]

  it.each(cases)('%s gera operation=%s, callScope=%s', async (method, args, operation, callScope) => {
    const { recorder, events } = fakeRecorder()
    const client: FakeClient = { [method]: async () => ({ ok: true }) }
    const instrumented = instrumentPluggyClient(client, { itemId: 'item-1', connectorId: undefined }, recorder)

    await runWithCallContext({ trigger: 'WEBHOOK' }, () => instrumented[method]?.(...args) ?? Promise.resolve())

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ operation, callScope })
  })
})

function recorderThatIgnores(): PluggyCallRecorder {
  return { record: () => {} } as unknown as PluggyCallRecorder
}
