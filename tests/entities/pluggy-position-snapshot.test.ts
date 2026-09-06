import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { PluggyPositionSnapshot } from '../../src/entities/pluggy-position-snapshot.js'
import { ApplicationError } from '../../src/shared/application-error.js'

function validSnapshotProps() {
  return {
    itemId: 'item-1',
    investmentId: 'inv-1',
    quotaDate: new Date('2026-08-01T00:00:00.000Z'),
    balance: new Decimal('1359.39'),
    currencyCode: 'BRL',
    syncedAt: new Date('2026-09-03T10:00:00.000Z'),
  }
}

describe('PluggyPositionSnapshot', () => {
  it('aceita criação com só os campos obrigatórios', () => {
    const snapshot = PluggyPositionSnapshot.create(validSnapshotProps())
    expect(snapshot.getItemId()).toBe('item-1')
    expect(snapshot.getInvestmentId()).toBe('inv-1')
    expect(snapshot.getBalance()).toEqual(new Decimal('1359.39'))
    expect(snapshot.getQuantity()).toBeUndefined()
    expect(snapshot.getValue()).toBeUndefined()
  })

  it('aceita criação com todos os campos financeiros presentes, preservando 8 casas', () => {
    const snapshot = PluggyPositionSnapshot.create({
      ...validSnapshotProps(),
      quantity: new Decimal('10.12345678'),
      value: new Decimal('34.87654321'),
      amount: new Decimal('352.92'),
      amountOriginal: new Decimal('300.00'),
      taxes: new Decimal('5.25'),
      taxes2: new Decimal('2.10'),
    })
    expect(snapshot.getQuantity()).toEqual(new Decimal('10.12345678'))
    expect(snapshot.getValue()).toEqual(new Decimal('34.87654321'))
    expect(snapshot.getAmount()).toEqual(new Decimal('352.92'))
    expect(snapshot.getAmountOriginal()).toEqual(new Decimal('300.00'))
    expect(snapshot.getTaxes()).toEqual(new Decimal('5.25'))
    expect(snapshot.getTaxes2()).toEqual(new Decimal('2.10'))
  })

  it.each([
    ['itemId', 'PLUGGY_POSITION_SNAPSHOT_ITEM_ID_MISSING'],
    ['investmentId', 'PLUGGY_POSITION_SNAPSHOT_INVESTMENT_ID_MISSING'],
    ['currencyCode', 'PLUGGY_POSITION_SNAPSHOT_CURRENCY_CODE_MISSING'],
  ])('recusa criação sem %s', (field, expectedError) => {
    const props = { ...validSnapshotProps(), [field]: '' }
    try {
      PluggyPositionSnapshot.create(props)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationError)
      expect((err as ApplicationError).errorType).toBe(expectedError)
    }
  })

  it('recusa criação sem balance', () => {
    const { balance, ...rest } = validSnapshotProps()
    void balance
    expect(() =>
      PluggyPositionSnapshot.create(rest as unknown as Parameters<typeof PluggyPositionSnapshot.create>[0]),
    ).toThrowError(ApplicationError)
  })

  it('recusa criação sem quotaDate', () => {
    const { quotaDate, ...rest } = validSnapshotProps()
    void quotaDate
    expect(() =>
      PluggyPositionSnapshot.create(rest as unknown as Parameters<typeof PluggyPositionSnapshot.create>[0]),
    ).toThrowError(ApplicationError)
  })

  it('recusa criação sem syncedAt', () => {
    const { syncedAt, ...rest } = validSnapshotProps()
    void syncedAt
    expect(() =>
      PluggyPositionSnapshot.create(rest as unknown as Parameters<typeof PluggyPositionSnapshot.create>[0]),
    ).toThrowError(ApplicationError)
  })

  it('recusa campo inesperado em runtime', () => {
    const props = { ...validSnapshotProps(), unexpectedField: 'bad' }
    expect(() =>
      PluggyPositionSnapshot.create(props as unknown as Parameters<typeof PluggyPositionSnapshot.create>[0]),
    ).toThrowError(ApplicationError)
  })
})
