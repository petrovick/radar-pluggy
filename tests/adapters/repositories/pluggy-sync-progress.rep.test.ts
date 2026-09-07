import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { definePluggySyncProgressModel } from '../../../src/infra/db/models/pluggy-sync-progress-model.js'
import { PluggySyncProgressRep } from '../../../src/adapters/repositories/pluggy-sync-progress.rep.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'

describe('PluggySyncProgressRep', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggySyncProgressModel(sequelize)
  const repository = new PluggySyncProgressRep({
    db: { models: { pluggySyncProgress: model } },
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

  it('combinação nunca observada devolve undefined — sempre elegível', async () => {
    expect(await repository.read(randomUUID(), 'POSITION_SYNC', 'INVESTMENTS')).toBeUndefined()
  })

  it('advance grava e read devolve a versão gravada; devolve true (venceu a corrida)', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)
    const versionAt = new Date('2026-08-01T00:00:00.000Z')

    await expect(repository.advance(itemId, 'POSITION_SYNC', 'INVESTMENTS', versionAt)).resolves.toBe(true)

    expect(await repository.read(itemId, 'POSITION_SYNC', 'INVESTMENTS')).toEqual(versionAt)
  })

  it('duas fontes do mesmo consumidor avançam de forma independente', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.advance(itemId, 'POSITION_SYNC', 'INVESTMENTS', new Date('2026-08-01T00:00:00.000Z'))

    expect(await repository.read(itemId, 'POSITION_SYNC', 'LOANS')).toBeUndefined()
  })

  it('a mesma fonte não compartilha marca d’água entre consumidores', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.advance(itemId, 'POSITION_SYNC', 'INVESTMENTS', new Date('2026-08-01T00:00:00.000Z'))

    expect(await repository.read(itemId, 'HISTORY_LOAD', 'INVESTMENTS')).toBeUndefined()
  })

  it('timestamp mais antigo é recusado (no-op, devolve false), a marca d’água registrada não muda', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)
    const first = new Date('2026-08-01T00:00:00.000Z')
    const earlier = new Date('2026-07-01T00:00:00.000Z')

    await expect(repository.advance(itemId, 'HISTORY_LOAD', 'ACCOUNTS', first)).resolves.toBe(true)
    await expect(repository.advance(itemId, 'HISTORY_LOAD', 'ACCOUNTS', earlier)).resolves.toBe(false)

    expect(await repository.read(itemId, 'HISTORY_LOAD', 'ACCOUNTS')).toEqual(first)
  })

  it('duas escritas concorrentes: a versão mais nova sempre prevalece, independente da ordem de conclusão', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)
    const older = new Date('2026-08-01T00:00:00.000Z')
    const newer = new Date('2026-08-10T00:00:00.000Z')

    await Promise.all([
      repository.advance(itemId, 'HISTORY_LOAD', 'INVESTMENT_TRANSACTIONS', newer),
      repository.advance(itemId, 'HISTORY_LOAD', 'INVESTMENT_TRANSACTIONS', older),
    ])

    expect(await repository.read(itemId, 'HISTORY_LOAD', 'INVESTMENT_TRANSACTIONS')).toEqual(newer)
  })
})
