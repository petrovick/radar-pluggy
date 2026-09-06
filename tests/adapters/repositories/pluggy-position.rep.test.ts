import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { definePluggyPositionModel } from '../../../src/infra/db/models/pluggy-position-model.js'
import { PluggyPositionRep } from '../../../src/adapters/repositories/pluggy-position.rep.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

describe('PluggyPositionRep.save', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyPositionModel(sequelize)
  // Formato do container (registro por chave + transação lida do escopo): fora de uma unidade de
  // trabalho não há transação vigente, então `getTransaction` devolve null e cada escrita comita só.
  const repository = new PluggyPositionRep({
    db: { models: { pluggyPosition: model } },
    getTransaction: () => null,
  } as unknown as AppContainer)
  const itemIdsToCleanup: string[] = []

  afterEach(async () => {
    const itemId = itemIdsToCleanup.pop()
    if (itemId !== undefined) {
      await model.destroy({ where: { item_id: itemId } })
    }
  })

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('pluggy_connector_positions')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const createMigration = require('../../../src/infra/db/migrations/20260901130000-criar-pluggy-positions.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await createMigration.up(queryInterface, Sequelize)
      await queryInterface.renameTable('pluggy_positions', 'pluggy_connector_positions')
    }
    const cols = await queryInterface.describeTable('pluggy_connector_positions')
    if (!cols.value) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const alterMigration = require('../../../src/infra/db/migrations/20260903110000-alterar-pluggy-connector-positions-precisao.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await alterMigration.up(queryInterface, Sequelize)
    }
    const colsAfterFullCapture = await queryInterface.describeTable('pluggy_connector_positions')
    if (!colsAfterFullCapture.due_date) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const fullCaptureMigration = require('../../../src/infra/db/migrations/20260906180000-adicionar-campos-completos-em-pluggy-connector-positions.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await fullCaptureMigration.up(queryInterface, Sequelize)
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  function baseInput(itemId: string, investmentId: string) {
    return {
      investmentId,
      itemId,
      type: 'MUTUAL_FUND',
      subtype: undefined,
      name: 'Fundo XYZ',
      code: undefined,
      isin: undefined,
      currencyCode: 'BRL',
      balance: new Decimal('1359.39'),
      quantity: undefined,
      amountOriginal: undefined,
      status: undefined,
      institutionName: undefined,
      institutionNumber: undefined,
      quotaDate: new Date('2026-08-01T00:00:00.000Z'),
      issuerCnpj: undefined,
      number: undefined,
      amountWithdrawal: undefined,
      amountProfit: undefined,
      dueDate: undefined,
      issuer: undefined,
      issueDate: undefined,
      purchaseDate: undefined,
      rate: undefined,
      rateType: undefined,
      fixedAnnualRate: undefined,
      lastMonthRate: undefined,
      annualRate: undefined,
      lastTwelveMonthsRate: undefined,
      owner: undefined,
      metadata: undefined,
    }
  }

  it('duas sincronizações do mesmo investimento atualizam a mesma linha, nunca criam uma segunda', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save(baseInput(itemId, investmentId))
    await repository.save({ ...baseInput(itemId, investmentId), balance: new Decimal('2000.00') })

    const rows = await model.findAll({ where: { item_id: itemId, investment_id: investmentId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.get('balance')).toBe('2000.00')
  })

  it('mantém precisão decimal no round-trip', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const saved = await repository.save({
      ...baseInput(itemId, investmentId),
      balance: new Decimal('1359.39'),
      quantity: new Decimal('3.00000001'),
    })
    expect(saved.getBalance()).toEqual(new Decimal('1359.39'))
    expect(saved.getQuantity()).toEqual(new Decimal('3.00000001'))
  })

  // Regressão: a migration criou as colunas e o gateway extrai os campos, mas o repositório não os
  // gravava — as 4 colunas ficavam NULL para sempre (task 1.3 do change, requisito MODIFIED do spec
  // pluggy-position-sync). O teste lê a LINHA PERSISTIDA, não a entidade devolvida: a entidade
  // carrega o valor de entrada mesmo quando `toRow` o descarta.
  it('grava value/amount/taxes/taxes2 na fotografia, com a precisão de cada coluna', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save({
      ...baseInput(itemId, investmentId),
      quantity: new Decimal('68448.37946508'),
      value: new Decimal('1082.92666667'),
      amount: new Decimal('304.50'),
      taxes: new Decimal('1.25'),
      taxes2: new Decimal('0.50'),
    })

    const row = await model.findOne({ where: { item_id: itemId, investment_id: investmentId } })
    expect(row?.get('value')).toBe('1082.92666667')
    expect(row?.get('amount')).toBe('304.50')
    expect(row?.get('taxes')).toBe('1.25')
    expect(row?.get('taxes2')).toBe('0.50')
    expect(row?.get('quantity')).toBe('68448.37946508')
  })

  it('campo financeiro opcional ausente fica NULL, nunca zero', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save(baseInput(itemId, investmentId))

    const row = await model.findOne({ where: { item_id: itemId, investment_id: investmentId } })
    expect(row?.get('value')).toBeNull()
    expect(row?.get('amount')).toBeNull()
    expect(row?.get('taxes')).toBeNull()
    expect(row?.get('taxes2')).toBeNull()
  })

  // Change pluggy-complete-data-capture, spec pluggy-position-sync: campos antes descartados no
  // gateway agora chegam até a linha persistida.
  it('grava vencimento, taxa e rentabilidade de renda fixa, com a precisão de cada coluna', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save({
      ...baseInput(itemId, investmentId),
      dueDate: new Date('2028-01-01T00:00:00.000Z'),
      rate: new Decimal('100.5'),
      rateType: 'CDI',
      amountProfit: new Decimal('42.10'),
      issuer: 'Banco XYZ',
    })

    const row = await model.findOne({ where: { item_id: itemId, investment_id: investmentId } })
    expect(row?.get('due_date')).toEqual(new Date('2028-01-01T00:00:00.000Z'))
    expect(row?.get('rate')).toBe('100.50000000')
    expect(row?.get('rate_type')).toBe('CDI')
    expect(row?.get('amount_profit')).toBe('42.10')
    expect(row?.get('issuer')).toBe('Banco XYZ')
  })

  it('campo de captura completa ausente fica NULL, nunca inventado', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    await repository.save(baseInput(itemId, investmentId))

    const row = await model.findOne({ where: { item_id: itemId, investment_id: investmentId } })
    expect(row?.get('due_date')).toBeNull()
    expect(row?.get('rate')).toBeNull()
    expect(row?.get('amount_profit')).toBeNull()
  })

  it('recusa gravação sem investmentId antes de tocar o banco', async () => {
    await expect(
      repository.save({ ...baseInput('item-x', ''), investmentId: '' }),
    ).rejects.toBeInstanceOf(ApplicationError)
  })
})
