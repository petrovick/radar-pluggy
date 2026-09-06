import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import CheckPluggyCredentialImpl from '../../../../src/adapters/gateways/pluggy-credential/check-pluggy-credential.impl.js'
import { PluggyCredentialRep } from '../../../../src/adapters/repositories/pluggy-credential.rep.js'
import { PluggyCredentialItemRep } from '../../../../src/adapters/repositories/pluggy-credential-item.rep.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'
import { definePluggyCredentialModel } from '../../../../src/infra/db/models/pluggy-credential-model.js'
import { definePluggyCredentialItemModel } from '../../../../src/infra/db/models/pluggy-credential-item-model.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'

// Requer MySQL alcançável. Prova que a tradução entidade → id acontece aqui, e que a leitura é
// filtrada pela pessoa: credencial de outra pessoa nunca entra no resultado.
describe('CheckPluggyCredentialImpl', () => {
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

  const impl = new CheckPluggyCredentialImpl(container)
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

  // `personId` alto e único por execução: `people` é de outro repositório e este teste nunca escreve
  // nela (fronteira-pluggy regra 13), então a pessoa usada aqui só precisa não colidir.
  function uniquePersonId(): number {
    return 900_000_000 + Math.floor(Math.random() * 90_000_000)
  }

  async function seed(personId: number, withItem: boolean): Promise<number> {
    const credential = await credentialRep.create({
      personId,
      clientId: randomUUID(),
      clientSecret: 'segredo',
    })
    const credentialId = credential.requireId()
    credentialIds.push(credentialId)

    if (withItem) {
      const itemId = randomUUID()
      itemIds.push(itemId)
      await credentialItemRep.linkItem(credentialId, itemId)
    }

    return credentialId
  }

  it('devolve os ids das credenciais daquela pessoa, e só delas', async () => {
    const personId = uniquePersonId()
    const outraPessoa = uniquePersonId()
    const credentialId = await seed(personId, false)
    await seed(outraPessoa, false)

    await expect(impl.readCredentialIds(personId)).resolves.toEqual([credentialId])
  })

  it('devolve os itemIds vinculados às credenciais informadas', async () => {
    const personId = uniquePersonId()
    const credentialId = await seed(personId, true)

    const itemIdsLidos = await impl.readLinkedItemIds([credentialId])

    expect(itemIdsLidos).toHaveLength(1)
    expect(itemIds).toContain(itemIdsLidos[0])
  })

  it('credencial sem item vinculado devolve lista vazia, nunca um item de outra credencial', async () => {
    const personId = uniquePersonId()
    const semItem = await seed(personId, false)
    await seed(uniquePersonId(), true)

    await expect(impl.readLinkedItemIds([semItem])).resolves.toEqual([])
  })
})
