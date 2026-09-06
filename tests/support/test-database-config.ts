import type { DatabaseConnectionConfig } from '../../src/infra/config/config.js'

// Conexão exclusiva contra base de teste isolada (com sufixo obrigatório "_test").
// Impede ativamente qualquer conexão acidental contra bancos de desenvolvimento ou produção.
export function testDatabaseConfig(): DatabaseConnectionConfig {
  const database = process.env.MYSQL_DATABASE || 'oplab_radar_test'

  if (!database || database === 'oplab_radar' || !database.endsWith('_test')) {
    throw new Error(
      `[SEGURANÇA] Conexão de teste recusada: o banco "${database}" não é isolado para testes. A variável MYSQL_DATABASE deve terminar obrigatoriamente com o sufixo "_test" (ex: "oplab_radar_test").`,
    )
  }

  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    database,
    username: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '12345678',
    dialectOptions: {},
  }
}
