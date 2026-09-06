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

  // Change pluggy-complete-data-capture, spec pluggy-position-sync: campos antes descartados no
  // gateway, agora capturados pela entity.
  it('aceita criação com os campos de captura completa presentes', () => {
    const position = PluggyPosition.create({
      ...validProps(),
      issuerCnpj: '12.345.678/0001-00',
      number: 'CDB-9988',
      amountWithdrawal: new Decimal('1180'),
      amountProfit: new Decimal('42.1'),
      dueDate: new Date('2028-01-01T00:00:00.000Z'),
      issuer: 'Banco X',
      issueDate: new Date('2026-01-01T00:00:00.000Z'),
      purchaseDate: new Date('2026-01-02T00:00:00.000Z'),
      rate: new Decimal('100.5'),
      rateType: 'CDI',
      fixedAnnualRate: new Decimal('12.5'),
      lastMonthRate: new Decimal('1.02'),
      annualRate: new Decimal('12.8'),
      lastTwelveMonthsRate: new Decimal('12.9'),
      owner: 'Fulano de Tal',
      metadata: { taxRegime: 'REGRESSIVO', proposalNumber: '123', processNumber: '456' },
    })
    expect(position.getDueDate()).toEqual(new Date('2028-01-01T00:00:00.000Z'))
    expect(position.getRate()).toEqual(new Decimal('100.5'))
    expect(position.getAmountProfit()).toEqual(new Decimal('42.1'))
    expect(position.getMetadata()).toEqual({
      taxRegime: 'REGRESSIVO',
      proposalNumber: '123',
      processNumber: '456',
    })
  })

  it('aceita criação sem nenhum campo de captura completa', () => {
    const position = PluggyPosition.create(validProps())
    expect(position.getDueDate()).toBeUndefined()
    expect(position.getRate()).toBeUndefined()
    expect(position.getAmountProfit()).toBeUndefined()
    expect(position.getMetadata()).toBeUndefined()
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
