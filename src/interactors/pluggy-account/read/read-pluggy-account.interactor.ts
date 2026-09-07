import { ApplicationError } from '../../../shared/application-error.js'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  ReadPluggyAccountGateway,
  ReadPluggyAccountInput,
  ReadPluggyAccountOutput,
} from './read-pluggy-account.types.js'

// Contas (depósito e cartão) de uma pessoa, cruzando todas as instituições Pluggy conectadas
// (`GET /accounts`) — leitura pura do que a sincronização já persistiu, nenhuma chamada à Pluggy
// aqui (fronteira-pluggy regra 6). Uma dependência só, o gateway do próprio caso de uso
// (arquitetura-camadas, regra 2).
export class ReadPluggyAccountInteractor {
  private readonly gateway: ReadPluggyAccountGateway

  constructor(params: AppContainer) {
    this.gateway = params.readPluggyAccountImpl
  }

  async execute(input: ReadPluggyAccountInput): Promise<ReadPluggyAccountOutput> {
    const { personId } = input
    this.gateway.addContext({ messageType: 'READ_PLUGGY_ACCOUNT', personId })

    try {
      const itemIds = await this.gateway.readItemIdsForPerson(personId)
      if (itemIds.length === 0) {
        return { data: [] }
      }

      const accounts = await this.gateway.readAccountsByItemIds(itemIds)
      return { data: accounts }
    } catch (err) {
      this.gateway.logError('Erro inesperado na leitura de contas', { err })
      if (err instanceof ApplicationError) {
        return { error: err }
      }
      return { error: new ApplicationError('PLUGGY_ACCOUNT_READ_FAILED', { personId }) }
    }
  }
}
