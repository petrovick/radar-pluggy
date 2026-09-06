import { createRequire } from 'node:module'
import { Sequelize, type QueryInterface } from 'sequelize'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { definePluggyCredentialItemModel } from '../../../../src/infra/db/models/pluggy-credential-item-model.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'

const require = createRequire(import.meta.url)
const migration = require('../../../../src/infra/db/migrations/20260901120100-criar-pluggy-credential-items.cjs') as {
  up: (queryInterface: QueryInterface, sequelizeLib: typeof Sequelize) => Promise<void>
}

describe('contrato: model factory de pluggy_connector_credential_items vs. migration real', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const queryInterface = sequelize.getQueryInterface()

  beforeAll(async () => {
    // Nome físico final leva o prefixo `pluggy_connector_` (modelagem-de-dados); a migration
    // original cria com o nome antigo, e a rename (20260903090000) leva ao nome final.
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('pluggy_connector_credential_items')) {
      if (!tables.includes('pluggy_credential_items')) {
        await queryInterface.sequelize.query('SET FOREIGN_KEY_CHECKS = 0')
        try {
          await migration.up(queryInterface, Sequelize)
        } finally {
          await queryInterface.sequelize.query('SET FOREIGN_KEY_CHECKS = 1')
        }
      }
      await queryInterface.renameTable('pluggy_credential_items', 'pluggy_connector_credential_items')
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('toda coluna da migration real tem uma coluna correspondente no model, e vice-versa', async () => {
    const realColumns = await queryInterface.describeTable('pluggy_connector_credential_items')
    const model = definePluggyCredentialItemModel(sequelize)

    expect(Object.keys(model.getAttributes()).sort()).toEqual(Object.keys(realColumns).sort())
  })

  it('allowNull do model bate com o allowNull real de cada coluna', async () => {
    const realColumns = await queryInterface.describeTable('pluggy_connector_credential_items')
    const model = definePluggyCredentialItemModel(sequelize)
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
