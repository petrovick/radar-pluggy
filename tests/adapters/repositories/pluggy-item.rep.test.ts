import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { definePluggyItemModel } from '../../../src/infra/db/models/pluggy-item-model.js'
import { PluggyItemRep } from '../../../src/adapters/repositories/pluggy-item.rep.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import { PluggyItem } from '../../../src/entities/pluggy-item.js'

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

  it('watermark que retrocede é ignorado silenciosamente (no-op), nunca erro (design.md D17)', async () => {
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
      repository.save({ itemId, personId: 1, status: 'OUTDATED', executionStatus: undefined, lastUpdatedAt: earlier }),
    ).resolves.toBeInstanceOf(PluggyItem)

    const row = await model.findOne({ where: { item_id: itemId } })
    expect(row?.get('last_updated_at')).toEqual(first)
    // A escrita inteira (não só a watermark) é recusada junto: `status` também não regride.
    expect(row?.get('status')).toBe('UPDATED')
  })

  it('duas escritas concorrentes com versões diferentes: a mais nova sempre prevalece, independente da ordem de conclusão (D17)', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)
    const older = new Date('2026-08-01T00:00:00.000Z')
    const newer = new Date('2026-08-02T00:00:00.000Z')

    await repository.save({ itemId, personId: 1, status: 'UPDATED', executionStatus: undefined, lastUpdatedAt: undefined })

    // Duas execuções disparadas antes de aguardar qualquer uma — a ordem de CONCLUSÃO é invertida em
    // relação à ordem de "quem tem a versão mais nova" (a mais nova é disparada primeiro aqui, mas o
    // que importa é que ambas corram de fato em paralelo, não a ordem de disparo).
    await Promise.all([
      repository.save({ itemId, personId: 1, status: 'UPDATED', executionStatus: 'SUCCESS', lastUpdatedAt: newer }),
      repository.save({ itemId, personId: 1, status: 'UPDATED', executionStatus: 'SUCCESS', lastUpdatedAt: older }),
    ])

    const row = await model.findOne({ where: { item_id: itemId } })
    expect(row?.get('last_updated_at')).toEqual(newer)
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
