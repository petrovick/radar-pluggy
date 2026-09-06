import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import AcceptPluggyWebhookImpl from '../../../../src/adapters/gateways/pluggy-webhook/accept-pluggy-webhook.impl.js'
import { PluggyCredentialRep } from '../../../../src/adapters/repositories/pluggy-credential.rep.js'
import { PluggyCredentialItemRep } from '../../../../src/adapters/repositories/pluggy-credential-item.rep.js'
import { PluggyWebhookEventRep } from '../../../../src/adapters/repositories/pluggy-webhook-event.rep.js'
import { PluggyItemCredentialResolver } from '../../../../src/adapters/gateways/pluggy-item-credential.resolver.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'
import { definePluggyCredentialModel } from '../../../../src/infra/db/models/pluggy-credential-model.js'
import { definePluggyCredentialItemModel } from '../../../../src/infra/db/models/pluggy-credential-item-model.js'
import { definePluggyWebhookEventModel } from '../../../../src/infra/db/models/pluggy-webhook-event-model.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'

// Requer MySQL alcançável. Prova a regra de confiança do webhook contra dado real: o segredo vive
// cifrado no banco, e a comparação acontece por credencial daquele item — nunca um segredo único de
// processo (arquitetura-camadas, seção 4; design.md W1).
describe('AcceptPluggyWebhookImpl.isTrustedNotification', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const credentialModel = definePluggyCredentialModel(sequelize)
  const credentialItemModel = definePluggyCredentialItemModel(sequelize)
  const webhookEventModel = definePluggyWebhookEventModel(sequelize)

  const container = {
    db: {
      models: {
        pluggyCredential: credentialModel,
        pluggyCredentialItem: credentialItemModel,
        pluggyWebhookEvent: webhookEventModel,
      },
    },
    logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    getTransaction: () => null,
    setTransaction: () => {},
    // Os dois segredos (client_secret e webhook_secret) são cifrados com esta chave.
    credentialEncryptionKey: randomBytes(32).toString('base64'),
  } as unknown as AppContainer

  const mutable = container as unknown as Record<string, unknown>
  mutable.pluggyCredentialRep = new PluggyCredentialRep(container)
  mutable.pluggyCredentialItemRep = new PluggyCredentialItemRep(container)
  mutable.pluggyWebhookEventRep = new PluggyWebhookEventRep(container)
  // O impl compõe o resolver (arquitetura-camadas, 2.3.1) em vez de repetir os dois lookups; é o
  // mesmo colaborador que posição e histórico usam.
  mutable.pluggyItemCredentialResolver = new PluggyItemCredentialResolver(container)

  const impl = new AcceptPluggyWebhookImpl(container)
  const credentialIds: number[] = []
  const itemIds: string[] = []

  async function seedCredential(secret: string | undefined): Promise<{ itemId: string }> {
    const credentialRep = new PluggyCredentialRep(container)
    const credential = await credentialRep.create({
      personId: 1,
      clientId: randomUUID(),
      clientSecret: 'client-secret',
    })
    const credentialId = credential.requireId()
    credentialIds.push(credentialId)

    if (secret !== undefined) {
      await credentialRep.saveWebhook(credentialId, {
        secret,
        webhookId: randomUUID(),
        url: 'https://pluggy-connector.example.com/webhooks/pluggy',
        event: 'all',
      })
    }

    const itemId = randomUUID()
    itemIds.push(itemId)
    await new PluggyCredentialItemRep(container).linkItem(credentialId, itemId)

    return { itemId }
  }

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

  it('segredo correto da credencial daquele item é confiável', async () => {
    const { itemId } = await seedCredential('segredo-certo')

    await expect(impl.isTrustedNotification(itemId, 'segredo-certo')).resolves.toBe(true)
  })

  it('segredo errado não é confiável', async () => {
    const { itemId } = await seedCredential('segredo-certo')

    await expect(impl.isTrustedNotification(itemId, 'segredo-errado')).resolves.toBe(false)
  })

  it('segredo de tamanho diferente não é confiável (e não estoura o timingSafeEqual)', async () => {
    const { itemId } = await seedCredential('segredo-certo')

    await expect(impl.isTrustedNotification(itemId, 'x')).resolves.toBe(false)
  })

  it('item sem vínculo persistido não é confiável — dono nunca é inferido do payload', async () => {
    await expect(impl.isTrustedNotification(randomUUID(), 'qualquer')).resolves.toBe(false)
  })

  it('credencial sem webhook provisionado não é confiável, nunca "aceita porque não há segredo"', async () => {
    const { itemId } = await seedCredential(undefined)

    await expect(impl.isTrustedNotification(itemId, '')).resolves.toBe(false)
  })
})
