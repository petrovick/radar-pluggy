import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { PluggyPosition } from '../../src/entities/pluggy-position.js'
import { ApplicationError } from '../../src/shared/application-error.js'

function validProps() {
  return {
    investmentId: 'inv-1',
    itemId: 'item-1',
    type: 'MUTUAL_FUND',
    name: 'Fundo XYZ',
    currencyCode: 'BRL',
    balance: new Decimal('1359.39'),
    quotaDate: new Date('2026-08-01T00:00:00.000Z'),
  }
}

describe('PluggyPosition', () => {
  it('aceita criação com só os campos obrigatórios', () => {
    const position = PluggyPosition.create(validProps())
    expect(position.getBalance()).toEqual(new Decimal('1359.39'))
    expect(position.getQuantity()).toBeUndefined()
    expect(position.getSubtype()).toBeUndefined()
  })

  it('aceita criação com os campos opcionais presentes', () => {
    const position = PluggyPosition.create({
      ...validProps(),
      subtype: 'MULTIMARKET_FUND',
      code: '12.345.678/0001-00',
      isin: 'BR123',
      quantity: new Decimal('3'),
      amountOriginal: new Decimal('1000'),
      status: 'ACTIVE',
      institutionName: 'Banco Exemplo S/A',
      institutionNumber: '00000000000191',
    })
    expect(position.getQuantity()).toEqual(new Decimal('3'))
    expect(position.getInstitutionName()).toBe('Banco Exemplo S/A')
  })

  it.each([
    ['investmentId', 'PLUGGY_POSITION_INVESTMENT_ID_MISSING'],
    ['itemId', 'PLUGGY_POSITION_ITEM_ID_MISSING'],
    ['type', 'PLUGGY_POSITION_TYPE_MISSING'],
    ['name', 'PLUGGY_POSITION_NAME_MISSING'],
    ['currencyCode', 'PLUGGY_POSITION_CURRENCY_CODE_MISSING'],
  ])('recusa criação sem %s, nomeando o erro certo', (field, expectedErrorType) => {
    const props = { ...validProps(), [field]: '' }
    try {
      PluggyPosition.create(props)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe(expectedErrorType)
    }
  })

  it('recusa criação sem balance', () => {
    const { balance, ...rest } = validProps()
    void balance
    try {
      PluggyPosition.create(rest as unknown as Parameters<typeof PluggyPosition.create>[0])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_POSITION_BALANCE_MISSING')
    }
  })

  it('recusa criação sem quotaDate', () => {
    const { quotaDate, ...rest } = validProps()
    void quotaDate
    try {
      PluggyPosition.create(rest as unknown as Parameters<typeof PluggyPosition.create>[0])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_POSITION_QUOTA_DATE_MISSING')
    }
  })

  it('recusa em runtime um campo inesperado, nomeando o campo', () => {
    const externalPayload: Record<string, unknown> = { ...validProps(), transactions: [] }
    try {
      PluggyPosition.create(externalPayload as unknown as Parameters<typeof PluggyPosition.create>[0])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_POSITION_UNEXPECTED_FIELD')
      expect((error as ApplicationError).details).toMatchObject({ fields: ['transactions'] })
    }
  })
})
