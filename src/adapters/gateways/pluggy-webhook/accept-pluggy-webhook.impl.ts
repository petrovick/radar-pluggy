import { timingSafeEqual } from 'node:crypto'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type { AcceptPluggyWebhookGateway } from '../../../interactors/pluggy-webhook/accept/accept-pluggy-webhook.types.js'
import DefaultInteractorGatewayImpl from '../default-gateway.impl.js'
import type { PluggyItemCredentialResolver } from '../pluggy-item-credential.resolver.js'
import type { PluggyWebhookEventRep } from '../../repositories/pluggy-webhook-event.rep.js'

// Gateway do caso de uso `accept-pluggy-webhook`. Concentra o mecanismo: resolução do vínculo
// item→credencial já persistido e a comparação do segredo em tempo constante.
export default class AcceptPluggyWebhookImpl
  extends DefaultInteractorGatewayImpl
  implements AcceptPluggyWebhookGateway
{
  private readonly pluggyItemCredentialResolver: PluggyItemCredentialResolver
  private readonly pluggyWebhookEventRep: PluggyWebhookEventRep

  constructor(params: AppContainer) {
    super(params)
    this.pluggyItemCredentialResolver = params.pluggyItemCredentialResolver
    this.pluggyWebhookEventRep = params.pluggyWebhookEventRep
  }

  // Resolve SOMENTE vínculo já persistido (design.md D7): item desconhecido não é confiável, e não
  // se inventa dono a partir do payload. `findCredentialFor` é a variante que não lança — aqui item
  // sem vínculo e assinatura inválida precisam ser indistinguíveis para quem chamou. Comparação em
  // tempo constante (W1) — igualdade com `===` vazaria o segredo por timing.
  async isTrustedNotification(itemId: string, providedSecret: string): Promise<boolean> {
    const credential = await this.pluggyItemCredentialResolver.findCredentialFor(itemId)
    const webhook = credential?.getWebhook()
    if (!webhook) {
      // Credencial sem webhook provisionado não tem segredo com que comparar: recusa, nunca aceita
      // "porque não há segredo configurado".
      return false
    }

    return secretsMatch(webhook.secret, providedSecret)
  }

  async enqueueEvent(input: { eventId: string; itemId: string; event: string }): Promise<{ alreadyKnown: boolean }> {
    const { alreadyKnown } = await this.pluggyWebhookEventRep.enqueue(input)
    return { alreadyKnown }
  }
}

function secretsMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const providedBuffer = Buffer.from(provided, 'utf8')

  // `timingSafeEqual` exige buffers do mesmo tamanho; comparar o tamanho antes vaza só o tamanho,
  // não o conteúdo — é o mesmo padrão do exemplo em `fronteira-pluggy`, regra 9.
  if (expectedBuffer.length !== providedBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, providedBuffer)
}
