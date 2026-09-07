import { createRequire } from 'node:module'
import { Sequelize, type QueryInterface } from 'sequelize'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { definePluggyCredentialModel } from '../../../../src/infra/db/models/pluggy-credential-model.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'

const require = createRequire(import.meta.url)
const migration = require('../../../../src/infra/db/migrations/20260901120000-criar-pluggy-credentials.cjs') as {
  up: (queryInterface: QueryInterface, sequelizeLib: typeof Sequelize) => Promise<void>
}
const webhookMigration = require('../../../../src/infra/db/migrations/20260903170000-adicionar-webhook-em-pluggy-connector-credentials.cjs') as {
  up: (queryInterface: QueryInterface, sequelizeLib: typeof Sequelize) => Promise<void>
}

describe('contrato: model factory de radar_pluggy_credentials vs. migration real', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const queryInterface = sequelize.getQueryInterface()

  beforeAll(async () => {
    // Nome físico final leva o prefixo `radar_pluggy_` (modelagem-de-dados); a migration
    // original cria com o nome antigo, e a rename (20260903090000) leva ao nome final.
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('radar_pluggy_credentials')) {
      if (!tables.includes('pluggy_credentials')) {
        await migration.up(queryInterface, Sequelize)
      }
      await queryInterface.renameTable('pluggy_credentials', 'radar_pluggy_credentials')
    }
    const cols = await queryInterface.describeTable('radar_pluggy_credentials')
    if (!cols.webhook_secret) {
      await webhookMigration.up(queryInterface, Sequelize)
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('toda coluna da migration real tem uma coluna correspondente no model, e vice-versa', async () => {
    const realColumns = await queryInterface.describeTable('radar_pluggy_credentials')
    const model = definePluggyCredentialModel(sequelize)

    expect(Object.keys(model.getAttributes()).sort()).toEqual(Object.keys(realColumns).sort())
  })

  it('allowNull do model bate com o allowNull real de cada coluna', async () => {
    const realColumns = await queryInterface.describeTable('radar_pluggy_credentials')
    const model = definePluggyCredentialModel(sequelize)
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
