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
