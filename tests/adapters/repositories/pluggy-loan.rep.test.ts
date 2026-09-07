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
    if (!tables.includes('radar_pluggy_loans')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const migration = require('../../../src/infra/db/migrations/20260905100000-criar-pluggy-connector-loans.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await migration.up(queryInterface, Sequelize)
    }
    const cols = await queryInterface.describeTable('radar_pluggy_loans')
    if (!cols.ipoc_code) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const fullCaptureMigration = require('../../../src/infra/db/migrations/20260906180400-adicionar-campos-completos-em-pluggy-connector-loans.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await fullCaptureMigration.up(queryInterface, Sequelize)
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
      ipocCode: undefined,
      disbursementDates: undefined,
      firstInstallmentDueDate: undefined,
      cet: undefined,
      installmentPeriodicity: undefined,
      installmentPeriodicityAdditionalInfo: undefined,
      amortizationScheduled: undefined,
      amortizationScheduledAdditionalInfo: undefined,
      cnpjConsignee: undefined,
      interestRates: undefined,
      contractedFees: undefined,
      contractedFinanceCharges: undefined,
      warranties: undefined,
      installments: undefined,
      payments: undefined,
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

  // Change pluggy-complete-data-capture, spec pluggy-loan: schema completo do contrato, revertendo
  // o corte antes documentado no gateway.
  it('grava schema completo do contrato, com listas e objetos aninhados', async () => {
    const loanId = randomUUID()
    const itemId = randomUUID()
    loanIdsToCleanup.push(loanId)

    await repository.save({
      ...baseInput(loanId, itemId),
      ipocCode: 'IPOC-123',
      disbursementDates: [new Date('2026-01-01T00:00:00.000Z')],
      firstInstallmentDueDate: new Date('2026-02-01T00:00:00.000Z'),
      cet: new Decimal('15.5'),
      installmentPeriodicity: 'MONTHLY',
      amortizationScheduled: 'SAC',
      cnpjConsignee: '12.345.678/0001-00',
      interestRates: [{ taxType: 'NOMINAL', preFixedRate: 0.015 }],
      contractedFees: [{ name: 'Tarifa de abertura', amount: 50 }],
      contractedFinanceCharges: [{ type: 'IOF', rate: 0.0038 }],
      warranties: [{ type: 'AVAL', amount: 10000 }],
      installments: { typeNumberOfInstallments: 'MONTH', totalNumberOfInstallments: 24 },
      payments: { contractOutstandingBalance: 8000, releases: [] },
    })

    const row = await model.findOne({ where: { loan_id: loanId } })
    expect(row?.get('ipoc_code')).toBe('IPOC-123')
    expect(row?.get('disbursement_dates')).toEqual(['2026-01-01T00:00:00.000Z'])
    expect(row?.get('first_installment_due_date')).toEqual(new Date('2026-02-01T00:00:00.000Z'))
    expect(row?.get('cet')).toBe('15.50000000')
    expect(row?.get('installment_periodicity')).toBe('MONTHLY')
    expect(row?.get('amortization_scheduled')).toBe('SAC')
    expect(row?.get('cnpj_consignee')).toBe('12.345.678/0001-00')
    expect(row?.get('interest_rates')).toEqual([{ taxType: 'NOMINAL', preFixedRate: 0.015 }])
    expect(row?.get('contracted_fees')).toEqual([{ name: 'Tarifa de abertura', amount: 50 }])
    expect(row?.get('contracted_finance_charges')).toEqual([{ type: 'IOF', rate: 0.0038 }])
    expect(row?.get('warranties')).toEqual([{ type: 'AVAL', amount: 10000 }])
    expect(row?.get('installments')).toEqual({ typeNumberOfInstallments: 'MONTH', totalNumberOfInstallments: 24 })
    expect(row?.get('payments')).toEqual({ contractOutstandingBalance: 8000, releases: [] })
  })

  it('empréstimo sem schema completo grava e recupera com os campos indefinidos', async () => {
    const loanId = randomUUID()
    const itemId = randomUUID()
    loanIdsToCleanup.push(loanId)

    await repository.save(baseInput(loanId, itemId))

    const row = await model.findOne({ where: { loan_id: loanId } })
    expect(row?.get('ipoc_code')).toBeNull()
    expect(row?.get('interest_rates')).toBeNull()
    expect(row?.get('installments')).toBeNull()
  })

  it('reconcile remove empréstimos ausentes da leitura autoritativa, preservando os presentes (D21)', async () => {
    const itemId = randomUUID()
    const loan1 = randomUUID()
    const loan2 = randomUUID()

    await repository.save(baseInput(loan1, itemId))
    await repository.save(baseInput(loan2, itemId))

    try {
      const removed = await repository.reconcile(itemId, [loan1])
      expect(removed).toBe(1)

      const remaining = await model.findAll({ where: { item_id: itemId } })
      expect(remaining.map((r) => r.get('loan_id'))).toEqual([loan1])
    } finally {
      await model.destroy({ where: { item_id: itemId } })
    }
  })

  it('recusa gravação sem productName antes de tocar o banco', async () => {
    await expect(
      repository.save({ ...baseInput(randomUUID(), 'item-x'), productName: '' }),
    ).rejects.toBeInstanceOf(ApplicationError)
  })
})
