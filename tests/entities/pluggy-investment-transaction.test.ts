import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { PluggyInvestmentTransaction } from '../../src/entities/pluggy-investment-transaction.js'
import { ApplicationError } from '../../src/shared/application-error.js'

function validTransactionProps() {
  return {
    itemId: 'item-1',
    investmentId: 'inv-1',
    transactionId: 'itx-1',
    type: 'BUY',
    date: new Date('2026-06-23T00:00:00.000Z'),
  }
}

describe('PluggyInvestmentTransaction', () => {
  it('aceita criação com campos obrigatórios mínimos', () => {
    const itx = PluggyInvestmentTransaction.create(validTransactionProps())
    expect(itx.getItemId()).toBe('item-1')
    expect(itx.getInvestmentId()).toBe('inv-1')
    expect(itx.getTransactionId()).toBe('itx-1')
    expect(itx.getType()).toBe('BUY')
    expect(itx.getQuantity()).toBeUndefined()
  })

  it('aceita todos os tipos documentados (BUY, SELL, TAX, TRANSFER, INTEREST, AMORTIZATION)', () => {
    const types = ['BUY', 'SELL', 'TAX', 'TRANSFER', 'INTEREST', 'AMORTIZATION']
    for (const type of types) {
      const itx = PluggyInvestmentTransaction.create({ ...validTransactionProps(), type })
      expect(itx.getType()).toBe(type)
    }
  })

  it('recusa tipo desconhecido', () => {
    expect(() =>
      PluggyInvestmentTransaction.create({ ...validTransactionProps(), type: 'DIVIDEND_UNKNOWN' }),
    ).toThrowError(ApplicationError)
  })

  it('aceita valores e quantidades com 8 casas decimais', () => {
    const itx = PluggyInvestmentTransaction.create({
      ...validTransactionProps(),
      quantity: new Decimal('100.12345678'),
      value: new Decimal('34.87654321'),
      priceFactor: new Decimal('1.00000000'),
      indexerPercentage: new Decimal('105.50000000'),
      agreedRate: new Decimal('0.12500000'),
    })
    expect(itx.getQuantity()).toEqual(new Decimal('100.12345678'))
    expect(itx.getValue()).toEqual(new Decimal('34.87654321'))
    expect(itx.getPriceFactor()).toEqual(new Decimal('1.00000000'))
    expect(itx.getIndexerPercentage()).toEqual(new Decimal('105.50000000'))
    expect(itx.getAgreedRate()).toEqual(new Decimal('0.12500000'))
  })

  it('aceita as 13 despesas parciais ou completas com 2 casas decimais', () => {
    const itx = PluggyInvestmentTransaction.create({
      ...validTransactionProps(),
      serviceTax: new Decimal('1.00'),
      brokerageFee: new Decimal('2.50'),
      incomeTax: new Decimal('10.20'),
      tradingAssetsNoticeFee: new Decimal('0.30'),
      maintenanceFee: new Decimal('0.40'),
      settlementFee: new Decimal('0.50'),
      clearingFee: new Decimal('0.60'),
      stockExchangeFee: new Decimal('0.70'),
      custodyFee: new Decimal('0.80'),
      operatingFee: new Decimal('0.90'),
      other: new Decimal('1.10'),
      iof: new Decimal('0.15'),
      iofProvision: new Decimal('0.05'),
    })
    expect(itx.getServiceTax()).toEqual(new Decimal('1.00'))
    expect(itx.getBrokerageFee()).toEqual(new Decimal('2.50'))
    expect(itx.getIncomeTax()).toEqual(new Decimal('10.20'))
    expect(itx.getTradingAssetsNoticeFee()).toEqual(new Decimal('0.30'))
    expect(itx.getMaintenanceFee()).toEqual(new Decimal('0.40'))
    expect(itx.getSettlementFee()).toEqual(new Decimal('0.50'))
    expect(itx.getClearingFee()).toEqual(new Decimal('0.60'))
    expect(itx.getStockExchangeFee()).toEqual(new Decimal('0.70'))
    expect(itx.getCustodyFee()).toEqual(new Decimal('0.80'))
    expect(itx.getOperatingFee()).toEqual(new Decimal('0.90'))
    expect(itx.getOther()).toEqual(new Decimal('1.10'))
    expect(itx.getIof()).toEqual(new Decimal('0.15'))
    expect(itx.getIofProvision()).toEqual(new Decimal('0.05'))
  })

  it.each([
    ['itemId', 'PLUGGY_INVESTMENT_TRANSACTION_ITEM_ID_MISSING'],
    ['investmentId', 'PLUGGY_INVESTMENT_TRANSACTION_INVESTMENT_ID_MISSING'],
    ['transactionId', 'PLUGGY_INVESTMENT_TRANSACTION_TRANSACTION_ID_MISSING'],
    ['type', 'PLUGGY_INVESTMENT_TRANSACTION_TYPE_MISSING'],
  ])('recusa criação sem %s', (field, expectedError) => {
    const props = { ...validTransactionProps(), [field]: '' }
    expect(() => PluggyInvestmentTransaction.create(props)).toThrowError(ApplicationError)
    try {
      PluggyInvestmentTransaction.create(props)
    } catch (e) {
      expect((e as ApplicationError).errorType).toBe(expectedError)
    }
  })

  it('recusa criação sem date', () => {
    const { date, ...rest } = validTransactionProps()
    void date
    expect(() =>
      PluggyInvestmentTransaction.create(rest as unknown as Parameters<typeof PluggyInvestmentTransaction.create>[0]),
    ).toThrowError(ApplicationError)
  })

  it('recusa campo inesperado em runtime', () => {
    const props = { ...validTransactionProps(), unexpectedProp: 'bad' }
    expect(() =>
      PluggyInvestmentTransaction.create(props as unknown as Parameters<typeof PluggyInvestmentTransaction.create>[0]),
    ).toThrowError(ApplicationError)
  })
})
