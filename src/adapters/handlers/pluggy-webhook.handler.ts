import type { Request, Response } from 'express'
import type { AppContainerInstance } from '../../infra/bootstrap/register.js'
import type { ScopedRequest } from '../../infra/http/middleware/request-scope.middleware.js'
import { WEBHOOK_SECRET_HEADER } from '../gateways/pluggy-webhook.provisioner.js'

interface PluggyWebhookBody {
  eventId?: unknown
  itemId?: unknown
  event?: unknown
}

// Recusas que são culpa do PAYLOAD, e só elas, respondem 4xx. Qualquer outra coisa é falha nossa e
// responde 5xx, porque 4xx diz à Pluggy "não tente de novo": um banco oscilando por 30 segundos
// perderia os eventos daquela janela em silêncio, sem nunca chegar à inbox durável — a recusa
// acontece ANTES de o evento ser persistido. O default é 5xx de propósito: recusa nova que apareça
// no caso de uso é retentável até alguém decidir o contrário, o que é o lado seguro de errar.
const PAYLOAD_ERROR_TYPES = new Set(['PLUGGY_WEBHOOK_EVENT_ID_MISSING', 'PLUGGY_WEBHOOK_EVENT_ITEM_ID_MISSING'])

// Único ponto de entrada não autenticado por JWT do serviço: quem autentica é o segredo de entrada
// daquela credencial, comparado em tempo constante dentro do caso de uso (design.md W1).
//
// Responde 2xx só DEPOIS de o evento estar persistido na inbox, e dispara a drenagem em background —
// a Pluggy exige reconhecimento em menos de 5 segundos, e a carga histórica não cabe nisso (D7).
// O payload é gatilho, nunca dado: daqui só saem identificadores.
export function createPluggyWebhookHandler(
  container: AppContainerInstance,
  drain: (container: AppContainerInstance) => void,
) {
  return async function pluggyWebhook(req: Request & ScopedRequest, res: Response): Promise<void> {
    try {
      if (req.container === undefined) {
        res.status(500).json({ errorType: 'PLUGGY_CONNECTOR_UNEXPECTED_ERROR' })
        return
      }

      const body = req.body as PluggyWebhookBody
      const providedSecret = req.headers[WEBHOOK_SECRET_HEADER]

      const interactor = req.container.resolve('acceptPluggyWebhookInteractor')
      const { data, error } = await interactor.execute({
        eventId: toStringOrEmpty(body.eventId),
        itemId: toStringOrEmpty(body.itemId),
        event: toStringOrEmpty(body.event),
        providedSecret: typeof providedSecret === 'string' ? providedSecret : '',
      })

      if (error) {
        // 401 para notificação não confiável; 400 para payload incompleto. Nenhuma das duas diz se o
        // item existe aqui.
        if (error.errorType === 'PLUGGY_WEBHOOK_NOT_TRUSTED') {
          res.status(401).json({ errorType: error.errorType })
          return
        }
        if (PAYLOAD_ERROR_TYPES.has(error.errorType)) {
          res.status(400).json({ errorType: error.errorType })
          return
        }
        // Falha nossa: 503 para a Pluggy reentregar, e `errorType` fixo — o interno diria a um
        // chamador não autenticado como este serviço está configurado (ex.: chave de cifra ausente
        // sobe de `decryptSecret` na leitura da credencial).
        res.status(503).json({ errorType: 'PLUGGY_WEBHOOK_ACCEPT_FAILED' })
        return
      }

      res.status(202).json({ data })

      // Só depois da resposta. Evento já conhecido não precisa de nova drenagem imediata, mas
      // drenar de novo é inofensivo e cobre o caso de a passada anterior ter parado no teto.
      drain(container)
    } catch {
      res.status(500).json({ errorType: 'PLUGGY_WEBHOOK_ACCEPT_FAILED' })
    }
  }
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
