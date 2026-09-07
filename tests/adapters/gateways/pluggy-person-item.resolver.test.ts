import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { PluggyPersonItemResolver } from '../../../src/adapters/gateways/pluggy-person-item.resolver.js'
import { PluggyCredentialRep } from '../../../src/adapters/repositories/pluggy-credential.rep.js'
import { PluggyCredentialItemRep } from '../../../src/adapters/repositories/pluggy-credential-item.rep.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import { definePluggyCredentialModel } from '../../../src/infra/db/models/pluggy-credential-model.js'
import { definePluggyCredentialItemModel } from '../../../src/infra/db/models/pluggy-credential-item-model.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'

// Direção pessoa → itens, usada por `read-pluggy-position` e `read-pluggy-account`. Ausência nunca
// é erro aqui — só `CheckPluggyCredentialImpl` nomeia as duas ausências como recusa.
describe('PluggyPersonItemResolver', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const credentialModel = definePluggyCredentialModel(sequelize)
  const credentialItemModel = definePluggyCredentialItemModel(sequelize)

  const container = {
    db: { models: { pluggyCredential: credentialModel, pluggyCredentialItem: credentialItemModel } },
    logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    getTransaction: () => null,
    setTransaction: () => {},
    credentialEncryptionKey: randomBytes(32).toString('base64'),
  } as unknown as AppContainer

  const mutable = container as unknown as Record<string, unknown>
  const credentialRep = new PluggyCredentialRep(container)
  const credentialItemRep = new PluggyCredentialItemRep(container)
  mutable.pluggyCredentialRep = credentialRep
  mutable.pluggyCredentialItemRep = credentialItemRep

  const resolver = new PluggyPersonItemResolver(container)
  const credentialIds: number[] = []
  const itemIds: string[] = []

  afterEach(async () => {
    while (itemIds.length > 0) {
      const itemId = itemIds.pop()
      if (itemId !== undefined) {
        await credentialItemModel.destroy({ where: { item_id: itemId } })
      }
    }
    while (credentialIds.length > 0) {
      const id = credentialIds.pop()
      if (id !== undefined) {
        await credentialModel.destroy({ where: { id } })
      }
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  function uniquePersonId(): number {
    return 900_000_000 + Math.floor(Math.random() * 90_000_000)
  }

  async function seedCredentialWithItems(personId: number, itemCount: number): Promise<void> {
    const credential = await credentialRep.create({
      personId,
      clientId: randomUUID(),
      clientSecret: 'segredo',
    })
    const credentialId = credential.requireId()
    credentialIds.push(credentialId)

    for (let i = 0; i < itemCount; i++) {
      const itemId = randomUUID()
      itemIds.push(itemId)
      await credentialItemRep.linkItem(credentialId, itemId)
    }
  }

  it('devolve os itens de todas as credenciais da pessoa, cruzando instituições', async () => {
    const personId = uniquePersonId()
    await seedCredentialWithItems(personId, 1)
    await seedCredentialWithItems(personId, 2)

    const found = await resolver.itemIdsFor(personId)

    expect(found).toHaveLength(3)
    expect(new Set(found)).toEqual(new Set(itemIds))
  })

  it('pessoa sem credencial cadastrada devolve lista vazia, nunca recusa', async () => {
    await expect(resolver.itemIdsFor(uniquePersonId())).resolves.toEqual([])
  })

  it('pessoa com credencial mas sem item vinculado devolve lista vazia', async () => {
    const personId = uniquePersonId()
    await seedCredentialWithItems(personId, 0)

    await expect(resolver.itemIdsFor(personId)).resolves.toEqual([])
  })

  it('nunca devolve item de outra pessoa', async () => {
    const personId = uniquePersonId()
    await seedCredentialWithItems(personId, 1)
    await seedCredentialWithItems(uniquePersonId(), 1)

    const found = await resolver.itemIdsFor(personId)

    expect(found).toHaveLength(1)
  })
})
