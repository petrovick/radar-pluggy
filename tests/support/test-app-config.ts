import { randomBytes } from 'node:crypto'
import type { Config } from '../../src/infra/config/config.js'
import { testDatabaseConfig } from './test-database-config.js'

// Configuração completa e válida para testes que resolvem o container inteiro
// (`setupContainer`) — nenhum destes valores é lido de verdade fora deste arquivo.
export function testAppConfig(): Config {
  return {
    port: 3003,
    jwtSecret: 'test-jwt-secret',
    webhookUrl: 'https://pluggy-connector.test/webhooks/pluggy',
    credentialEncryptionKey: randomBytes(32).toString('base64'),
    database: testDatabaseConfig(),
  }
}
