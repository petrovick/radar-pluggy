import type { ApplicationError } from '../../../shared/application-error.js'
import type { DefaultGateway } from '../../default/default-gateway.js'

// Recebimento de uma notificação da Pluggy. O caso de uso decide se a notificação é confiável e se o
// evento entra na fila; o COMO (comparação em tempo constante, cifra do segredo, constraint de
// unicidade) é mecanismo e fica no impl.
//
// O payload é gatilho, não dado (design.md W3/fronteira-pluggy 8): daqui só saem identificadores
// para a fila. Nada do corpo da requisição é usado como verdade sobre o item.

export interface AcceptPluggyWebhookGateway extends DefaultGateway {
  // Confiança é por credencial daquele item, não um segredo único de processo (arquitetura-camadas,
  // seção 4): item sem vínculo persistido não é confiável, e não recebe dono por inferência.
  isTrustedNotification(itemId: string, providedSecret: string): Promise<boolean>
  enqueueEvent(input: { eventId: string; itemId: string; event: string }): Promise<{ alreadyKnown: boolean }>
}

export type AcceptPluggyWebhookInput = {
  eventId: string
  itemId: string
  event: string
  providedSecret: string
}

export type AcceptPluggyWebhookResult = {
  accepted: boolean
  alreadyKnown: boolean
}

export type AcceptPluggyWebhookOutput = {
  data?: AcceptPluggyWebhookResult
  error?: ApplicationError
}
