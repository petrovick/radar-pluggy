import { describe, expect, it } from 'vitest'
import { PluggySyncProgress } from '../../src/entities/pluggy-sync-progress.js'
import { ApplicationError } from '../../src/shared/application-error.js'

describe('PluggySyncProgress', () => {
  it('cria com consumer e source válidos', () => {
    const progress = PluggySyncProgress.create({
      itemId: 'item-1',
      consumer: 'POSITION_SYNC',
      source: 'INVESTMENTS',
      lastCompletedVersionAt: new Date('2026-08-01T00:00:00.000Z'),
    })

    expect(progress.getConsumer()).toBe('POSITION_SYNC')
    expect(progress.getSource()).toBe('INVESTMENTS')
  })

  it('recusa consumer fora do vocabulário fechado', () => {
    expect(() =>
      PluggySyncProgress.create({
        itemId: 'item-1',
        consumer: 'NAO_EXISTE',
        source: 'INVESTMENTS',
        lastCompletedVersionAt: new Date(),
      }),
    ).toThrow(ApplicationError)
  })

  it('recusa source fora do vocabulário fechado', () => {
    expect(() =>
      PluggySyncProgress.create({
        itemId: 'item-1',
        consumer: 'POSITION_SYNC',
        source: 'CASH',
        lastCompletedVersionAt: new Date(),
      }),
    ).toThrow(ApplicationError)
  })

  it('advance aceita avanço e retrocesso lança sem alterar o valor', () => {
    const progress = PluggySyncProgress.create({
      itemId: 'item-1',
      consumer: 'HISTORY_LOAD',
      source: 'ACCOUNTS',
      lastCompletedVersionAt: new Date('2026-08-01T00:00:00.000Z'),
    })

    progress.advance(new Date('2026-08-02T00:00:00.000Z'))
    expect(progress.getLastCompletedVersionAt()).toEqual(new Date('2026-08-02T00:00:00.000Z'))

    expect(() => progress.advance(new Date('2026-07-01T00:00:00.000Z'))).toThrow(ApplicationError)
    expect(progress.getLastCompletedVersionAt()).toEqual(new Date('2026-08-02T00:00:00.000Z'))
  })
})
