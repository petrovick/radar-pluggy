import { describe, expect, it } from 'vitest'
import { PluggyHistorySyncState } from '../../src/entities/pluggy-history-sync-state.js'
import { ApplicationError } from '../../src/shared/application-error.js'

describe('PluggyHistorySyncState', () => {
  it('cria estado com sucesso com itemId e data', () => {
    const state = PluggyHistorySyncState.create({
      itemId: 'item-1',
      lastCompletedItemUpdatedAt: new Date('2026-09-03T10:00:00.000Z'),
    })

    expect(state.getItemId()).toBe('item-1')
    expect(state.getLastCompletedItemUpdatedAt()).toEqual(new Date('2026-09-03T10:00:00.000Z'))
  })

  it('recusa criação sem itemId', () => {
    expect(() =>
      PluggyHistorySyncState.create({
        itemId: '',
        lastCompletedItemUpdatedAt: new Date(),
      }),
    ).toThrowError(ApplicationError)
  })

  it('recusa criação sem lastCompletedItemUpdatedAt', () => {
    expect(() =>
      PluggyHistorySyncState.create({
        itemId: 'item-1',
        lastCompletedItemUpdatedAt: undefined as unknown as Date,
      }),
    ).toThrowError(ApplicationError)
  })

  it('recusa campo inesperado em runtime', () => {
    expect(() =>
      PluggyHistorySyncState.create({
        itemId: 'item-1',
        lastCompletedItemUpdatedAt: new Date(),
        extra: 123,
      } as unknown as Parameters<typeof PluggyHistorySyncState.create>[0]),
    ).toThrowError(ApplicationError)
  })
})
