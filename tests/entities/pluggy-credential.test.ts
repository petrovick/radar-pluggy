import { describe, expect, it } from 'vitest'
import { PluggyCredential } from '../../src/entities/pluggy-credential.js'
import { ApplicationError } from '../../src/shared/application-error.js'

describe('PluggyCredential', () => {
  it('recusa criação sem personId', () => {
    try {
      PluggyCredential.create({ personId: undefined, clientId: 'client-1', clientSecret: 'segredo' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_CREDENTIAL_PERSON_ID_MISSING')
    }
  })

  it('recusa criação sem clientId', () => {
    try {
      PluggyCredential.create({ personId: 1, clientId: '', clientSecret: 'segredo' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_CREDENTIAL_CLIENT_ID_MISSING')
    }
  })

  it('recusa criação sem clientSecret', () => {
    try {
      PluggyCredential.create({ personId: 1, clientId: 'client-1', clientSecret: '' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_CREDENTIAL_CLIENT_SECRET_MISSING')
    }
  })

  it('aceita criação válida, sem id (ainda não persistida)', () => {
    const credential = PluggyCredential.create({ personId: 1, clientId: 'client-1', clientSecret: 'segredo' })
    expect(credential.getId()).toBeUndefined()
    expect(credential.getPersonId()).toBe(1)
    expect(credential.getClientId()).toBe('client-1')
    expect(credential.getClientSecret()).toBe('segredo')
  })

  it('recusa em runtime um campo inesperado vindo de fora do tipo estático, nomeando o campo', () => {
    const externalPayload: Record<string, unknown> = {
      personId: 1,
      clientId: 'client-1',
      clientSecret: 'segredo',
      itemId: 'item-1',
    }

    try {
      PluggyCredential.create(externalPayload as unknown as Parameters<typeof PluggyCredential.create>[0])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_CREDENTIAL_UNEXPECTED_FIELD')
      expect((error as ApplicationError).details).toMatchObject({ fields: ['itemId'] })
    }
  })

  it('reconstitute expõe o id persistido', () => {
    const credential = PluggyCredential.reconstitute({
      id: 42,
      personId: 1,
      clientId: 'client-1',
      clientSecret: 'segredo',
    })
    expect(credential.getId()).toBe(42)
  })
})
