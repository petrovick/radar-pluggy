import { beforeAll, describe, expect, it } from 'vitest'
import { definePersonModel } from '../../../../src/infra/db/models/person-model.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'
import { ensureTestPeopleFixture } from '../../../support/test-people-fixture.js'

// Diferente dos outros testes de contrato: este repositório não é dono de `people`
// (fronteira-pluggy regra 13) — nunca cria, dropa ou migra essa tabela. O contrato aqui é mais
// fraco de propósito: confere que as colunas que este serviço DECLAROU (id, username) existem de
// verdade na tabela real e com o allowNull esperado — nunca que o model espelha o schema inteiro.
describe('contrato: model factory de people (leitura, não dono) vs. tabela real', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const queryInterface = sequelize.getQueryInterface()

  beforeAll(async () => {
    await ensureTestPeopleFixture(queryInterface)
  })

  it('id e username declarados pelo model existem na tabela real, com o allowNull esperado', async () => {
    const realColumns = await queryInterface.describeTable('people')
    const model = definePersonModel(sequelize)
    const attributes: Record<string, { allowNull?: boolean } | undefined> = model.getAttributes()

    for (const [column, attribute] of Object.entries(attributes)) {
      const real = realColumns[column]
      expect(real, `coluna ${column} declarada no model não existe em people`).toBeDefined()
      expect(attribute?.allowNull, `allowNull de ${column} diverge entre model e tabela real`).toBe(
        real?.allowNull,
      )
    }

    await sequelize.close()
  })
})
