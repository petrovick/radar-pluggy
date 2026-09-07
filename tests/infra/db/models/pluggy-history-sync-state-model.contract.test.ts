import { createRequire } from 'node:module'
import { Sequelize, type QueryInterface } from 'sequelize'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { definePluggyHistorySyncStateModel } from '../../../../src/infra/db/models/pluggy-history-sync-state-model.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'

const require = createRequire(import.meta.url)
const migration = require('../../../../src/infra/db/migrations/20260903160000-criar-pluggy-connector-history-sync-states.cjs') as {
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

describe('contrato: model factory de radar_pluggy_history_sync_states vs. migration real', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const queryInterface = sequelize.getQueryInterface()

  beforeAll(async () => {
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('radar_pluggy_history_sync_states')) {
      try {
        await migration.up(queryInterface, Sequelize)
      } catch {
        // Ignora corrida paralela
      }
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('toda coluna da migration real tem uma coluna correspondente no model, e vice-versa', async () => {
    const realColumns = await queryInterface.describeTable('radar_pluggy_history_sync_states')
    const model = definePluggyHistorySyncStateModel(sequelize)

    expect(Object.keys(model.getAttributes()).sort()).toEqual(Object.keys(realColumns).sort())
  })

  it('allowNull do model bate com o allowNull real de cada coluna', async () => {
    const realColumns = await queryInterface.describeTable('radar_pluggy_history_sync_states')
    const model = definePluggyHistorySyncStateModel(sequelize)
    const attributes: Record<string, { allowNull?: boolean } | undefined> = model.getAttributes()

    for (const [column, definition] of Object.entries(realColumns)) {
      const attribute = attributes[column]
      expect(attribute, `coluna ${column} existe na migration mas não no model`).toBeDefined()
      expect(attribute?.allowNull, `allowNull de ${column} diverge entre model e migration`).toBe(
        definition.allowNull,
      )
    }
  })

  it('down da migration desfaz índices e remove a tabela', async () => {
    const testTableName = 'test_down_sync_states'
    const tables = await queryInterface.showAllTables()
    if (tables.includes(testTableName)) {
      await queryInterface.dropTable(testTableName)
    }

    const proxyQI = createProxyQueryInterface(queryInterface, 'pluggy_connector_history_sync_states', testTableName)

    await migration.up(proxyQI, Sequelize)
    const tablesAfterUp = await queryInterface.showAllTables()
    expect(tablesAfterUp).toContain(testTableName)

    await migration.down(proxyQI, Sequelize)
    const tablesAfterDown = await queryInterface.showAllTables()
    expect(tablesAfterDown).not.toContain(testTableName)
  })
})
