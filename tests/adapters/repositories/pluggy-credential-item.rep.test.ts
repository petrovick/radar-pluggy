import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { definePluggyCredentialModel } from '../../../src/infra/db/models/pluggy-credential-model.js'
import { definePluggyCredentialItemModel } from '../../../src/infra/db/models/pluggy-credential-item-model.js'
import { PluggyCredentialRep } from '../../../src/adapters/repositories/pluggy-credential.rep.js'
import { PluggyCredentialItemRep } from '../../../src/adapters/repositories/pluggy-credential-item.rep.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'

describe('PluggyCredentialItemRep', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const credentialModel = definePluggyCredentialModel(sequelize)
  const credentialItemModel = definePluggyCredentialItemModel(sequelize)
  const params = {
    db: { models: { pluggyCredential: credentialModel, pluggyCredentialItem: credentialItemModel } },
    getTransaction: () => null,
    credentialEncryptionKey: randomBytes(32).toString('base64'),
  } as unknown as AppContainer
  const credentialRep = new PluggyCredentialRep(params)
  const credentialItemRep = new PluggyCredentialItemRep(params)
  const clientIdsToCleanup: string[] = []
  const itemIdsToCleanup: string[] = []

  afterEach(async () => {
    while (itemIdsToCleanup.length > 0) {
      await credentialItemModel.destroy({ where: { item_id: itemIdsToCleanup.pop() } })
    }
    while (clientIdsToCleanup.length > 0) {
      await credentialModel.destroy({ where: { client_id: clientIdsToCleanup.pop() } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('linkItem vincula o itemId à credencial, e findCredentialIdByItemId resolve de volta', async () => {
    const clientId = randomUUID()
    const itemId = randomUUID()
    clientIdsToCleanup.push(clientId)
    itemIdsToCleanup.push(itemId)

    const credential = await credentialRep.create({ personId: 1, clientId, clientSecret: 'segredo' })
    await credentialItemRep.linkItem(credential.requireId(), itemId)

    const resolvedCredentialId = await credentialItemRep.findCredentialIdByItemId(itemId)
    expect(resolvedCredentialId).toBe(credential.getId())
  })

  it('findCredentialIdByItemId devolve undefined para itemId sem vínculo', async () => {
    const resolved = await credentialItemRep.findCredentialIdByItemId(randomUUID())
    expect(resolved).toBeUndefined()
  })

  it('findItemIdsByCredentialIds devolve todos os itemIds de uma credencial, e vazio para lista vazia', async () => {
    const clientId = randomUUID()
    const firstItemId = randomUUID()
    const secondItemId = randomUUID()
    clientIdsToCleanup.push(clientId)
    itemIdsToCleanup.push(firstItemId, secondItemId)

    const credential = await credentialRep.create({ personId: 1, clientId, clientSecret: 'segredo' })
    await credentialItemRep.linkItem(credential.requireId(), firstItemId)
    await credentialItemRep.linkItem(credential.requireId(), secondItemId)

    const itemIds = await credentialItemRep.findItemIdsByCredentialIds([credential.requireId()])
    expect(itemIds.sort()).toEqual([firstItemId, secondItemId].sort())

    expect(await credentialItemRep.findItemIdsByCredentialIds([])).toEqual([])
  })

  it('itemId duplicado é recusado pela constraint real do banco', async () => {
    const firstClientId = randomUUID()
    const secondClientId = randomUUID()
    const itemId = randomUUID()
    clientIdsToCleanup.push(firstClientId, secondClientId)
    itemIdsToCleanup.push(itemId)

    const firstCredential = await credentialRep.create({
      personId: 1,
      clientId: firstClientId,
      clientSecret: 'segredo-1',
    })
    const secondCredential = await credentialRep.create({
      personId: 1,
      clientId: secondClientId,
      clientSecret: 'segredo-2',
    })

    await credentialItemRep.linkItem(firstCredential.requireId(), itemId)
    await expect(credentialItemRep.linkItem(secondCredential.requireId(), itemId)).rejects.toThrow()
  })
})
