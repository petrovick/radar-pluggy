import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { PluggyLoan } from '../../src/entities/pluggy-loan.js'
import { ApplicationError } from '../../src/shared/application-error.js'

function validProps() {
  return {
    loanId: 'loan-1',
    itemId: 'item-1',
    productName: 'Crédito Pessoal',
    kind: 'LOAN',
    currencyCode: 'BRL',
  }
}

describe('PluggyLoan', () => {
  it('aceita criação com só os campos obrigatórios', () => {
    const loan = PluggyLoan.create(validProps())
    expect(loan.getLoanId()).toBe('loan-1')
    expect(loan.getProductName()).toBe('Crédito Pessoal')
    expect(loan.getOutstandingBalance()).toBeUndefined()
    expect(loan.getContractAmount()).toBeUndefined()
  })

  it('aceita criação com os campos opcionais presentes', () => {
    const loan = PluggyLoan.create({
      ...validProps(),
      contractNumber: '12345',
      type: 'CREDITO_PESSOAL_SEM_CONSIGNACAO',
      collectedAt: new Date('2026-08-01T00:00:00.000Z'),
      contractDate: new Date('2026-01-01T00:00:00.000Z'),
      contractAmount: new Decimal('10000.00'),
      dueDate: new Date('2028-01-01T00:00:00.000Z'),
      totalInstallments: 24,
      paidInstallments: 5,
      dueInstallments: 19,
      pastDueInstallments: 0,
      outstandingBalance: new Decimal('8000.00'),
    })
    expect(loan.getContractNumber()).toBe('12345')
    expect(loan.getContractAmount()).toEqual(new Decimal('10000.00'))
    expect(loan.getOutstandingBalance()).toEqual(new Decimal('8000.00'))
    expect(loan.getTotalInstallments()).toBe(24)
    expect(loan.getPaidInstallments()).toBe(5)
    expect(loan.getDueInstallments()).toBe(19)
    expect(loan.getPastDueInstallments()).toBe(0)
  })

  it.each([
    ['loanId', 'PLUGGY_LOAN_LOAN_ID_MISSING'],
    ['itemId', 'PLUGGY_LOAN_ITEM_ID_MISSING'],
    ['productName', 'PLUGGY_LOAN_PRODUCT_NAME_MISSING'],
    ['kind', 'PLUGGY_LOAN_KIND_MISSING'],
    ['currencyCode', 'PLUGGY_LOAN_CURRENCY_CODE_MISSING'],
  ])('recusa criação sem %s, nomeando o erro certo', (field, expectedErrorType) => {
    const props = { ...validProps(), [field]: '' }
    try {
      PluggyLoan.create(props)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe(expectedErrorType)
    }
  })

  it('recusa em runtime um campo inesperado, nomeando o campo', () => {
    const externalPayload: Record<string, unknown> = { ...validProps(), unknownField: [] }
    try {
      PluggyLoan.create(externalPayload as unknown as Parameters<typeof PluggyLoan.create>[0])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_LOAN_UNEXPECTED_FIELD')
      expect((error as ApplicationError).details).toMatchObject({ fields: ['unknownField'] })
    }
  })

  // Change pluggy-complete-data-capture, spec pluggy-loan: schema completo do contrato, revertendo
  // o corte antes documentado no gateway.
  it('aceita criação com o schema completo do contrato presente', () => {
    const loan = PluggyLoan.create({
      ...validProps(),
      ipocCode: 'IPOC-123',
      disbursementDates: [new Date('2026-01-01T00:00:00.000Z')],
      firstInstallmentDueDate: new Date('2026-02-01T00:00:00.000Z'),
      cet: new Decimal('15.5'),
      installmentPeriodicity: 'MONTHLY',
      amortizationScheduled: 'SAC',
      cnpjConsignee: '12.345.678/0001-00',
      interestRates: [{ taxType: 'NOMINAL' }],
      contractedFees: [{ name: 'Tarifa' }],
      contractedFinanceCharges: [{ type: 'IOF' }],
      warranties: [{ type: 'AVAL' }],
      installments: { totalNumberOfInstallments: 24 },
      payments: { contractOutstandingBalance: 8000 },
    })

    expect(loan.getIpocCode()).toBe('IPOC-123')
    expect(loan.getDisbursementDates()).toEqual([new Date('2026-01-01T00:00:00.000Z')])
    expect(loan.getFirstInstallmentDueDate()).toEqual(new Date('2026-02-01T00:00:00.000Z'))
    expect(loan.getCet()).toEqual(new Decimal('15.5'))
    expect(loan.getInstallmentPeriodicity()).toBe('MONTHLY')
    expect(loan.getAmortizationScheduled()).toBe('SAC')
    expect(loan.getCnpjConsignee()).toBe('12.345.678/0001-00')
    expect(loan.getInterestRates()).toEqual([{ taxType: 'NOMINAL' }])
    expect(loan.getContractedFees()).toEqual([{ name: 'Tarifa' }])
    expect(loan.getContractedFinanceCharges()).toEqual([{ type: 'IOF' }])
    expect(loan.getWarranties()).toEqual([{ type: 'AVAL' }])
    expect(loan.getInstallments()).toEqual({ totalNumberOfInstallments: 24 })
    expect(loan.getPayments()).toEqual({ contractOutstandingBalance: 8000 })
  })

  it('empréstimo sem o schema completo mantém os campos indefinidos', () => {
    const loan = PluggyLoan.create(validProps())

    expect(loan.getIpocCode()).toBeUndefined()
    expect(loan.getInterestRates()).toBeUndefined()
    expect(loan.getInstallments()).toBeUndefined()
    expect(loan.getPayments()).toBeUndefined()
  })
})
