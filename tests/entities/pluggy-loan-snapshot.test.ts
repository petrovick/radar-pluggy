import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { PluggyLoanSnapshot } from '../../src/entities/pluggy-loan-snapshot.js'
import { ApplicationError } from '../../src/shared/application-error.js'

function validSnapshotProps() {
  return {
    itemId: 'item-1',
    loanId: 'loan-1',
    currencyCode: 'BRL',
    syncedAt: new Date('2026-09-05T10:00:00.000Z'),
  }
}

describe('PluggyLoanSnapshot', () => {
  it('aceita criação com só os campos obrigatórios', () => {
    const snapshot = PluggyLoanSnapshot.create(validSnapshotProps())
    expect(snapshot.getItemId()).toBe('item-1')
    expect(snapshot.getLoanId()).toBe('loan-1')
    expect(snapshot.getOutstandingBalance()).toBeUndefined()
  })

  it('aceita criação com todos os campos financeiros presentes', () => {
    const snapshot = PluggyLoanSnapshot.create({
      ...validSnapshotProps(),
      outstandingBalance: new Decimal('8000.00'),
      totalInstallments: 24,
      paidInstallments: 5,
      dueInstallments: 19,
      pastDueInstallments: 0,
    })
    expect(snapshot.getOutstandingBalance()).toEqual(new Decimal('8000.00'))
    expect(snapshot.getTotalInstallments()).toBe(24)
    expect(snapshot.getPaidInstallments()).toBe(5)
    expect(snapshot.getDueInstallments()).toBe(19)
    expect(snapshot.getPastDueInstallments()).toBe(0)
  })

  it.each([
    ['itemId', 'PLUGGY_LOAN_SNAPSHOT_ITEM_ID_MISSING'],
    ['loanId', 'PLUGGY_LOAN_SNAPSHOT_LOAN_ID_MISSING'],
    ['currencyCode', 'PLUGGY_LOAN_SNAPSHOT_CURRENCY_CODE_MISSING'],
  ])('recusa criação sem %s', (field, expectedError) => {
    const props = { ...validSnapshotProps(), [field]: '' }
    try {
      PluggyLoanSnapshot.create(props)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationError)
      expect((err as ApplicationError).errorType).toBe(expectedError)
    }
  })

  it('recusa criação sem syncedAt', () => {
    const { syncedAt, ...rest } = validSnapshotProps()
    void syncedAt
    expect(() =>
      PluggyLoanSnapshot.create(rest as unknown as Parameters<typeof PluggyLoanSnapshot.create>[0]),
    ).toThrowError(ApplicationError)
  })

  it('recusa campo inesperado em runtime', () => {
    const props = { ...validSnapshotProps(), unexpectedField: 'bad' }
    expect(() =>
      PluggyLoanSnapshot.create(props as unknown as Parameters<typeof PluggyLoanSnapshot.create>[0]),
    ).toThrowError(ApplicationError)
  })
})
