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
    const externalPayload: Record<string, unknown> = { ...validProps(), warranties: [] }
    try {
      PluggyLoan.create(externalPayload as unknown as Parameters<typeof PluggyLoan.create>[0])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_LOAN_UNEXPECTED_FIELD')
      expect((error as ApplicationError).details).toMatchObject({ fields: ['warranties'] })
    }
  })
})
