import { ApplicationError } from '../../../shared/application-error.js'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  CheckPluggyCredentialGateway,
  CheckPluggyCredentialInput,
  CheckPluggyCredentialOutput,
} from './check-pluggy-credential.types.js'

// Implementa o requisito "Credencial ou itemId ausente é recusa nomeada" do spec pluggy-credentials:
// nomeia a pessoa e o que exatamente falta — nunca segue sem autenticação, nunca com valor default.
// Checa se a pessoa tem credencial com ao menos um itemId vinculado (pronta para sincronizar); não
// verifica nada além disso.
//
// Consumido por `GET /credentials/status` (expor-status-credencial-pluggy) — o handler traduz os
// dois erros nomeados abaixo em `hasCredential:false` (200), nunca repassa como erro HTTP. As
// recusas do `PluggyItemCredentialResolver` NÃO substituem este interactor: elas nomeiam `itemId`
// (`PLUGGY_CREDENTIAL_ITEM_NOT_LINKED`), que é a resolução item→credencial, um caminho diferente.
// Sucesso continua `data: {}` — devolver itemIds aqui seria inventar payload sem consumidor.
export class CheckPluggyCredentialInteractor {
  private readonly gateway: CheckPluggyCredentialGateway

  constructor(params: AppContainer) {
    this.gateway = params.checkPluggyCredentialImpl
  }

  async execute(input: CheckPluggyCredentialInput): Promise<CheckPluggyCredentialOutput> {
    const { personId } = input
    this.gateway.addContext({ messageType: 'CHECK_PLUGGY_CREDENTIAL', personId })

    try {
      const credentialIds = await this.gateway.readCredentialIds(personId)
      if (credentialIds.length === 0) {
        return { error: new ApplicationError('PLUGGY_CREDENTIAL_NOT_FOUND_FOR_PERSON', { personId }) }
      }

      const itemIds = await this.gateway.readLinkedItemIds(credentialIds)
      if (itemIds.length === 0) {
        return { error: new ApplicationError('PLUGGY_CREDENTIAL_ITEM_ID_NOT_FOUND_FOR_PERSON', { personId }) }
      }

      return { data: {} }
    } catch (err) {
      this.gateway.logError('Erro inesperado na checagem de credencial', { err })
      if (err instanceof ApplicationError) {
        return { error: err }
      }
      return { error: new ApplicationError('PLUGGY_CREDENTIAL_CHECK_FAILED', { personId }) }
    }
  }
}
