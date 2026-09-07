import { describe, expect, it } from 'vitest'
import {
  PLUGGY_SOURCES,
  discoveryProductTypesFor,
  discoveryStatusDetailKeysFor,
  dtoKeyFromSource,
  productTypeFromSource,
  sourceFromProductType,
  sourceFromStatusDetailKey,
  statusDetailKeyFromSource,
  type PluggySource,
} from '../../../src/adapters/gateways/pluggy-source-catalog.js'

// As cinco linhas, com os nomes que NÃO coincidem entre si de propósito (D7/D32): `productType` usa
// "S" em Investments e em Transactions (`INVESTMENTS_TRANSACTIONS`); a chave de `statusDetail` não
// tem "S" em Investments (`investmentTransactions`); o vocabulário de domínio é singular em
// Investment (`INVESTMENT_TRANSACTIONS`); a chave do DTO de `/credentials/status` usa
// `accountTransactions` (distinta de `transactions`, a chave de `statusDetail`). As formas de
// "transações de investimento/conta" são distintas por design — é a divergência que causou o bug
// original (D7).
const ROWS: { source: PluggySource; productType: string; statusDetailKey: string; dtoKey: string }[] = [
  { source: 'ACCOUNTS', productType: 'ACCOUNTS', statusDetailKey: 'accounts', dtoKey: 'accounts' },
  { source: 'ACCOUNT_TRANSACTIONS', productType: 'TRANSACTIONS', statusDetailKey: 'transactions', dtoKey: 'accountTransactions' },
  { source: 'INVESTMENTS', productType: 'INVESTMENTS', statusDetailKey: 'investments', dtoKey: 'investments' },
  {
    source: 'INVESTMENT_TRANSACTIONS',
    productType: 'INVESTMENTS_TRANSACTIONS',
    statusDetailKey: 'investmentTransactions',
    dtoKey: 'investmentTransactions',
  },
  { source: 'LOANS', productType: 'LOANS', statusDetailKey: 'loans', dtoKey: 'loans' },
]

describe('pluggy-source-catalog', () => {
  it.each(ROWS)('$source: productType <-> statusDetailKey <-> dtoKey', (row) => {
    expect(sourceFromProductType(row.productType)).toBe(row.source)
    expect(sourceFromStatusDetailKey(row.statusDetailKey)).toBe(row.source)
    expect(statusDetailKeyFromSource(row.source)).toBe(row.statusDetailKey)
    expect(productTypeFromSource(row.source)).toBe(row.productType)
    expect(dtoKeyFromSource(row.source)).toBe(row.dtoKey)
  })

  it('cobre exatamente as cinco fontes de domínio', () => {
    expect(PLUGGY_SOURCES.slice().sort()).toEqual(
      ['ACCOUNTS', 'ACCOUNT_TRANSACTIONS', 'INVESTMENTS', 'INVESTMENT_TRANSACTIONS', 'LOANS'].sort(),
    )
  })

  it('produtos do SDK que não correspondem a nenhuma das cinco fontes voltam undefined', () => {
    expect(sourceFromProductType('IDENTITY')).toBeUndefined()
    expect(sourceFromProductType('CREDIT_CARDS')).toBeUndefined()
  })

  it('chaves de statusDetail que não correspondem a nenhuma das cinco fontes voltam undefined', () => {
    expect(sourceFromStatusDetailKey('identity')).toBeUndefined()
    expect(sourceFromStatusDetailKey('creditCards')).toBeUndefined()
  })

  it('a chave singular de investimento (productType) nunca é confundida com a chave de statusDetail', () => {
    // `INVESTMENTS_TRANSACTIONS` (productType, com S) não é uma chave de statusDetail válida.
    expect(sourceFromStatusDetailKey('INVESTMENTS_TRANSACTIONS')).toBeUndefined()
    // `investmentTransactions` (statusDetail) não é um productType válido.
    expect(sourceFromProductType('investmentTransactions')).toBeUndefined()
  })

  // Revisão do PR #14: ACCOUNTS é a única fonte com dois produtos de origem (GET /accounts devolve
  // BANK e CREDIT juntos, habilitados por ACCOUNTS e CREDIT_CARDS respectivamente).
  describe('discoveryProductTypesFor / discoveryStatusDetailKeysFor', () => {
    it('ACCOUNTS tem dois produtos de origem: ACCOUNTS e CREDIT_CARDS', () => {
      expect(discoveryProductTypesFor('ACCOUNTS')).toEqual(['ACCOUNTS', 'CREDIT_CARDS'])
      expect(discoveryStatusDetailKeysFor('ACCOUNTS')).toEqual(['accounts', 'creditCards'])
    })

    it.each(['ACCOUNT_TRANSACTIONS', 'INVESTMENTS', 'INVESTMENT_TRANSACTIONS', 'LOANS'] as PluggySource[])(
      '%s continua com um produto de origem só',
      (source) => {
        expect(discoveryProductTypesFor(source)).toEqual([productTypeFromSource(source)])
        expect(discoveryStatusDetailKeysFor(source)).toEqual([statusDetailKeyFromSource(source)])
      },
    )
  })
})
