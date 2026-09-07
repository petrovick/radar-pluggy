import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { PluggyWebhookEventRep } from '../../../src/adapters/repositories/pluggy-webhook-event.rep.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import { definePluggyWebhookEventModel } from '../../../src/infra/db/models/pluggy-webhook-event-model.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'

// Requer MySQL alcançável: a idempotência e o claim atômico da inbox são garantias de BANCO
// (constraint única e `UPDATE ... WHERE state`), não de código — testar com fake não provaria nada.
describe('PluggyWebhookEventRep', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyWebhookEventModel(sequelize)
  const repository = new PluggyWebhookEventRep({
    db: { models: { pluggyWebhookEvent: model } },
    getTransaction: () => null,
  } as unknown as AppContainer)
  const eventIdsToCleanup: string[] = []

  function enqueueInput(itemId: string, eventId = randomUUID(), event = 'item/updated') {
    eventIdsToCleanup.push(eventId)
    return { eventId, itemId, event }
  }

  afterEach(async () => {
    while (eventIdsToCleanup.length > 0) {
      const eventId = eventIdsToCleanup.pop()
      if (eventId !== undefined) {
        await model.destroy({ where: { event_id: eventId } })
      }
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('duas entregas do mesmo evento não criam duas linhas, e a segunda se identifica como já conhecida', async () => {
    const input = enqueueInput(randomUUID())

    const first = await repository.enqueue(input)
    const second = await repository.enqueue(input)

    expect(first.alreadyKnown).toBe(false)
    expect(second.alreadyKnown).toBe(true)
    expect(await model.count({ where: { event_id: input.eventId } })).toBe(1)
  })

  it('claim é atômico: dois workers competindo, só um leva o evento', async () => {
    const input = enqueueInput(randomUUID())
    await repository.enqueue(input)

    const [a, b] = await Promise.all([repository.claimNextPending(), repository.claimNextPending()])

    const claimed = [a, b].filter((claim) => claim?.event.getEventId() === input.eventId)
    expect(claimed).toHaveLength(1)
    expect(claimed[0]?.event.getState()).toBe('PROCESSING')
    expect(claimed[0]?.event.getAttempts()).toBe(1)
  })

  it('eventos do mesmo item são serializados: o segundo espera o primeiro terminar', async () => {
    const itemId = randomUUID()
    const primeiro = enqueueInput(itemId)
    const segundo = enqueueInput(itemId)
    await repository.enqueue(primeiro)
    await repository.enqueue(segundo)

    const claimed = await repository.claimNextPending()
    expect(claimed?.event.getEventId()).toBe(primeiro.eventId)

    // Item ocupado com lease vivo: nada mais daquele item é reivindicável agora.
    const durante = await repository.claimNextPending()
    expect(durante?.event.getItemId()).not.toBe(itemId)

    await repository.markSucceeded(claimed?.event.requireId() ?? 0, claimed?.leaseToken ?? new Date())

    const depois = await repository.claimNextPending()
    expect(depois?.event.getEventId()).toBe(segundo.eventId)
  })

  it('eventos de itens diferentes podem ser reivindicados em paralelo', async () => {
    const a = enqueueInput(randomUUID())
    const b = enqueueInput(randomUUID())
    await repository.enqueue(a)
    await repository.enqueue(b)

    const first = await repository.claimNextPending()
    const second = await repository.claimNextPending()

    expect([first?.event.getEventId(), second?.event.getEventId()]).toEqual(
      expect.arrayContaining([a.eventId, b.eventId]),
    )
  })

  it('crash depois do claim: lease vencido devolve o evento a PENDING', async () => {
    const input = enqueueInput(randomUUID())
    await repository.enqueue(input)
    const claimed = await repository.claimNextPending()
    expect(claimed?.event.getState()).toBe('PROCESSING')

    // Simula o worker morto: o tempo passou além do lease.
    const bemDepois = new Date(Date.now() + 60 * 60 * 1000)
    const reclaimed = await repository.reclaimExpiredLeases(bemDepois)

    expect(reclaimed).toBeGreaterThanOrEqual(1)
    expect((await repository.findByEventId(input.eventId))?.getState()).toBe('PENDING')
  })

  it('falha devolve a PENDING com o erro resumido, e a tentativa seguinte incrementa o contador', async () => {
    const input = enqueueInput(randomUUID())
    await repository.enqueue(input)
    const claimed = await repository.claimNextPending()

    await repository.releaseToPending(
      claimed?.event.requireId() ?? 0,
      'PLUGGY_ITEMS_UPSTREAM_ERROR',
      claimed?.leaseToken ?? new Date(),
    )

    const released = await repository.findByEventId(input.eventId)
    expect(released?.getState()).toBe('PENDING')
    expect(released?.getErrorSummary()).toBe('PLUGGY_ITEMS_UPSTREAM_ERROR')

    const retried = await repository.claimNextPending()
    expect(retried?.event.getEventId()).toBe(input.eventId)
    expect(retried?.event.getAttempts()).toBe(2)
  })

  it('worker que perdeu o lease não sobrescreve o estado de quem reivindicou depois', async () => {
    const input = enqueueInput(randomUUID())
    await repository.enqueue(input)
    const primeiroWorker = await repository.claimNextPending()

    // O lease vence com o primeiro worker ainda vivo e outro reivindica o mesmo evento.
    const bemDepois = new Date(Date.now() + 60 * 60 * 1000)
    await repository.reclaimExpiredLeases(bemDepois)
    const segundoWorker = await repository.claimNextPending(bemDepois)
    expect(segundoWorker?.event.getEventId()).toBe(input.eventId)

    // O primeiro worker termina agora, atrasado: a escrita dele não pega mais o evento.
    const escreveu = await repository.markSucceeded(
      primeiroWorker?.event.requireId() ?? 0,
      primeiroWorker?.leaseToken ?? new Date(),
    )

    expect(escreveu).toBe(false)
    expect((await repository.findByEventId(input.eventId))?.getState()).toBe('PROCESSING')
  })

  // Revisão do PR #14: sem a prioridade de `item/deleted`, um `item/updated` mais antigo (id menor)
  // preso repetidamente à frente na fila por `id ASC` nunca deixaria o `item/deleted` do MESMO item
  // ser sequer reivindicado.
  it('item/deleted é reivindicado antes de um item/updated mais antigo (id menor) do mesmo item', async () => {
    const itemId = randomUUID()
    const updated = enqueueInput(itemId, randomUUID(), 'item/updated')
    await repository.enqueue(updated)
    const deleted = enqueueInput(itemId, randomUUID(), 'item/deleted')
    await repository.enqueue(deleted)

    const claimed = await repository.claimNextPending()

    expect(claimed?.event.getEventId()).toBe(deleted.eventId)
    expect(claimed?.event.getEvent()).toBe('item/deleted')
  })

  it('item/deleted é reivindicado antes de um item/updated mais antigo de OUTRO item, mesmo com id maior', async () => {
    const outroItem = randomUUID()
    const updated = enqueueInput(outroItem, randomUUID(), 'item/updated')
    await repository.enqueue(updated)
    const deleted = enqueueInput(randomUUID(), randomUUID(), 'item/deleted')
    await repository.enqueue(deleted)

    const claimed = await repository.claimNextPending()

    expect(claimed?.event.getEventId()).toBe(deleted.eventId)
  })

  it('sucesso limpa o erro anterior e sai da fila de pendentes', async () => {
    const input = enqueueInput(randomUUID())
    await repository.enqueue(input)
    const claimed = await repository.claimNextPending()
    await repository.releaseToPending(claimed?.event.requireId() ?? 0, 'erro anterior', claimed?.leaseToken ?? new Date())
    const retried = await repository.claimNextPending()

    await repository.markSucceeded(retried?.event.requireId() ?? 0, retried?.leaseToken ?? new Date())

    const done = await repository.findByEventId(input.eventId)
    expect(done?.getState()).toBe('SUCCEEDED')
    expect(done?.getErrorSummary()).toBeUndefined()
  })
})
