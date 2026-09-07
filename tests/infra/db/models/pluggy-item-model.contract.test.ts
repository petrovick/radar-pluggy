import { createRequire } from 'node:module'
import { Sequelize, type QueryInterface } from 'sequelize'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { definePluggyItemModel } from '../../../../src/infra/db/models/pluggy-item-model.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'

// Requer MySQL alcançável (MYSQL_HOST etc.) — mesmo banco físico da migration real, provisionado
// em CI (.github/workflows/ci.yml) e localmente pelo container `shared-services-mysql-1`.
const require = createRequire(import.meta.url)
const migration = require('../../../../src/infra/db/migrations/20260901105321-criar-pluggy-items.cjs') as {
  up: (queryInterface: QueryInterface, sequelizeLib: typeof Sequelize) => Promise<void>
}

describe('contrato: model factory de radar_pluggy_items vs. migration real', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const queryInterface = sequelize.getQueryInterface()

  beforeAll(async () => {
    // Só cria/renomeia a tabela se ela ainda não existir com o nome final (CI parte de banco vazio;
    // localmente a tabela já foi criada e renomeada) — o teste nunca dropa a tabela de um ambiente
    // de desenvolvimento. O nome físico leva o prefixo `radar_pluggy_` (modelagem-de-dados); a
    // migration original cria com o nome antigo, e a rename (20260903090000) leva ao nome final.
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('radar_pluggy_items')) {
      if (!tables.includes('pluggy_items')) {
        await migration.up(queryInterface, Sequelize)
      }
      await queryInterface.renameTable('pluggy_items', 'radar_pluggy_items')
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('toda coluna da migration real tem uma coluna correspondente no model, e vice-versa', async () => {
    const realColumns = await queryInterface.describeTable('radar_pluggy_items')
    const model = definePluggyItemModel(sequelize)

    expect(Object.keys(model.getAttributes()).sort()).toEqual(Object.keys(realColumns).sort())
  })

  it('allowNull do model bate com o allowNull real de cada coluna', async () => {
    const realColumns = await queryInterface.describeTable('radar_pluggy_items')
    const model = definePluggyItemModel(sequelize)
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
