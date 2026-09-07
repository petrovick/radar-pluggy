import { ApplicationError } from '../../../shared/application-error.js'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  ReadPluggyPositionGateway,
  ReadPluggyPositionInput,
  ReadPluggyPositionOutput,
} from './read-pluggy-position.types.js'

// Portfolio consolidado de uma pessoa, cruzando todas as instituições Pluggy conectadas
// (`GET /portfolio`) — leitura pura do que a sincronização já persistiu, nenhuma chamada à Pluggy
// aqui (fronteira-pluggy regra 6). Uma dependência só, o gateway do próprio caso de uso
// (arquitetura-camadas, regra 2).
export class ReadPluggyPositionInteractor {
  private readonly gateway: ReadPluggyPositionGateway

  constructor(params: AppContainer) {
    this.gateway = params.readPluggyPositionImpl
  }

  async execute(input: ReadPluggyPositionInput): Promise<ReadPluggyPositionOutput> {
    const { personId } = input
    this.gateway.addContext({ messageType: 'READ_PLUGGY_POSITION', personId })

    try {
      const itemIds = await this.gateway.readItemIdsForPerson(personId)
      if (itemIds.length === 0) {
        return { data: [] }
      }

      const positions = await this.gateway.readPositionsByItemIds(itemIds)
      return { data: positions }
    } catch (err) {
      this.gateway.logError('Erro inesperado na leitura do portfolio', { err })
      if (err instanceof ApplicationError) {
        return { error: err }
      }
      return { error: new ApplicationError('PLUGGY_POSITION_READ_FAILED', { personId }) }
    }
  }
}
