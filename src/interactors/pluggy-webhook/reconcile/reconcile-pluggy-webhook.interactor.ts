import { ApplicationError } from '../../../shared/application-error.js'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  ReconcilePluggyWebhookGateway,
  ReconcilePluggyWebhookInput,
  ReconcilePluggyWebhookOutput,
} from './reconcile-pluggy-webhook.types.js'

// Reconcilia o webhook de todas as credenciais do titular autenticado. Idempotente por desenho:
// rodar duas vezes seguidas não cria inscrição duplicada nem invalida a anterior sem substituí-la.
export class ReconcilePluggyWebhookInteractor {
  private readonly gateway: ReconcilePluggyWebhookGateway

  constructor(params: AppContainer) {
    this.gateway = params.reconcilePluggyWebhookImpl
  }

  async execute(input: ReconcilePluggyWebhookInput): Promise<ReconcilePluggyWebhookOutput> {
    this.gateway.addContext({ messageType: 'RECONCILE_PLUGGY_WEBHOOK', personId: input.personId })

    try {
      const states = await this.gateway.listCredentialWebhookStates(input.personId)
      let provisioned = 0
      let updated = 0
      let failed = 0

      // Falha numa credencial não aborta as outras: uma conta com `client_secret` revogado não pode
      // deixar as demais sem gatilho diário. O total de falhas volta no resultado, nomeado.
      for (const state of states) {
        try {
          await this.gateway.provisionWebhook(state.credentialId)
          if (state.provisioned) {
            updated++
          } else {
            provisioned++
          }
        } catch (err) {
          failed++
          this.gateway.logError('Falha ao provisionar webhook de uma credencial', {
            credentialId: state.credentialId,
            errorType: err instanceof ApplicationError ? err.errorType : 'UNEXPECTED',
          })
        }
      }

      this.gateway.logInfo('Reconciliação concluída', { provisioned, updated, failed })
      return { data: { provisioned, updated, failed } }
    } catch (err) {
      this.gateway.logError('Erro inesperado na reconciliação de webhooks', { err })
      if (err instanceof ApplicationError) {
        return { error: err }
      }
      return { error: new ApplicationError('PLUGGY_WEBHOOK_RECONCILIATION_FAILED') }
    }
  }
}
