import { createRequire } from 'node:module'
import { Sequelize, type QueryInterface } from 'sequelize'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { definePluggyLoanModel } from '../../../../src/infra/db/models/pluggy-loan-model.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'

// Requer MySQL alcançável (MYSQL_HOST etc.) — mesmo banco físico da migration real.
const require = createRequire(import.meta.url)
const migration = require('../../../../src/infra/db/migrations/20260905100000-criar-pluggy-connector-loans.cjs') as {
  up: (queryInterface: QueryInterface, sequelizeLib: typeof Sequelize) => Promise<void>
}
const fullCaptureMigration = require('../../../../src/infra/db/migrations/20260906180400-adicionar-campos-completos-em-pluggy-connector-loans.cjs') as {
  up: (queryInterface: QueryInterface, sequelizeLib: typeof Sequelize) => Promise<void>
}

describe('contrato: model factory de pluggy_connector_loans vs. migration real', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const queryInterface = sequelize.getQueryInterface()

  beforeAll(async () => {
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('pluggy_connector_loans')) {
      await migration.up(queryInterface, Sequelize)
    }
    const cols = await queryInterface.describeTable('pluggy_connector_loans')
    if (!cols.ipoc_code) {
      await fullCaptureMigration.up(queryInterface, Sequelize)
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('toda coluna da migration real tem uma coluna correspondente no model, e vice-versa', async () => {
    const realColumns = await queryInterface.describeTable('pluggy_connector_loans')
    const model = definePluggyLoanModel(sequelize)

    expect(Object.keys(model.getAttributes()).sort()).toEqual(Object.keys(realColumns).sort())
  })

  it('allowNull do model bate com o allowNull real de cada coluna', async () => {
    const realColumns = await queryInterface.describeTable('pluggy_connector_loans')
    const model = definePluggyLoanModel(sequelize)
    const attributes: Record<string, { allowNull?: boolean } | undefined> = model.getAttributes()

    for (const [column, definition] of Object.entries(realColumns)) {
      const attribute = attributes[column]
      expect(attribute, `coluna ${column} existe na migration mas não no model`).toBeDefined()
      expect(attribute?.allowNull, `allowNull de ${column} diverge entre model e migration`).toBe(
        definition.allowNull,
      )
    }
  })
})
