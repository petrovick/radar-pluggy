import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import ReadPluggyPositionImpl from '../../../../src/adapters/gateways/pluggy-position/read-pluggy-position.impl.js'
import { PluggyPositionRep } from '../../../../src/adapters/repositories/pluggy-position.rep.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'
import { definePluggyPositionModel } from '../../../../src/infra/db/models/pluggy-position-model.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'

// Prova a tradução entidade → DTO HTTP: escala decimal fixa (não `Decimal.toString()`, que
// suprimiria zero à direita) e campo ausente vira `null`, nunca `undefined` (a resposta é JSON).
// A resolução pessoa→item já tem cobertura própria (`pluggy-person-item.resolver.test.ts`); aqui o
// resolver é um fake só devolvendo os itemIds fixos que o teste seeda.
describe('ReadPluggyPositionImpl.readPositionsByItemIds', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyPositionModel(sequelize)

  const container = {
    db: { models: { pluggyPosition: model } },
    getTransaction: () => null,
    logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as AppContainer
  const mutable = container as unknown as Record<string, unknown>
  const connectorNamesByItem = new Map<string, string>()
  mutable.pluggyPositionRep = new PluggyPositionRep(container)
  mutable.pluggyPersonItemResolver = { itemIdsFor: async () => [] }
  mutable.pluggyCredentialItemRep = {
    findConnectorNamesByItemIds: async (ids: string[]) => {
      const result = new Map<string, string>()
      for (const id of ids) {
        const name = connectorNamesByItem.get(id)
        if (name) result.set(id, name)
      }
      return result
    },
  }

  const impl = new ReadPluggyPositionImpl(container)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('radar_pluggy_positions')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const createMigration = require('../../../../src/infra/db/migrations/20260901130000-criar-pluggy-positions.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await createMigration.up(queryInterface, Sequelize)
      await queryInterface.renameTable('pluggy_positions', 'radar_pluggy_positions')
    }
    const cols = await queryInterface.describeTable('radar_pluggy_positions')
    if (!cols.value) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const alterMigration = require('../../../../src/infra/db/migrations/20260903110000-alterar-pluggy-connector-positions-precisao.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await alterMigration.up(queryInterface, Sequelize)
    }
    const colsAfterFullCapture = await queryInterface.describeTable('radar_pluggy_positions')
    if (!colsAfterFullCapture.due_date) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const fullCaptureMigration = require('../../../../src/infra/db/migrations/20260906180000-adicionar-campos-completos-em-pluggy-connector-positions.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await fullCaptureMigration.up(queryInterface, Sequelize)
    }
  })

  afterEach(async () => {
    connectorNamesByItem.clear()
    const itemId = itemIdsToCleanup.pop()
    if (itemId !== undefined) {
      await model.destroy({ where: { item_id: itemId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  function buildPositionInput(overrides: Partial<Parameters<PluggyPositionRep['save']>[0]> = {}) {
    return {
      investmentId: randomUUID(),
      itemId: randomUUID(),
      type: 'EQUITY',
      subtype: undefined,
      name: 'Exemplo',
      code: undefined,
      isin: undefined,
      currencyCode: 'BRL',
      balance: new Decimal('100'),
      quantity: undefined,
      amountOriginal: undefined,
      value: undefined,
      amount: undefined,
      taxes: undefined,
      taxes2: undefined,
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
      ...overrides,
    }
  }

  it('formata decimal com a escala da coluna e data em ISO, quotaDate é string obrigatória, campos ausentes viram null', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)
    connectorNamesByItem.set(itemId, 'BTGPactual Investimentos')

    const rep = new PluggyPositionRep(container)
    await rep.save(
      buildPositionInput({
        investmentId,
        itemId,
        type: 'EQUITY',
        subtype: 'STOCK',
        name: 'SAPR4',
        code: 'SAPR4',
        isin: 'BRSAPRACNPR6',
        currencyCode: 'BRL',
        balance: new Decimal('1500.5'),
        quantity: new Decimal('10'),
        status: 'ACTIVE',
        amountWithdrawal: new Decimal('1500.5'),
        purchaseDate: new Date('2024-01-01T00:00:00.000Z'),
      }),
    )

    const [view] = await impl.readPositionsByItemIds([itemId])
    expect(view).toBeDefined()
    if (!view) return

    expect(view).toMatchObject({
      investmentId,
      type: 'EQUITY',
      subtype: 'STOCK',
      name: 'SAPR4',
      code: 'SAPR4',
      isin: 'BRSAPRACNPR6',
      currencyCode: 'BRL',
      balance: '1500.50',
      quantity: '10.00000000',
      value: null,
      amountOriginal: null,
      amount: null,
      taxes: null,
      taxes2: null,
      amountWithdrawal: '1500.50',
      amountProfit: null,
      status: 'ACTIVE',
      quotaDate: '2026-08-01T00:00:00.000Z',
      dueDate: null,
      issueDate: null,
      purchaseDate: '2024-01-01T00:00:00.000Z',
      issuer: null,
      issuerCnpj: null,
      rate: null,
      rateType: null,
      fixedAnnualRate: null,
      lastMonthRate: null,
      annualRate: null,
      lastTwelveMonthsRate: null,
      institutionName: null,
      institutionNumber: null,
      sourceInstitutionName: 'BTGPactual Investimentos',
      number: null,
      owner: null,
      metadata: null,
    })
    expect(typeof view.quotaDate).toBe('string')
  })

  it('preserva estritamente institutionName, sourceInstitutionName e issuer como conceitos independentes sem sobrescrita', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)
    connectorNamesByItem.set(itemId, 'BTGPactual Investimentos')

    const rep = new PluggyPositionRep(container)
    await rep.save(
      buildPositionInput({
        investmentId,
        itemId,
        type: 'FIXED_INCOME',
        subtype: 'CDB',
        name: 'CDB - BANCO PINE S/A',
        code: 'CDB1266VXHA',
        balance: new Decimal('7503.99'),
        quantity: new Decimal('7'),
        value: new Decimal('1089.99714286'),
        amountOriginal: new Decimal('7000.00'),
        amount: new Decimal('7629.98'),
        taxes: new Decimal('125.99'),
        taxes2: new Decimal('0.00'),
        status: 'ACTIVE',
        quotaDate: new Date('2026-09-07T03:00:00.000Z'),
        issuerCnpj: '62.144.175/0001-20',
        amountWithdrawal: new Decimal('7503.99'),
        dueDate: new Date('2030-01-21T06:00:00.000Z'),
        issuer: 'BANCO PINE S/A',
        issueDate: new Date('2026-01-19T06:00:00.000Z'),
        purchaseDate: new Date('2026-01-19T06:00:00.000Z'),
        rate: new Decimal('100.00'),
        rateType: 'IPCA',
        fixedAnnualRate: new Decimal('8.90'),
      }),
    )

    const [view] = await impl.readPositionsByItemIds([itemId])
    expect(view).toBeDefined()
    if (!view) return

    expect(view.institutionName).toBeNull()
    expect(view.sourceInstitutionName).toBe('BTGPactual Investimentos')
    expect(view.issuer).toBe('BANCO PINE S/A')
    expect(view.rate).toBe('100.00000000')
    expect(view.rateType).toBe('IPCA')
    expect(view.fixedAnnualRate).toBe('8.90000000')
    expect(view.amountOriginal).toBe('7000.00')
    expect(view.amount).toBe('7629.98')
    expect(view.taxes).toBe('125.99')
    expect(view.taxes2).toBe('0.00')
    expect(view.issuerCnpj).toBe('62.144.175/0001-20')
  })

  it('devolve sourceInstitutionName como null quando conector não é encontrado no mapa', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const rep = new PluggyPositionRep(container)
    await rep.save(
      buildPositionInput({
        investmentId,
        itemId,
        type: 'MUTUAL_FUND',
        subtype: 'INVESTMENT_FUND',
        name: 'Fundo Exemplo',
        balance: new Decimal('500.00'),
        quotaDate: new Date('2026-09-07T03:00:00.000Z'),
      }),
    )

    const [view] = await impl.readPositionsByItemIds([itemId])
    expect(view).toBeDefined()
    if (!view) return

    expect(view.sourceInstitutionName).toBeNull()
  })
})

