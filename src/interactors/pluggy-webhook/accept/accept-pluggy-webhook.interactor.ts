import { ApplicationError } from '../../../shared/application-error.js'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  AcceptPluggyWebhookGateway,
  AcceptPluggyWebhookInput,
  AcceptPluggyWebhookOutput,
} from './accept-pluggy-webhook.types.js'

// Aceita (ou recusa) uma notificação da Pluggy e a põe na fila. Só isso: processar é outro caso de
// uso, disparado depois da resposta — a Pluggy exige 2xx em menos de 5 segundos, e responder rápido
// só é seguro porque o evento já está persistido quando a resposta sai (design.md D7).
export class AcceptPluggyWebhookInteractor {
  private readonly gateway: AcceptPluggyWebhookGateway

  constructor(params: AppContainer) {
    this.gateway = params.acceptPluggyWebhookImpl
  }

  async execute(input: AcceptPluggyWebhookInput): Promise<AcceptPluggyWebhookOutput> {
    const { eventId, itemId, event, providedSecret } = input
    this.gateway.addContext({ messageType: 'ACCEPT_PLUGGY_WEBHOOK', itemId, event })

    try {
      if (eventId.trim().length === 0) {
        return { error: new ApplicationError('PLUGGY_WEBHOOK_EVENT_ID_MISSING') }
      }
      if (itemId.trim().length === 0) {
        return { error: new ApplicationError('PLUGGY_WEBHOOK_EVENT_ITEM_ID_MISSING') }
      }

      // Assinatura inválida e item desconhecido devolvem a MESMA recusa, de propósito: distinguir as
      // duas na resposta contaria a quem chamou se aquele itemId existe aqui.
      if (!(await this.gateway.isTrustedNotification(itemId, providedSecret))) {
        this.gateway.logWarn('Notificação recusada: assinatura inválida ou item sem vínculo')
        return { error: new ApplicationError('PLUGGY_WEBHOOK_NOT_TRUSTED') }
      }

      const { alreadyKnown } = await this.gateway.enqueueEvent({ eventId, itemId, event })
      this.gateway.logInfo('Notificação aceita', { alreadyKnown })

      // Reentrega do mesmo evento é normal (até 9 vezes) e também é aceita: o 2xx confirma que já
      // temos o evento, e a unicidade no banco garante que ele só será processado uma vez.
      return { data: { accepted: true, alreadyKnown } }
    } catch (err) {
      this.gateway.logError('Erro inesperado ao aceitar notificação', { err })
      if (err instanceof ApplicationError) {
        return { error: err }
      }
      return { error: new ApplicationError('PLUGGY_WEBHOOK_ACCEPT_FAILED', { itemId }) }
    }
  }
}
