import { describe, expect, it } from 'vitest'
import { PluggyItem } from '../../src/entities/pluggy-item.js'
import { ApplicationError } from '../../src/shared/application-error.js'

describe('PluggyItem', () => {
  it('recusa criação sem personId, nomeando o item afetado', () => {
    expect(() => PluggyItem.create({ itemId: 'item-1', personId: undefined, status: 'UPDATED' })).toThrow(
      ApplicationError,
    )
    try {
      PluggyItem.create({ itemId: 'item-1', personId: undefined, status: 'UPDATED' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_ITEM_PERSON_ID_MISSING')
      expect((error as ApplicationError).details).toMatchObject({ itemId: 'item-1' })
    }
  })

  it('recusa status fora do conjunto documentado pela Pluggy, nomeando o valor recebido', () => {
    try {
      PluggyItem.create({ itemId: 'item-1', personId: 1, status: 'NAO_EXISTE_NA_PLUGGY' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_ITEM_STATUS_UNKNOWN')
      expect((error as ApplicationError).details).toMatchObject({ status: 'NAO_EXISTE_NA_PLUGGY' })
    }
  })

  it('aceita cada um dos 7 valores documentados de status', () => {
    for (const status of [
      'UPDATING',
      'LOGIN_ERROR',
      'OUTDATED',
      'WAITING_USER_INPUT',
      'WAITING_USER_ACTION',
      'MERGING',
      'UPDATED',
    ]) {
      const item = PluggyItem.create({ itemId: 'item-1', personId: 1, status })
      expect(item.getStatus()).toBe(status)
    }
  })

  it('updateStatus recusa transição para status desconhecido', () => {
    const item = PluggyItem.create({ itemId: 'item-1', personId: 1, status: 'UPDATING' })
    expect(() => item.updateStatus('QUALQUER_COISA', undefined)).toThrow(ApplicationError)
    expect(item.getStatus()).toBe('UPDATING')
  })

  it('advanceWatermark aceita avanço e recusa retrocesso', () => {
    const item = PluggyItem.create({ itemId: 'item-1', personId: 1, status: 'UPDATED' })
    const first = new Date('2026-08-01T00:00:00.000Z')
    const earlier = new Date('2026-07-01T00:00:00.000Z')

    item.advanceWatermark(first)
    expect(item.getLastUpdatedAt()).toEqual(first)

    expect(() => item.advanceWatermark(earlier)).toThrow(ApplicationError)
    expect(item.getLastUpdatedAt()).toEqual(first)
  })

  it('nunca expõe campo de credencial — o compilador já recusa o objeto-literal', () => {
    expect(() => {
      // @ts-expect-error PluggyItem.create não aceita clientSecret: a forma pública da entidade
      // nunca inclui credencial (spec: "Credencial da Pluggy nunca é persistida por este registro").
      PluggyItem.create({ itemId: 'item-1', personId: 1, status: 'UPDATED', clientSecret: 'segredo' })
    }).toThrow(ApplicationError)

    const item = PluggyItem.create({ itemId: 'item-1', personId: 1, status: 'UPDATED' })
    expect(item).not.toHaveProperty('clientSecret')
    expect(item).not.toHaveProperty('clientId')
  })

  it('recusa em runtime um campo de credencial vindo de fora do tipo estático, nomeando o campo', () => {
    // Simula o caso que o excess-property check do TS não pega: um objeto montado em runtime
    // (ex.: espalhado de um payload externo), não um literal inline.
    const externalPayload: Record<string, unknown> = {
      itemId: 'item-1',
      personId: 1,
      status: 'UPDATED',
      clientSecret: 'segredo',
    }

    try {
      PluggyItem.create(externalPayload as unknown as Parameters<typeof PluggyItem.create>[0])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_ITEM_UNEXPECTED_FIELD')
      expect((error as ApplicationError).details).toMatchObject({ fields: ['clientSecret'] })
    }
  })
})
