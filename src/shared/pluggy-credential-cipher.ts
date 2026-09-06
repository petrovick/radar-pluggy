import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { ApplicationError } from './application-error.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH_BYTES = 12

// Exportado para `infra/config/config.ts` conferir a chave na subida do processo com o mesmo
// número que a guarda abaixo usa no ponto de uso — dois lugares checando a mesma regra, um só
// valor.
export const CREDENTIAL_ENCRYPTION_KEY_LENGTH_BYTES = 32

// Cifra os segredos da credencial na fronteira de escrita/leitura, nunca texto plano no banco:
// `client_secret` (saída, dá acesso a dado bancário de terceiro — design.md D6) e `webhook_secret`
// (entrada, autentica a notificação recebida — D7). Mesmo formato `iv:authTag:ciphertext`.
// `encodedKey` é responsabilidade do chamador (vem do container, `AppContainer.credentialEncryptionKey`,
// já resolvido por `infra/config/config.ts`) — esta função nunca lê `process.env` sozinha.
export function encryptSecret(plainText: string, encodedKey: string): string {
  const key = getEncryptionKey(encodedKey)
  const iv = randomBytes(IV_LENGTH_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv, authTag, encrypted].map((buffer) => buffer.toString('base64')).join(':')
}

export function decryptSecret(cipherText: string, encodedKey: string): string {
  const key = getEncryptionKey(encodedKey)
  const [ivBase64, authTagBase64, encryptedBase64] = cipherText.split(':')
  if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
    throw new ApplicationError('PLUGGY_CREDENTIAL_CIPHERTEXT_MALFORMED')
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivBase64, 'base64'))
  decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedBase64, 'base64')), decipher.final()])
  return decrypted.toString('utf8')
}

// Guarda repetida de propósito (`CREDENTIAL_ENCRYPTION_KEY_LENGTH_BYTES` é o mesmo número que
// `config.ts` já checou no boot): defesa em profundidade no ponto de uso real, não confia cegamente
// que todo chamador passou por `loadConfig()`.
function getEncryptionKey(encoded: string): Buffer {
  if (!encoded) {
    throw new ApplicationError('PLUGGY_CREDENTIAL_ENCRYPTION_KEY_MISSING')
  }

  const key = Buffer.from(encoded, 'base64')
  if (key.length !== CREDENTIAL_ENCRYPTION_KEY_LENGTH_BYTES) {
    throw new ApplicationError('PLUGGY_CREDENTIAL_ENCRYPTION_KEY_INVALID_LENGTH', { actualLength: key.length })
  }

  return key
}
