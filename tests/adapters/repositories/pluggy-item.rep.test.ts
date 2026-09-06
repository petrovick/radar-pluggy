import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { definePluggyItemModel } from '../../../src/infra/db/models/pluggy-item-model.js'
import { PluggyItemRep } from '../../../src/adapters/repositories/pluggy-item.rep.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

// Requer MySQL alcançável, mesma infraestrutura do teste de contrato — ver aquele arquivo.
describe('PluggyItemRep.save', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyItemModel(sequelize)
  const repository = new PluggyItemRep({
    db: { models: { pluggyItem: model } },
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

  it('duas chamadas para o mesmo itemId atualizam a mesma linha, nunca criam uma segunda', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save({
      itemId,
      personId: 1,
      status: 'UPDATING',
      executionStatus: undefined,
      lastUpdatedAt: undefined,
    })
    await repository.save({
      itemId,
      personId: 1,
      status: 'UPDATED',
      executionStatus: 'SUCCESS',
      lastUpdatedAt: undefined,
    })

    const rows = await model.findAll({ where: { item_id: itemId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.get('status')).toBe('UPDATED')
    expect(rows[0]?.get('execution_status')).toBe('SUCCESS')
  })

  it('watermark que retrocede é recusado pelo caminho real de persistência, sem alterar a linha', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)
    const first = new Date('2026-08-01T00:00:00.000Z')
    const earlier = new Date('2026-07-01T00:00:00.000Z')

    await repository.save({
      itemId,
      personId: 1,
      status: 'UPDATED',
      executionStatus: undefined,
      lastUpdatedAt: first,
    })

    await expect(
      repository.save({ itemId, personId: 1, status: 'UPDATED', executionStatus: undefined, lastUpdatedAt: earlier }),
    ).rejects.toBeInstanceOf(ApplicationError)

    const row = await model.findOne({ where: { item_id: itemId } })
    expect(row?.get('last_updated_at')).toEqual(first)
  })

  it('findByItemId devolve o item persistido, e undefined para itemId inexistente', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save({ itemId, personId: 1, status: 'UPDATED', executionStatus: 'SUCCESS', lastUpdatedAt: undefined })

    const found = await repository.findByItemId(itemId)
    expect(found?.getItemId()).toBe(itemId)
    expect(await repository.findByItemId(randomUUID())).toBeUndefined()
  })
})
