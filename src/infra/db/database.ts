import { Sequelize } from 'sequelize'
import type { DatabaseConnectionConfig } from '../config/config.js'

// Recebe a conexão já validada por `infra/config.ts` — nenhum default aqui. Ausência de variável
// obrigatória recusa na subida, antes deste ponto ser alcançado (regra 6 do CLAUDE.md do
// workspace: dado obrigatório ausente é erro, nunca valor default).
export function createDatabaseConnection(config: DatabaseConnectionConfig): Sequelize {
  return new Sequelize({
    dialect: 'mysql',
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password: config.password,
    logging: false,
    dialectOptions: config.dialectOptions,
  })
}
