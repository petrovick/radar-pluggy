import { ApplicationError } from '../../shared/application-error.js'
import { pluggySdkError, type PluggyConnectorClient } from './pluggy-client.gateway.js'

// `all` cobre `item/created` e `item/updated` num cadastro só (design.md D7) — a Pluggy aceita esse
// valor no enum de `WebhookEventType`, e filtrar qual evento interessa é decisão nossa, no worker.
export const WEBHOOK_EVENT_ALL = 'all'

export interface PluggyWebhookDto {
  webhookId: string
  url: string
  event: string
}

type PluggyWebhookResponse = {
  id?: unknown
  url?: unknown
  event?: unknown
}

// Inscrição de webhook pelo `pluggy-sdk` (padroes-de-engenharia, 3b) — sem retry nosso (regra 3).
//
// A URL é validada aqui antes de sair: a Pluggy recusa URL não-HTTPS, IP literal e host reservado, e
// falhar cedo com erro nomeado é melhor que traduzir um erro genérico depois.
export class PluggyWebhooksGateway {

  // O segredo de entrada viaja como header configurado no webhook: é o que a Pluggy vai devolver em
  // cada notificação, e é o que o handler compara em tempo constante (design.md W1). Nunca é o
  // `client_secret`.
  async createWebhook(
    url: string,
    secretHeaderName: string,
    secret: string,
    client: PluggyConnectorClient,
  ): Promise<PluggyWebhookDto> {
    assertHttpsUrl(url)

    const data = await this.send('/webhooks', () =>
      client.createWebhook(WEBHOOK_EVENT_ALL as never, url, { [secretHeaderName]: secret }),
    )

    return this.parseWebhook(data)
  }

  // Rotação atualiza a inscrição existente. Nunca cria uma segunda: duas inscrições para a mesma URL
  // fariam a Pluggy entregar o mesmo evento duas vezes, e a segunda chamada de `POST` seria recusada
  // com `alreadyExists` de qualquer forma.
  async updateWebhook(
    webhookId: string,
    url: string,
    secretHeaderName: string,
    secret: string,
    client: PluggyConnectorClient,
  ): Promise<PluggyWebhookDto> {
    assertHttpsUrl(url)

    const data = await this.send(`/webhooks/${webhookId}`, () =>
      client.updateWebhook(webhookId, {
        url,
        event: WEBHOOK_EVENT_ALL as never,
        headers: { [secretHeaderName]: secret },
      }),
    )

    return this.parseWebhook(data)
  }

  // Confirma com a própria Pluggy que o webhook salvo localmente ainda existe do lado dela — o
  // provisioner usa isto antes de decidir update-vs-create, porque um webhook apagado no dashboard
  // (ou por qualquer outro motivo do lado deles) sem o banco local saber faria um `updateWebhook`
  // mirar um recurso inexistente. `byCode: 404` dá ao provisioner o nome que ele precisa para
  // distinguir "sumiu" de qualquer outra falha.
  async fetchWebhook(webhookId: string, client: PluggyConnectorClient): Promise<PluggyWebhookDto> {
    const data = await this.send(`/webhooks/${webhookId}`, () => client.fetchWebhook(webhookId), {
      404: 'PLUGGY_WEBHOOK_NOT_FOUND',
    })

    return this.parseWebhook(data)
  }

  private async send(
    path: string,
    call: () => Promise<unknown>,
    byCode?: Record<number, string>,
  ): Promise<PluggyWebhookResponse> {
    try {
      return (await call()) as PluggyWebhookResponse
    } catch (error) {
      throw pluggySdkError(
        error,
        {
          timeout: 'PLUGGY_WEBHOOKS_TIMEOUT',
          unavailable: 'PLUGGY_WEBHOOKS_UNAVAILABLE',
          upstream: 'PLUGGY_WEBHOOKS_UPSTREAM_ERROR',
          ...(byCode ? { byCode } : {}),
        },
        { path },
      )
    }
  }

  private parseWebhook(data: PluggyWebhookResponse): PluggyWebhookDto {
    // O id devolvido é o que permite rotacionar depois em vez de criar uma segunda inscrição — sem
    // ele, o provisionamento não está completo (tasks.md 7.1).
    if (typeof data.id !== 'string' || data.id.length === 0) {
      throw new ApplicationError('PLUGGY_WEBHOOKS_RESPONSE_INVALID', { field: 'id' })
    }
    if (typeof data.url !== 'string' || data.url.length === 0) {
      throw new ApplicationError('PLUGGY_WEBHOOKS_RESPONSE_INVALID', { field: 'url' })
    }
    if (typeof data.event !== 'string' || data.event.length === 0) {
      throw new ApplicationError('PLUGGY_WEBHOOKS_RESPONSE_INVALID', { field: 'event' })
    }

    // Persistimos o que foi EFETIVAMENTE provisionado, não o que pedimos (tasks.md 7.1).
    return { webhookId: data.id, url: data.url, event: data.event }
  }
}

function assertHttpsUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ApplicationError('PLUGGY_WEBHOOK_URL_INVALID', { url })
  }

  if (parsed.protocol !== 'https:') {
    throw new ApplicationError('PLUGGY_WEBHOOK_URL_NOT_HTTPS', { url })
  }
}
