import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { definePersonModel } from '../../../src/infra/db/models/person-model.js'
import { PersonRep } from '../../../src/adapters/repositories/person.rep.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import { ensureTestPeopleFixture } from '../../support/test-people-fixture.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'

// Read-only: este teste nunca cria, atualiza nem apaga uma linha de `people` (fronteira-pluggy
// regra 13) — só lê uma linha já existente pra provar o comportamento real, sem depender de um
// username fixo hardcoded (o dado é de outro dono).
describe('PersonRep.findIdByUsername', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePersonModel(sequelize)
  const repository = new PersonRep({
    db: { models: { person: model } },
    getTransaction: () => null,
  } as unknown as AppContainer)

  beforeAll(async () => {
    await ensureTestPeopleFixture(sequelize.getQueryInterface())
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('resolve o id de um username que existe de verdade em people', async () => {
    const existing = await model.findOne()
    expect(existing, 'people precisa ter ao menos uma linha para este teste rodar').toBeDefined()

    const row = existing!.get()
    await expect(repository.findIdByUsername(row.username)).resolves.toBe(row.id)
  })

  it('devolve undefined para um username que não existe', async () => {
    await expect(repository.findIdByUsername(`username-inexistente-${randomUUID()}`)).resolves.toBeUndefined()
  })
})
