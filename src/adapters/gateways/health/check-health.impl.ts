import type { CheckHealthGateway } from '../../../interactors/health/check/check-health.types.js'
import { DB_NAMES } from '../../../infra/db/models.js'
import DefaultInteractorGatewayImpl from '../default-gateway.impl.js'

// Gateway do caso de uso `check-health`. Nenhum repositório: a pergunta é sobre a conexão em si,
// não sobre uma tabela — `SELECT 1` é o mesmo ping que o `oplab-radar-api` usa no dele.
export default class CheckHealthImpl extends DefaultInteractorGatewayImpl implements CheckHealthGateway {
  async checkDatabaseConnection(): Promise<void> {
    const main = this.db.connections[DB_NAMES.MAIN]
    if (!main) {
      throw new Error(`conexão "${DB_NAMES.MAIN}" não registrada em db.connections`)
    }
    await main.query('SELECT 1', { type: 'SELECT' })
  }
}
