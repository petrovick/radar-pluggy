import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { PluggyAccountTransaction } from '../../src/entities/pluggy-account-transaction.js'
import { ApplicationError } from '../../src/shared/application-error.js'

function validTransactionProps() {
  return {
    itemId: 'item-1',
    accountId: 'acc-1',
    transactionId: 'tx-1',
    description: 'Compra Mercado',
    currencyCode: 'BRL',
    amount: new Decimal('-18.24'),
    date: new Date('2026-09-03T04:22:50.758Z'),
    transactionType: 'DEBIT',
    status: 'POSTED',
    providerCreatedAt: new Date('2026-09-03T04:26:12.808Z'),
    providerUpdatedAt: new Date('2026-09-03T04:40:13.435Z'),
  }
}

describe('PluggyAccountTransaction', () => {
  // O spec de pluggy-transaction-history exige `createdAt`/`updatedAt` no extrato. Hoje o gateway
  // sempre envia os dois, então a ausência nunca chegaria aqui pela rota normal — mas a entidade é a
  // fronteira que garante a invariante por si mesma: um chamador futuro que pule o gateway não pode
  // conseguir gravar a linha sem eles.
  it.each([
    ['providerCreatedAt', 'PLUGGY_ACCOUNT_TRANSACTION_PROVIDER_CREATED_AT_MISSING'],
    ['providerUpdatedAt', 'PLUGGY_ACCOUNT_TRANSACTION_PROVIDER_UPDATED_AT_MISSING'],
  ])('recusa criação sem %s, nomeando o campo', (field, errorType) => {
    const props = { ...validTransactionProps(), [field]: undefined } as unknown as ReturnType<
      typeof validTransactionProps
    >

    try {
      PluggyAccountTransaction.create(props)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe(errorType)
    }
  })

  it('aceita criação com campos obrigatórios', () => {
    const tx = PluggyAccountTransaction.create(validTransactionProps())
    expect(tx.getItemId()).toBe('item-1')
    expect(tx.getAccountId()).toBe('acc-1')
    expect(tx.getTransactionId()).toBe('tx-1')
    expect(tx.getAmount()).toEqual(new Decimal('-18.24'))
    expect(tx.getDescriptionRaw()).toBeUndefined()
  })

  it('aceita criação com campos opcionais e JSON de merchant/paymentData', () => {
    const tx = PluggyAccountTransaction.create({
      ...validTransactionProps(),
      descriptionRaw: 'COMPRA MERCADO RAW',
      amountInAccountCurrency: new Decimal('-18.24'),
      balance: new Decimal('19981.76'),
      categoryId: 'cat-1',
      category: 'Mercado',
      operationType: 'PURCHASE',
      merchant: { name: 'Apple', cnpj: '123' },
      paymentData: { payee: 'Merchant' },
      sourceOrder: 1,
    })
    expect(tx.getDescriptionRaw()).toBe('COMPRA MERCADO RAW')
    expect(tx.getBalance()).toEqual(new Decimal('19981.76'))
    expect(tx.getMerchant()).toEqual({ name: 'Apple', cnpj: '123' })
    expect(tx.getSourceOrder()).toBe(1)
  })

  // Change pluggy-complete-data-capture, spec pluggy-transaction-history: campo antes descartado.
  it('aceita criação com creditCardMetadata presente', () => {
    const tx = PluggyAccountTransaction.create({
      ...validTransactionProps(),
      creditCardMetadata: { installmentNumber: 1, totalInstallments: 3, billForecastDate: '2026-10' },
    })
    expect(tx.getCreditCardMetadata()).toEqual({
      installmentNumber: 1,
      totalInstallments: 3,
      billForecastDate: '2026-10',
    })
  })

  it('transação sem creditCardMetadata mantém o campo indefinido', () => {
    const tx = PluggyAccountTransaction.create(validTransactionProps())
    expect(tx.getCreditCardMetadata()).toBeUndefined()
  })

  it.each([
    ['itemId', 'PLUGGY_ACCOUNT_TRANSACTION_ITEM_ID_MISSING'],
    ['accountId', 'PLUGGY_ACCOUNT_TRANSACTION_ACCOUNT_ID_MISSING'],
    ['transactionId', 'PLUGGY_ACCOUNT_TRANSACTION_TRANSACTION_ID_MISSING'],
    ['description', 'PLUGGY_ACCOUNT_TRANSACTION_DESCRIPTION_MISSING'],
    ['currencyCode', 'PLUGGY_ACCOUNT_TRANSACTION_CURRENCY_CODE_MISSING'],
    ['transactionType', 'PLUGGY_ACCOUNT_TRANSACTION_TYPE_MISSING'],
    ['status', 'PLUGGY_ACCOUNT_TRANSACTION_STATUS_MISSING'],
  ])('recusa criação sem %s', (field, expectedError) => {
    const props = { ...validTransactionProps(), [field]: '' }
    expect(() => PluggyAccountTransaction.create(props)).toThrowError(ApplicationError)
    try {
      PluggyAccountTransaction.create(props)
    } catch (e) {
      expect((e as ApplicationError).errorType).toBe(expectedError)
    }
  })

  it('recusa criação sem amount', () => {
    const { amount, ...rest } = validTransactionProps()
    void amount
    expect(() =>
      PluggyAccountTransaction.create(rest as unknown as Parameters<typeof PluggyAccountTransaction.create>[0]),
    ).toThrowError(ApplicationError)
  })

  it('recusa criação sem date', () => {
    const { date, ...rest } = validTransactionProps()
    void date
    expect(() =>
      PluggyAccountTransaction.create(rest as unknown as Parameters<typeof PluggyAccountTransaction.create>[0]),
    ).toThrowError(ApplicationError)
  })

  it('recusa campo inesperado em runtime', () => {
    const props = { ...validTransactionProps(), unexpectedProperty: 'bad' }
    expect(() =>
      PluggyAccountTransaction.create(props as unknown as Parameters<typeof PluggyAccountTransaction.create>[0]),
    ).toThrowError(ApplicationError)
  })
})
