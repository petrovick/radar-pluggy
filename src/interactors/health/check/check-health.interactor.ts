import { ApplicationError } from '../../../shared/application-error.js'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type { CheckHealthGateway, CheckHealthOutput } from './check-health.types.js'

// Sem entrada: a pergunta é sempre a mesma, "o processo alcança o banco agora?" — nada no pedido
// varia por chamador. Uma dependência só, o gateway do próprio caso de uso (arquitetura-camadas,
// regra 2).
export class CheckHealthInteractor {
  private readonly gateway: CheckHealthGateway

  constructor(params: AppContainer) {
    this.gateway = params.checkHealthImpl
  }

  async execute(): Promise<CheckHealthOutput> {
    this.gateway.addContext({ messageType: 'CHECK_HEALTH' })

    try {
      await this.gateway.checkDatabaseConnection()
      return { data: { running: true } }
    } catch (err) {
      this.gateway.logError('Banco indisponível na checagem de saúde', { err })
      return { error: new ApplicationError('PLUGGY_CONNECTOR_DATABASE_UNAVAILABLE') }
    }
  }
}
