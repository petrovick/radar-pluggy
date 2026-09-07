import { createRequire } from 'node:module'
import { Sequelize, type QueryInterface } from 'sequelize'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { definePluggySyncProgressModel } from '../../../../src/infra/db/models/pluggy-sync-progress-model.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'

const require = createRequire(import.meta.url)
const migration = require('../../../../src/infra/db/migrations/20260907100400-criar-radar-pluggy-sync-progress.cjs') as {
  up: (queryInterface: QueryInterface, sequelizeLib: typeof Sequelize) => Promise<void>
  down: (queryInterface: QueryInterface, sequelizeLib: typeof Sequelize) => Promise<void>
}

// Esta migration mexe em DOIS nomes de tabela (cria `radar_pluggy_sync_progress`, remove
// `radar_pluggy_history_sync_states`) — o proxy substitui os dois por nomes descartáveis, para o
// teste de round-trip não tocar as tabelas reais.
function createProxyQueryInterface(qi: QueryInterface, substitutions: Record<string, string>): QueryInterface {
  return new Proxy(qi, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver)
      if (typeof orig === 'function') {
        return (...args: unknown[]) => {
          const mappedArgs = args.map((arg) => (typeof arg === 'string' && substitutions[arg] ? substitutions[arg] : arg))
          return orig.apply(target, mappedArgs)
        }
      }
      return orig
    },
  })
}

describe('contrato: model factory de radar_pluggy_sync_progress vs. migration real', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const queryInterface = sequelize.getQueryInterface()

  beforeAll(async () => {
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('radar_pluggy_sync_progress')) {
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
    const realColumns = await queryInterface.describeTable('radar_pluggy_sync_progress')
    const model = definePluggySyncProgressModel(sequelize)

    expect(Object.keys(model.getAttributes()).sort()).toEqual(Object.keys(realColumns).sort())
  })

  it('allowNull do model bate com o allowNull real de cada coluna', async () => {
    const realColumns = await queryInterface.describeTable('radar_pluggy_sync_progress')
    const model = definePluggySyncProgressModel(sequelize)
    const attributes: Record<string, { allowNull?: boolean } | undefined> = model.getAttributes()

    for (const [column, definition] of Object.entries(realColumns)) {
      const attribute = attributes[column]
      expect(attribute, `coluna ${column} existe na migration mas não no model`).toBeDefined()
      expect(attribute?.allowNull, `allowNull de ${column} diverge entre model e migration`).toBe(
        definition.allowNull,
      )
    }
  })

  it('down da migration desfaz o índice único e remove a tabela, sem tocar as tabelas reais', async () => {
    const testSyncProgressName = 'test_down_sync_progress'
    const testHistorySyncStatesName = 'test_down_history_sync_states_recreated'

    for (const name of [testSyncProgressName, testHistorySyncStatesName]) {
      const tables = await queryInterface.showAllTables()
      if (tables.includes(name)) {
        await queryInterface.dropTable(name)
      }
    }

    const proxyQI = createProxyQueryInterface(queryInterface, {
      radar_pluggy_sync_progress: testSyncProgressName,
      radar_pluggy_history_sync_states: testHistorySyncStatesName,
    })

    await migration.up(proxyQI, Sequelize)
    const tablesAfterUp = await queryInterface.showAllTables()
    expect(tablesAfterUp).toContain(testSyncProgressName)
    expect(tablesAfterUp).not.toContain(testHistorySyncStatesName)

    await migration.down(proxyQI, Sequelize)
    const tablesAfterDown = await queryInterface.showAllTables()
    expect(tablesAfterDown).not.toContain(testSyncProgressName)
    expect(tablesAfterDown).toContain(testHistorySyncStatesName)

    await queryInterface.dropTable(testHistorySyncStatesName)
  })
})
