import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { PluggyItemIngestionLeaseRep } from '../../../src/adapters/repositories/pluggy-item-ingestion-lease.rep.js'
import { definePluggyItemIngestionLeaseModel } from '../../../src/infra/db/models/pluggy-item-ingestion-lease-model.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'

const TTL_MS = 60_000

describe('PluggyItemIngestionLeaseRep', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyItemIngestionLeaseModel(sequelize)
  const repository = new PluggyItemIngestionLeaseRep({
    db: { models: { pluggyItemIngestionLease: model } },
    getTransaction: () => null,
  } as unknown as AppContainer)
  const itemIdsToCleanup: string[] = []

  afterEach(async () => {
    const itemId = itemIdsToCleanup.pop()
    if (itemId !== undefined) {
      await model.destroy({ where: { item_id: itemId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('primeira aquisição de um item nunca visto devolve um token', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const token = await repository.tryAcquire(itemId, 'WEBHOOK', TTL_MS)

    expect(token).toBeDefined()
  })

  it('segunda aquisição do mesmo item, lease vigente, falha (undefined)', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.tryAcquire(itemId, 'WEBHOOK', TTL_MS)
    const second = await repository.tryAcquire(itemId, 'CREDENTIAL_REGISTRATION_PRELOAD', TTL_MS)

    expect(second).toBeUndefined()
  })

  it('duas aquisições concorrentes do mesmo item: só uma consegue, tokens distintos', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const [a, b] = await Promise.all([
      repository.tryAcquire(itemId, 'WEBHOOK', TTL_MS),
      repository.tryAcquire(itemId, 'CREDENTIAL_REGISTRATION_PRELOAD', TTL_MS),
    ])

    const successful = [a, b].filter((token) => token !== undefined)
    expect(successful).toHaveLength(1)
  })

  it('lease vencido é reivindicável por outro trigger, com fencing_token maior', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const first = await repository.tryAcquire(itemId, 'WEBHOOK', -1)
    // TTL negativo simula lease já vencido (lease_until no passado).
    const second = await repository.tryAcquire(itemId, 'MANUAL_HISTORY_LOAD', TTL_MS)

    expect(second).toBeDefined()
    expect(second).toBeGreaterThan(first ?? 0)
  })

  it('renew com fencing_token correto estende o lease e devolve true', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const token = await repository.tryAcquire(itemId, 'WEBHOOK', TTL_MS)
    const renewed = await repository.renew(itemId, token ?? -1, TTL_MS)

    expect(renewed).toBe(true)
  })

  it('renew com fencing_token errado (perdido) devolve false e não afeta a linha', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.tryAcquire(itemId, 'WEBHOOK', TTL_MS)
    const renewed = await repository.renew(itemId, 999999, TTL_MS)

    expect(renewed).toBe(false)
  })

  it('release com fencing_token correto libera o lease, permitindo nova aquisição', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const token = await repository.tryAcquire(itemId, 'WEBHOOK', TTL_MS)
    const released = await repository.release(itemId, token ?? -1)
    expect(released).toBe(true)

    const next = await repository.tryAcquire(itemId, 'BOOT_RECOVERY', TTL_MS)
    expect(next).toBeDefined()
  })

  it('release com fencing_token errado devolve false, sem liberar o lease de quem detém agora', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const staleToken = await repository.tryAcquire(itemId, 'WEBHOOK', -1)
    const currentToken = await repository.tryAcquire(itemId, 'BOOT_RECOVERY', TTL_MS)

    const released = await repository.release(itemId, staleToken ?? -1)
    expect(released).toBe(false)

    // Quem detém agora (currentToken) ainda consegue renovar — não foi liberado por engano.
    expect(await repository.renew(itemId, currentToken ?? -1, TTL_MS)).toBe(true)
  })
})
