import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { PluggyAccount } from '../../src/entities/pluggy-account.js'
import { ApplicationError } from '../../src/shared/application-error.js'

function validAccountProps() {
  return {
    itemId: 'item-1',
    accountId: 'acc-1',
    type: 'BANK',
    subtype: 'CHECKING_ACCOUNT',
    number: '12345-6',
    name: 'Banco Exemplo',
    balance: new Decimal('1500.50'),
    currencyCode: 'BRL',
    providerCreatedAt: new Date('2026-08-23T04:26:12.808Z'),
    providerUpdatedAt: new Date('2026-09-03T04:40:13.435Z'),
  }
}

describe('PluggyAccount', () => {
  it('aceita criação com campos obrigatórios', () => {
    const account = PluggyAccount.create(validAccountProps())
    expect(account.getItemId()).toBe('item-1')
    expect(account.getAccountId()).toBe('acc-1')
    expect(account.getBalance()).toEqual(new Decimal('1500.50'))
    expect(account.getMarketingName()).toBeUndefined()
    expect(account.getOwner()).toBeUndefined()
  })

  it('aceita criação com campos opcionais presentes', () => {
    const account = PluggyAccount.create({
      ...validAccountProps(),
      marketingName: 'Conta Corrente',
      owner: 'Nome Ficticio do Titular',
    })
    expect(account.getMarketingName()).toBe('Conta Corrente')
    expect(account.getOwner()).toBe('Nome Ficticio do Titular')
  })

  it.each([
    ['itemId', 'PLUGGY_ACCOUNT_ITEM_ID_MISSING'],
    ['accountId', 'PLUGGY_ACCOUNT_ACCOUNT_ID_MISSING'],
    ['type', 'PLUGGY_ACCOUNT_TYPE_MISSING'],
    ['number', 'PLUGGY_ACCOUNT_NUMBER_MISSING'],
    ['name', 'PLUGGY_ACCOUNT_NAME_MISSING'],
    ['currencyCode', 'PLUGGY_ACCOUNT_CURRENCY_CODE_MISSING'],
  ])('recusa criação sem %s', (field, expectedError) => {
    const props = { ...validAccountProps(), [field]: '' }
    expect(() => PluggyAccount.create(props)).toThrowError(ApplicationError)
    try {
      PluggyAccount.create(props)
    } catch (e) {
      expect((e as ApplicationError).errorType).toBe(expectedError)
    }
  })

  it('recusa criação sem balance', () => {
    const { balance, ...rest } = validAccountProps()
    void balance
    expect(() =>
      PluggyAccount.create(rest as unknown as Parameters<typeof PluggyAccount.create>[0]),
    ).toThrowError(ApplicationError)
  })

  it('recusa campo inesperado em runtime', () => {
    const props = { ...validAccountProps(), creditData: {} }
    expect(() =>
      PluggyAccount.create(props as unknown as Parameters<typeof PluggyAccount.create>[0]),
    ).toThrowError(ApplicationError)
  })

  it('aceita criação com campos de crédito presentes', () => {
    const account = PluggyAccount.create({
      ...validAccountProps(),
      type: 'CREDIT',
      level: 'BLACK',
      brand: 'MASTERCARD',
      brandAdditionalInfo: 'Bandeira parceira',
      balanceCloseDate: new Date('2026-08-20T00:00:00.000Z'),
      balanceDueDate: new Date('2026-08-27T00:00:00.000Z'),
      availableCreditLimit: new Decimal('5000.00'),
      balanceForeignCurrency: new Decimal('0.00'),
      minimumPayment: new Decimal('150.00'),
      creditLimit: new Decimal('10000.00'),
      isLimitFlexible: true,
      status: 'ACTIVE',
      holderType: 'MAIN',
    })

    expect(account.getLevel()).toBe('BLACK')
    expect(account.getBrand()).toBe('MASTERCARD')
    expect(account.getBrandAdditionalInfo()).toBe('Bandeira parceira')
    expect(account.getBalanceCloseDate()).toEqual(new Date('2026-08-20T00:00:00.000Z'))
    expect(account.getBalanceDueDate()).toEqual(new Date('2026-08-27T00:00:00.000Z'))
    expect(account.getAvailableCreditLimit()).toEqual(new Decimal('5000.00'))
    expect(account.getBalanceForeignCurrency()).toEqual(new Decimal('0.00'))
    expect(account.getMinimumPayment()).toEqual(new Decimal('150.00'))
    expect(account.getCreditLimit()).toEqual(new Decimal('10000.00'))
    expect(account.getIsLimitFlexible()).toBe(true)
    expect(account.getStatus()).toBe('ACTIVE')
    expect(account.getHolderType()).toBe('MAIN')
  })

  it('conta BANK sem dado de crédito mantém os campos de crédito indefinidos', () => {
    const account = PluggyAccount.create(validAccountProps())

    expect(account.getLevel()).toBeUndefined()
    expect(account.getBrand()).toBeUndefined()
    expect(account.getBrandAdditionalInfo()).toBeUndefined()
    expect(account.getBalanceCloseDate()).toBeUndefined()
    expect(account.getBalanceDueDate()).toBeUndefined()
    expect(account.getAvailableCreditLimit()).toBeUndefined()
    expect(account.getBalanceForeignCurrency()).toBeUndefined()
    expect(account.getMinimumPayment()).toBeUndefined()
    expect(account.getCreditLimit()).toBeUndefined()
    expect(account.getIsLimitFlexible()).toBeUndefined()
    expect(account.getStatus()).toBeUndefined()
    expect(account.getHolderType()).toBeUndefined()
  })
})
