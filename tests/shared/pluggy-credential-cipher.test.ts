import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '../../src/shared/pluggy-credential-cipher.js'
import { ApplicationError } from '../../src/shared/application-error.js'

describe('pluggy-credential-cipher', () => {
  const key = randomBytes(32).toString('base64')

  it('decripta exatamente o que foi cifrado (round-trip)', () => {
    const cipherText = encryptSecret('segredo-da-application-pluggy', key)
    expect(decryptSecret(cipherText, key)).toBe('segredo-da-application-pluggy')
  })

  it('duas cifragens do mesmo segredo produzem textos cifrados diferentes (IV aleatório)', () => {
    const first = encryptSecret('mesmo-segredo', key)
    const second = encryptSecret('mesmo-segredo', key)
    expect(first).not.toBe(second)
  })

  it('recusa cifrar com chave vazia', () => {
    try {
      encryptSecret('segredo', '')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_CREDENTIAL_ENCRYPTION_KEY_MISSING')
    }
  })

  it('recusa decifrar com chave vazia', () => {
    const cipherText = encryptSecret('segredo', key)
    expect(() => decryptSecret(cipherText, '')).toThrow(ApplicationError)
  })
})
