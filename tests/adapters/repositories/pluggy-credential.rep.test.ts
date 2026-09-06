import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { definePluggyCredentialModel } from '../../../src/infra/db/models/pluggy-credential-model.js'
import { PluggyCredentialRep } from '../../../src/adapters/repositories/pluggy-credential.rep.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

// Requer MySQL alcançável, mesma infraestrutura do teste de contrato — ver aquele arquivo.
describe('PluggyCredentialRep.create', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyCredentialModel(sequelize)
  const repository = new PluggyCredentialRep({
    db: { models: { pluggyCredential: model } },
    getTransaction: () => null,
    credentialEncryptionKey: randomBytes(32).toString('base64'),
  } as unknown as AppContainer)
  const clientIdsToCleanup: string[] = []

  afterEach(async () => {
    while (clientIdsToCleanup.length > 0) {
      const clientId = clientIdsToCleanup.pop()
      await model.destroy({ where: { client_id: clientId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('persiste o clientSecret cifrado no banco e o devolve decifrado na entidade', async () => {
    const clientId = randomUUID()
    clientIdsToCleanup.push(clientId)

    const credential = await repository.create({ personId: 1, clientId, clientSecret: 'segredo-em-claro' })
    expect(credential.getClientSecret()).toBe('segredo-em-claro')
    expect(credential.getId()).toBeTypeOf('number')

    const row = await model.findOne({ where: { client_id: clientId } })
    expect(row?.get('client_secret')).not.toBe('segredo-em-claro')
  })

  it('uma pessoa pode ter mais de uma credencial', async () => {
    const firstClientId = randomUUID()
    const secondClientId = randomUUID()
    clientIdsToCleanup.push(firstClientId, secondClientId)

    await repository.create({ personId: 1, clientId: firstClientId, clientSecret: 'segredo-1' })
    const second = await repository.create({ personId: 1, clientId: secondClientId, clientSecret: 'segredo-2' })
    expect(second.getPersonId()).toBe(1)
  })

  it('recusa client_id duplicado pela constraint real do banco', async () => {
    const clientId = randomUUID()
    clientIdsToCleanup.push(clientId)

    await repository.create({ personId: 1, clientId, clientSecret: 'segredo-1' })
    await expect(repository.create({ personId: 2, clientId, clientSecret: 'segredo-2' })).rejects.toThrow()
  })

  it('recusa criação sem personId antes de tocar o banco', async () => {
    await expect(
      repository.create({ personId: undefined, clientId: randomUUID(), clientSecret: 'segredo' }),
    ).rejects.toBeInstanceOf(ApplicationError)
  })

  it('findById devolve a credencial com o clientSecret decifrado, e undefined para id inexistente', async () => {
    const clientId = randomUUID()
    clientIdsToCleanup.push(clientId)

    const created = await repository.create({ personId: 1, clientId, clientSecret: 'segredo-em-claro' })
    const found = await repository.findById(created.requireId())
    expect(found?.getClientSecret()).toBe('segredo-em-claro')

    expect(await repository.findById(999_999_999)).toBeUndefined()
  })

  it('findByPersonId devolve todas as credenciais da pessoa, e lista vazia sem nenhuma', async () => {
    const firstClientId = randomUUID()
    const secondClientId = randomUUID()
    clientIdsToCleanup.push(firstClientId, secondClientId)

    await repository.create({ personId: 42, clientId: firstClientId, clientSecret: 'segredo-1' })
    await repository.create({ personId: 42, clientId: secondClientId, clientSecret: 'segredo-2' })

    const found = await repository.findByPersonId(42)
    expect(found).toHaveLength(2)

    expect(await repository.findByPersonId(999_999_999)).toEqual([])
  })
})
