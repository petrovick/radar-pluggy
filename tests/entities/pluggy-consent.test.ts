import { describe, expect, it } from 'vitest'
import { PluggyConsent, mostRecentConsent } from '../../src/entities/pluggy-consent.js'
import { ApplicationError } from '../../src/shared/application-error.js'

function consent(overrides: Partial<Parameters<typeof PluggyConsent.create>[0]> = {}) {
  return PluggyConsent.create({
    consentId: 'consent-1',
    itemId: 'item-1',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: undefined,
    revokedAt: undefined,
    products: undefined,
    openFinancePermissionsGranted: undefined,
    ...overrides,
  })
}

describe('PluggyConsent', () => {
  it('recusa criação sem consentId ou itemId', () => {
    expect(() => consent({ consentId: '' })).toThrow(ApplicationError)
    expect(() => consent({ itemId: '' })).toThrow(ApplicationError)
  })

  it('sem expiresAt e sem revokedAt está sempre ativo', () => {
    expect(consent().statusAt(new Date('2099-01-01T00:00:00.000Z'))).toBe('ACTIVE')
  })

  it('expiresAt no passado é EXPIRED; no futuro é ACTIVE', () => {
    const c = consent({ expiresAt: new Date('2026-06-01T00:00:00.000Z') })
    expect(c.statusAt(new Date('2026-05-01T00:00:00.000Z'))).toBe('ACTIVE')
    expect(c.statusAt(new Date('2026-07-01T00:00:00.000Z'))).toBe('EXPIRED')
    expect(c.statusAt(new Date('2026-06-01T00:00:00.000Z'))).toBe('EXPIRED')
  })

  it('revokedAt manda sobre expiresAt — revogado é REVOKED mesmo antes do prazo de expiração', () => {
    const c = consent({
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      revokedAt: new Date('2026-02-01T00:00:00.000Z'),
    })
    expect(c.statusAt(new Date('2026-03-01T00:00:00.000Z'))).toBe('REVOKED')
  })

  // Change pluggy-complete-data-capture, spec pluggy-consent: escopo autorizado, não só o prazo.
  it('aceita criação com products e openFinancePermissionsGranted presentes', () => {
    const c = consent({
      products: ['ACCOUNTS', 'INVESTMENTS'],
      openFinancePermissionsGranted: ['ACCOUNTS_READ', 'INVESTMENTS_READ'],
    })
    expect(c.getProducts()).toEqual(['ACCOUNTS', 'INVESTMENTS'])
    expect(c.getOpenFinancePermissionsGranted()).toEqual(['ACCOUNTS_READ', 'INVESTMENTS_READ'])
  })

  it('consentimento sem products/permissions mantém os dois indefinidos', () => {
    const c = consent()
    expect(c.getProducts()).toBeUndefined()
    expect(c.getOpenFinancePermissionsGranted()).toBeUndefined()
  })
})

describe('mostRecentConsent', () => {
  it('devolve undefined para lista vazia', () => {
    expect(mostRecentConsent([])).toBeUndefined()
  })

  it('escolhe o consentimento com grantedAt mais recente, não a ordem da lista', () => {
    const older = consent({ consentId: 'consent-old', grantedAt: new Date('2025-01-01T00:00:00.000Z') })
    const newer = consent({ consentId: 'consent-new', grantedAt: new Date('2026-01-01T00:00:00.000Z') })

    expect(mostRecentConsent([newer, older])?.getConsentId()).toBe('consent-new')
    expect(mostRecentConsent([older, newer])?.getConsentId()).toBe('consent-new')
  })
})
