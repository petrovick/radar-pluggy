import { describe, expect, it } from 'vitest'
import { enabledForItem, isEligible, isUsable, toSourceState, toVersionAt } from '../../../src/adapters/gateways/pluggy-source-state.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

function itemWith(executionStatus: string, accountsIsUpdated?: boolean, accountsLastUpdatedAt?: string) {
  return {
    executionStatus,
    products: accountsIsUpdated === undefined ? {} : { accounts: { isUpdated: accountsIsUpdated, lastUpdatedAt: accountsLastUpdatedAt, warnings: [] } },
  }
}

describe('pluggy-source-state', () => {
  it('SUCCESS libera a fonte, isUpdated !== true em PARTIAL_SUCCESS recusa (D6)', () => {
    expect(toSourceState(itemWith('SUCCESS'), 'ACCOUNTS').isUsable).toBe(true)
    expect(toSourceState(itemWith('PARTIAL_SUCCESS', true, '2026-08-01T00:00:00.000Z'), 'ACCOUNTS').isUsable).toBe(true)
    expect(toSourceState(itemWith('PARTIAL_SUCCESS', false, undefined), 'ACCOUNTS').isUsable).toBe(false)
    expect(toSourceState(itemWith('PARTIAL_SUCCESS'), 'ACCOUNTS').isUsable).toBe(false)
    expect(isUsable(itemWith('UPDATING' as never), 'ACCOUNTS')).toBe(false)
  })

  it('outro executionStatus (nem SUCCESS nem PARTIAL_SUCCESS) nunca é utilizável', () => {
    expect(isUsable(itemWith('LOGIN_ERROR'), 'ACCOUNTS')).toBe(false)
  })

  describe('enabledForItem / isEligible (D26)', () => {
    it('produto habilitado no Item é elegível', () => {
      expect(enabledForItem(['ACCOUNTS', 'TRANSACTIONS'], 'ACCOUNTS')).toBe(true)
      expect(isEligible(['ACCOUNTS', 'TRANSACTIONS'], 'ACCOUNTS')).toBe(true)
    })

    it('connector suporta mas o Item não pediu: nunca elegível, mesmo sem marca d’água prévia', () => {
      expect(enabledForItem(['ACCOUNTS', 'TRANSACTIONS'], 'INVESTMENTS')).toBe(false)
      expect(isEligible(['ACCOUNTS', 'TRANSACTIONS'], 'INVESTMENTS')).toBe(false)
    })

    it('itemProducts UNKNOWN (undefined) nunca vira elegibilidade por omissão', () => {
      expect(enabledForItem(undefined, 'ACCOUNTS')).toBeUndefined()
      expect(isEligible(undefined, 'ACCOUNTS')).toBe(false)
    })

    // Revisão do PR #14: CREDIT_CARDS é o segundo produto de origem de ACCOUNTS — GET /accounts
    // devolve conta BANK e CREDIT juntas, e um Item pode ter só CREDIT_CARDS habilitado.
    it('CREDIT_CARDS habilitado, sem ACCOUNTS: ACCOUNTS ainda é elegível', () => {
      expect(enabledForItem(['CREDIT_CARDS', 'TRANSACTIONS'], 'ACCOUNTS')).toBe(true)
      expect(isEligible(['CREDIT_CARDS', 'TRANSACTIONS'], 'ACCOUNTS')).toBe(true)
    })

    it('nem ACCOUNTS nem CREDIT_CARDS habilitado: ACCOUNTS não é elegível', () => {
      expect(enabledForItem(['TRANSACTIONS'], 'ACCOUNTS')).toBe(false)
      expect(isEligible(['TRANSACTIONS'], 'ACCOUNTS')).toBe(false)
    })
  })

  describe('CREDIT_CARDS como segundo produto de origem de ACCOUNTS (revisão do PR #14)', () => {
    function itemWithCreditCards(executionStatus: string, isUpdated?: boolean, lastUpdatedAt?: string) {
      return {
        executionStatus,
        products: isUpdated === undefined ? {} : { creditCards: { isUpdated, lastUpdatedAt, warnings: [] } },
      }
    }

    it('PARTIAL_SUCCESS com só creditCards presente (sem accounts): utilizável quando creditCards está atualizado', () => {
      const item = itemWithCreditCards('PARTIAL_SUCCESS', true, '2026-08-05T00:00:00.000Z')
      expect(toSourceState(item, 'ACCOUNTS')).toEqual({ isUsable: true, lastUpdatedAt: '2026-08-05T00:00:00.000Z' })
    })

    it('PARTIAL_SUCCESS com só creditCards presente e não atualizado: não utilizável', () => {
      const item = itemWithCreditCards('PARTIAL_SUCCESS', false)
      expect(toSourceState(item, 'ACCOUNTS').isUsable).toBe(false)
    })

    it('PARTIAL_SUCCESS com accounts E creditCards, só um atualizado: fonte inteira não utilizável', () => {
      const item = {
        executionStatus: 'PARTIAL_SUCCESS',
        products: {
          accounts: { isUpdated: true, lastUpdatedAt: '2026-08-01T00:00:00.000Z', warnings: [] },
          creditCards: { isUpdated: false, lastUpdatedAt: undefined, warnings: [] },
        },
      }
      expect(toSourceState(item, 'ACCOUNTS').isUsable).toBe(false)
    })

    it('PARTIAL_SUCCESS com accounts E creditCards, ambos atualizados: versão é a mais recente das duas', () => {
      const item = {
        executionStatus: 'PARTIAL_SUCCESS',
        products: {
          accounts: { isUpdated: true, lastUpdatedAt: '2026-08-01T00:00:00.000Z', warnings: [] },
          creditCards: { isUpdated: true, lastUpdatedAt: '2026-08-10T00:00:00.000Z', warnings: [] },
        },
      }
      expect(toSourceState(item, 'ACCOUNTS')).toEqual({ isUsable: true, lastUpdatedAt: '2026-08-10T00:00:00.000Z' })
    })

    it('toVersionAt com só creditCards presente grava statusDetail.creditCards.lastUpdatedAt', () => {
      const item = { ...itemWithCreditCards('PARTIAL_SUCCESS', true, '2026-08-05T00:00:00.000Z'), lastUpdatedAt: undefined, updatedAt: '2026-07-01T00:00:00.000Z' }
      expect(toVersionAt(item, 'ACCOUNTS', 'item-1')).toEqual(new Date('2026-08-05T00:00:00.000Z'))
    })
  })

  describe('toVersionAt', () => {
    it('SUCCESS grava Item.lastUpdatedAt quando presente', () => {
      const item = { ...itemWith('SUCCESS'), lastUpdatedAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' }
      expect(toVersionAt(item, 'ACCOUNTS', 'item-1')).toEqual(new Date('2026-08-01T00:00:00.000Z'))
    })

    it('SUCCESS sem lastUpdatedAt cai para Item.updatedAt (D27)', () => {
      const item = { ...itemWith('SUCCESS'), lastUpdatedAt: undefined, updatedAt: '2026-07-01T00:00:00.000Z' }
      expect(toVersionAt(item, 'ACCOUNTS', 'item-1')).toEqual(new Date('2026-07-01T00:00:00.000Z'))
    })

    it('PARTIAL_SUCCESS com fonte utilizável grava statusDetail.<fonte>.lastUpdatedAt', () => {
      const item = {
        ...itemWith('PARTIAL_SUCCESS', true, '2026-08-05T00:00:00.000Z'),
        lastUpdatedAt: undefined,
        updatedAt: '2026-07-01T00:00:00.000Z',
      }
      expect(toVersionAt(item, 'ACCOUNTS', 'item-1')).toEqual(new Date('2026-08-05T00:00:00.000Z'))
    })

    it('PARTIAL_SUCCESS com fonte não coletada não avança (undefined), mesmo com lastUpdatedAt antigo presente', () => {
      const item = {
        ...itemWith('PARTIAL_SUCCESS', false, '2026-01-01T00:00:00.000Z'),
        lastUpdatedAt: undefined,
        updatedAt: '2026-07-01T00:00:00.000Z',
      }
      expect(toVersionAt(item, 'ACCOUNTS', 'item-1')).toBeUndefined()
    })

    it('PARTIAL_SUCCESS com isUpdated true e lastUpdatedAt ausente recusa nomeado, nunca inventa valor', () => {
      const item = {
        ...itemWith('PARTIAL_SUCCESS', true, undefined),
        lastUpdatedAt: undefined,
        updatedAt: '2026-07-01T00:00:00.000Z',
      }
      try {
        toVersionAt(item, 'ACCOUNTS', 'item-1')
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(ApplicationError)
        expect((error as ApplicationError).errorType).toBe('PLUGGY_ITEM_PRODUCT_UPDATED_WITHOUT_LAST_UPDATED_AT')
        expect((error as ApplicationError).details).toMatchObject({ itemId: 'item-1', source: 'ACCOUNTS' })
      }
    })

    it('executionStatus fora de SUCCESS/PARTIAL_SUCCESS nunca grava versão', () => {
      const item = { ...itemWith('LOGIN_ERROR'), lastUpdatedAt: undefined, updatedAt: '2026-07-01T00:00:00.000Z' }
      expect(toVersionAt(item, 'ACCOUNTS', 'item-1')).toBeUndefined()
    })
  })
})
