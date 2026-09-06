import { createRequire } from 'node:module'
import { Sequelize, type QueryInterface } from 'sequelize'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { definePluggyPositionModel } from '../../../../src/infra/db/models/pluggy-position-model.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'

const require = createRequire(import.meta.url)
const createMigration = require('../../../../src/infra/db/migrations/20260901130000-criar-pluggy-positions.cjs') as {
  up: (queryInterface: QueryInterface, sequelizeLib: typeof Sequelize) => Promise<void>
}
const alterMigration = require('../../../../src/infra/db/migrations/20260903110000-alterar-pluggy-connector-positions-precisao.cjs') as {
  up: (queryInterface: QueryInterface, sequelizeLib: typeof Sequelize) => Promise<void>
  down: (queryInterface: QueryInterface, sequelizeLib: typeof Sequelize) => Promise<void>
}

function createProxyQueryInterface(qi: QueryInterface, targetName: string, substituteName: string): QueryInterface {
  return new Proxy(qi, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver)
      if (typeof orig === 'function') {
        return (...args: unknown[]) => {
          const mappedArgs = args.map((arg) => (arg === targetName ? substituteName : arg))
          return orig.apply(target, mappedArgs)
        }
      }
      return orig
    },
  })
}

describe('contrato: model factory de pluggy_connector_positions vs. migration real', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const queryInterface = sequelize.getQueryInterface()

  beforeAll(async () => {
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('pluggy_connector_positions')) {
      if (!tables.includes('pluggy_positions')) {
        await createMigration.up(queryInterface, Sequelize)
      }
      await queryInterface.renameTable('pluggy_positions', 'pluggy_connector_positions')
    }
    const cols = await queryInterface.describeTable('pluggy_connector_positions')
    if (!cols.value) {
      await alterMigration.up(queryInterface, Sequelize)
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('toda coluna da migration real tem uma coluna correspondente no model, e vice-versa', async () => {
    const realColumns = await queryInterface.describeTable('pluggy_connector_positions')
    const model = definePluggyPositionModel(sequelize)

    expect(Object.keys(model.getAttributes()).sort()).toEqual(Object.keys(realColumns).sort())
  })

  it('allowNull do model bate com o allowNull real de cada coluna', async () => {
    const realColumns = await queryInterface.describeTable('pluggy_connector_positions')
    const model = definePluggyPositionModel(sequelize)
    const attributes: Record<string, { allowNull?: boolean } | undefined> = model.getAttributes()

    for (const [column, definition] of Object.entries(realColumns)) {
      const attribute = attributes[column]
      expect(attribute, `coluna ${column} existe na migration mas não no model`).toBeDefined()
      expect(attribute?.allowNull, `allowNull de ${column} diverge entre model e migration`).toBe(
        definition.allowNull,
      )
    }
  })

  it('down da migration de precisão reverte colunas adicionadas e restaura tipos anteriores', async () => {
    const testTableName = 'test_alter_pluggy_positions'
    const tables = await queryInterface.showAllTables()
    if (tables.includes(testTableName)) {
      await queryInterface.dropTable(testTableName)
    }

    const initQI = createProxyQueryInterface(queryInterface, 'pluggy_positions', testTableName)
    await createMigration.up(initQI, Sequelize)

    const proxyQI = createProxyQueryInterface(queryInterface, 'pluggy_connector_positions', testTableName)
    await alterMigration.up(proxyQI, Sequelize)
    let cols = await queryInterface.describeTable(testTableName)
    expect(cols.value).toBeDefined()
    expect(cols.amount).toBeDefined()

    await alterMigration.down(proxyQI, Sequelize)
    cols = await queryInterface.describeTable(testTableName)
    expect(cols.value).toBeUndefined()
    expect(cols.amount).toBeUndefined()
    expect(cols.taxes).toBeUndefined()
    expect(cols.taxes2).toBeUndefined()

    await queryInterface.dropTable(testTableName)
  })
})
