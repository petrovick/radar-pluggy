import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { definePluggyConsentModel } from '../../../src/infra/db/models/pluggy-consent-model.js'
import { PluggyConsentRep } from '../../../src/adapters/repositories/pluggy-consent.rep.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'

// Requer MySQL alcançável, mesma infraestrutura do teste de contrato — ver aquele arquivo.
describe('PluggyConsentRep.save', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyConsentModel(sequelize)
  const repository = new PluggyConsentRep({
    db: { models: { pluggyConsent: model } },
    getTransaction: () => null,
  } as unknown as AppContainer)
  const itemIdsToCleanup: string[] = []

  afterEach(async () => {
    let itemId: string | undefined
    while ((itemId = itemIdsToCleanup.pop()) !== undefined) {
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
      consentId: 'consent-1',
      grantedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: undefined,
      revokedAt: undefined,
    })
    await repository.save({
      itemId,
      consentId: 'consent-2',
      grantedAt: new Date('2026-02-01T00:00:00.000Z'),
      expiresAt: undefined,
      revokedAt: new Date('2026-02-15T00:00:00.000Z'),
    })

    const rows = await model.findAll({ where: { item_id: itemId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.get('consent_id')).toBe('consent-2')
    expect(rows[0]?.get('revoked_at')).toEqual(new Date('2026-02-15T00:00:00.000Z'))
  })

  it('consent_id já vinculado a outro item recusa nomeado, nunca UniqueConstraintError cru', async () => {
    const firstItemId = randomUUID()
    const secondItemId = randomUUID()
    itemIdsToCleanup.push(firstItemId, secondItemId)

    await repository.save({
      itemId: firstItemId,
      consentId: 'consent-compartilhado',
      grantedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: undefined,
      revokedAt: undefined,
    })

    await expect(
      repository.save({
        itemId: secondItemId,
        consentId: 'consent-compartilhado',
        grantedAt: new Date('2026-01-02T00:00:00.000Z'),
        expiresAt: undefined,
        revokedAt: undefined,
      }),
    ).rejects.toMatchObject({
      errorType: 'PLUGGY_CONSENT_ID_CONFLICT',
      details: { consentId: 'consent-compartilhado', itemId: secondItemId },
    })

    const rows = await model.findAll({ where: { item_id: secondItemId } })
    expect(rows).toHaveLength(0)
  })
})
