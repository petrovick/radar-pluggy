import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { definePluggyLoanModel } from '../../../src/infra/db/models/pluggy-loan-model.js'
import { PluggyLoanRep } from '../../../src/adapters/repositories/pluggy-loan.rep.js'
import { createDatabaseConnection } from '../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../support/test-database-config.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

// Requer MySQL alcançável (MYSQL_HOST etc.), mesma infraestrutura do teste de contrato.
describe('PluggyLoanRep.save', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const model = definePluggyLoanModel(sequelize)
  const repository = new PluggyLoanRep({
    db: { models: { pluggyLoan: model } },
    getTransaction: () => null,
  } as unknown as AppContainer)
  const loanIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('pluggy_connector_loans')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const migration = require('../../../src/infra/db/migrations/20260905100000-criar-pluggy-connector-loans.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await migration.up(queryInterface, Sequelize)
    }
  })

  afterEach(async () => {
    const loanId = loanIdsToCleanup.pop()
    if (loanId !== undefined) {
      await model.destroy({ where: { loan_id: loanId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  function baseInput(loanId: string, itemId: string) {
    return {
      loanId,
      itemId,
      contractNumber: undefined,
      productName: 'Crédito Pessoal',
      type: undefined,
      kind: 'LOAN',
      collectedAt: undefined,
      contractDate: undefined,
      settlementDate: undefined,
      contractAmount: undefined,
      currencyCode: 'BRL',
      dueDate: undefined,
      totalInstallments: undefined,
      paidInstallments: undefined,
      dueInstallments: undefined,
      pastDueInstallments: undefined,
      outstandingBalance: undefined,
    }
  }

  it('duas sincronizações do mesmo empréstimo atualizam a mesma linha, nunca criam uma segunda', async () => {
    const loanId = randomUUID()
    const itemId = randomUUID()
    loanIdsToCleanup.push(loanId)

    await repository.save(baseInput(loanId, itemId))
    await repository.save({ ...baseInput(loanId, itemId), outstandingBalance: new Decimal('2000.00') })

    const rows = await model.findAll({ where: { loan_id: loanId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.get('outstanding_balance')).toBe('2000.00')
  })

  it('mantém precisão decimal no round-trip', async () => {
    const loanId = randomUUID()
    const itemId = randomUUID()
    loanIdsToCleanup.push(loanId)

    const saved = await repository.save({
      ...baseInput(loanId, itemId),
      contractAmount: new Decimal('10000.50'),
      outstandingBalance: new Decimal('8000.25'),
    })
    expect(saved.getContractAmount()).toEqual(new Decimal('10000.50'))
    expect(saved.getOutstandingBalance()).toEqual(new Decimal('8000.25'))
  })

  it('grava installments/outstandingBalance na fotografia', async () => {
    const loanId = randomUUID()
    const itemId = randomUUID()
    loanIdsToCleanup.push(loanId)

    await repository.save({
      ...baseInput(loanId, itemId),
      totalInstallments: 24,
      paidInstallments: 5,
      dueInstallments: 19,
      pastDueInstallments: 0,
      outstandingBalance: new Decimal('8000.00'),
    })

    const row = await model.findOne({ where: { loan_id: loanId } })
    expect(row?.get('total_installments')).toBe(24)
    expect(row?.get('paid_installments')).toBe(5)
    expect(row?.get('due_installments')).toBe(19)
    expect(row?.get('past_due_installments')).toBe(0)
    expect(row?.get('outstanding_balance')).toBe('8000.00')
  })

  it('campo financeiro opcional ausente fica NULL, nunca zero', async () => {
    const loanId = randomUUID()
    const itemId = randomUUID()
    loanIdsToCleanup.push(loanId)

    await repository.save(baseInput(loanId, itemId))

    const row = await model.findOne({ where: { loan_id: loanId } })
    expect(row?.get('contract_amount')).toBeNull()
    expect(row?.get('outstanding_balance')).toBeNull()
    expect(row?.get('total_installments')).toBeNull()
  })

  it('recusa gravação sem productName antes de tocar o banco', async () => {
    await expect(
      repository.save({ ...baseInput(randomUUID(), 'item-x'), productName: '' }),
    ).rejects.toBeInstanceOf(ApplicationError)
  })
})
