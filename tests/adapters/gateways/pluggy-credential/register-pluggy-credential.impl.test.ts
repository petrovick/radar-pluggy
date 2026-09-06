import { randomBytes, randomUUID } from 'node:crypto'
import SequelizeLib, { type Transaction } from 'sequelize'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import RegisterPluggyCredentialImpl from '../../../../src/adapters/gateways/pluggy-credential/register-pluggy-credential.impl.js'
import { PluggyCredentialRep } from '../../../../src/adapters/repositories/pluggy-credential.rep.js'
import { PluggyCredentialItemRep } from '../../../../src/adapters/repositories/pluggy-credential-item.rep.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'
import { DB_NAMES } from '../../../../src/infra/db/models.js'
import { definePluggyCredentialModel } from '../../../../src/infra/db/models/pluggy-credential-model.js'
import { definePluggyCredentialItemModel } from '../../../../src/infra/db/models/pluggy-credential-item-model.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import type { PluggyConnectorClient } from '../../../../src/adapters/gateways/pluggy-client.gateway.js'

describe('RegisterPluggyCredentialImpl', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const credentialModel = definePluggyCredentialModel(sequelize)
  const credentialItemModel = definePluggyCredentialItemModel(sequelize)

  const transactions = new Map<string, Transaction | null>()

  let freshClientCreated = false
  let fetchItemCalledWithClient: PluggyConnectorClient | undefined

  const fakeFreshClient = { fake: 'fresh-client' } as unknown as PluggyConnectorClient

  const container = {
    db: {
      Sequelize: SequelizeLib,
      connections: { [DB_NAMES.MAIN]: sequelize },
      models: { pluggyCredential: credentialModel, pluggyCredentialItem: credentialItemModel },
    },
    logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    getTransaction: (name: string) => transactions.get(name) ?? null,
    setTransaction: (name: string, tx: Transaction | null) => {
      transactions.set(name, tx)
    },
    credentialEncryptionKey: randomBytes(32).toString('base64'),
    pluggyClientGateway: {
      createFreshClient: () => {
        freshClientCreated = true
        return fakeFreshClient
      },
    },
    pluggyItemsGateway: {
      fetchItem: async (_itemId: string, client: PluggyConnectorClient) => {
        fetchItemCalledWithClient = client
        return {} as never
      },
    },
    pluggyWebhookProvisioner: {
      provisionFor: async () => {},
    },
  } as unknown as AppContainer

  const mutable = container as unknown as Record<string, unknown>
  mutable.pluggyCredentialRep = new PluggyCredentialRep(container)
  mutable.pluggyCredentialItemRep = new PluggyCredentialItemRep(container)

  const impl = new RegisterPluggyCredentialImpl(container)
  const credentialIds: number[] = []
  const itemIds: string[] = []

  afterEach(async () => {
    freshClientCreated = false
    fetchItemCalledWithClient = undefined
    transactions.clear()

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

  it('checkItemAvailable: permite item livre e recusa item já vinculado', async () => {
    const itemIdLivre = randomUUID()
    await expect(impl.checkItemAvailable(itemIdLivre)).resolves.toBeUndefined()

    const itemIdOcupado = randomUUID()
    const credId = await impl.saveCredentialWithItemLink({
      personId: 1,
      clientId: randomUUID(),
      clientSecret: 'segredo',
      itemId: itemIdOcupado,
    })
    credentialIds.push(credId)
    itemIds.push(itemIdOcupado)

    await expect(impl.checkItemAvailable(itemIdOcupado)).rejects.toMatchObject({
      errorType: 'PLUGGY_CREDENTIAL_ITEM_ALREADY_LINKED',
    })
  })

  it('validateItemAccess: instancia cliente novo fora do cache para validar acesso na Pluggy', async () => {
    await impl.validateItemAccess({
      clientId: 'meu-client-id',
      clientSecret: 'meu-client-secret',
      itemId: 'meu-item-id',
    })

    expect(freshClientCreated).toBe(true)
    expect(fetchItemCalledWithClient).toBe(fakeFreshClient)
  })

  it('saveCredentialWithItemLink: persiste credencial cifrada e vínculo na mesma transação', async () => {
    const clientId = randomUUID()
    const itemId = randomUUID()

    const credentialId = await impl.saveCredentialWithItemLink({
      personId: 1,
      clientId,
      clientSecret: 'segredo-em-claro',
      itemId,
    })
    credentialIds.push(credentialId)
    itemIds.push(itemId)

    const row = await credentialModel.findByPk(credentialId)
    expect(row?.get().client_id).toBe(clientId)
    expect(row?.get().client_secret).not.toContain('segredo-em-claro')

    const link = await credentialItemModel.findOne({ where: { item_id: itemId } })
    expect(link?.get().credential_id).toBe(credentialId)
  })

  it('saveCredentialWithItemLink: falha no vínculo desfaz a credencial por rollback completo', async () => {
    const itemDisputado = randomUUID()

    // 1. Cria primeiro registro ocupando o itemDisputado
    const primeira = await impl.saveCredentialWithItemLink({
      personId: 1,
      clientId: randomUUID(),
      clientSecret: 'segredo',
      itemId: itemDisputado,
    })
    credentialIds.push(primeira)
    itemIds.push(itemDisputado)

    // 2. Segunda tentativa tenta usar o mesmo itemDisputado
    const segundoClientId = randomUUID()
    const segundaTentativa = impl.saveCredentialWithItemLink({
      personId: 1,
      clientId: segundoClientId,
      clientSecret: 'segredo',
      itemId: itemDisputado,
    })

    await expect(segundaTentativa).rejects.toThrow()

    // Comprovando atomicidade: a segunda credencial NÃO pode existir no banco após o rollback
    const segundaNoBanco = await credentialModel.findOne({ where: { client_id: segundoClientId } })
    expect(segundaNoBanco).toBeNull()
  })

  it('provisionWebhook: delega para o PluggyWebhookProvisioner compartilhado', async () => {
    const provisionCalls: number[] = []
    const implComProvisioner = new RegisterPluggyCredentialImpl({
      ...container,
      pluggyWebhookProvisioner: {
        provisionFor: async (credentialId: number) => {
          provisionCalls.push(credentialId)
        },
      },
    } as unknown as AppContainer)

    await implComProvisioner.provisionWebhook(42)

    expect(provisionCalls).toEqual([42])
  })
})
