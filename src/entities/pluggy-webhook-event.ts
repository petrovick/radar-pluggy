import { ApplicationError } from '../shared/application-error.js'

const ALLOWED_CREATE_FIELDS = new Set(['eventId', 'itemId', 'event'])

// Estados possíveis de um evento na inbox (design.md D7). `SUCCEEDED` é terminal; `PENDING` e
// `PROCESSING` são de trabalho. Não existe `FAILED` terminal de propósito: falha devolve o evento a
// `PENDING`, porque o que perde trabalho de vez é declarar fracasso, não tentar de novo depois.
export const WEBHOOK_EVENT_STATES = ['PENDING', 'PROCESSING', 'SUCCEEDED'] as const
export type WebhookEventState = (typeof WEBHOOK_EVENT_STATES)[number]

interface CreatePluggyWebhookEventProps {
  eventId: string
  itemId: string
  event: string
}

export class PluggyWebhookEvent {
  private constructor(
    private readonly id: number | undefined,
    private readonly eventId: string,
    private readonly itemId: string,
    private readonly event: string,
    private readonly state: WebhookEventState,
    private readonly attempts: number,
    private readonly errorSummary: string | undefined,
  ) {}

  // Evento recém-recebido entra sempre como `PENDING` com zero tentativas: o handler responde 2xx
  // depois de gravar, e quem processa é o worker (D7).
  static create(props: CreatePluggyWebhookEventProps): PluggyWebhookEvent {
    assertNoUnexpectedFields(props)
    assertNonEmpty(props.eventId, 'PLUGGY_WEBHOOK_EVENT_ID_MISSING')
    assertNonEmpty(props.itemId, 'PLUGGY_WEBHOOK_EVENT_ITEM_ID_MISSING')
    assertNonEmpty(props.event, 'PLUGGY_WEBHOOK_EVENT_TYPE_MISSING')

    return new PluggyWebhookEvent(undefined, props.eventId, props.itemId, props.event, 'PENDING', 0, undefined)
  }

  static reconstitute(props: {
    id: number
    eventId: string
    itemId: string
    event: string
    state: string
    attempts: number
    errorSummary?: string | undefined
  }): PluggyWebhookEvent {
    if (!isWebhookEventState(props.state)) {
      throw new ApplicationError('PLUGGY_WEBHOOK_EVENT_STATE_UNKNOWN', { state: props.state, eventId: props.eventId })
    }

    return new PluggyWebhookEvent(
      props.id,
      props.eventId,
      props.itemId,
      props.event,
      props.state,
      props.attempts,
      props.errorSummary,
    )
  }

  // `item/created` e `item/updated` são os que disparam carga (design.md D7). Qualquer outro evento é
  // reconhecido e concluído sem trabalho — não é erro, é evento que não nos diz respeito.
  isApplicable(): boolean {
    return this.event === 'item/created' || this.event === 'item/updated'
  }

  requireId(): number {
    if (this.id === undefined) {
      throw new ApplicationError('PLUGGY_WEBHOOK_EVENT_ID_NOT_PERSISTED', { eventId: this.eventId })
    }
    return this.id
  }

  getEventId(): string {
    return this.eventId
  }

  getItemId(): string {
    return this.itemId
  }

  getEvent(): string {
    return this.event
  }

  getState(): WebhookEventState {
    return this.state
  }

  getAttempts(): number {
    return this.attempts
  }

  getErrorSummary(): string | undefined {
    return this.errorSummary
  }
}

function isWebhookEventState(value: string): value is WebhookEventState {
  return (WEBHOOK_EVENT_STATES as readonly string[]).includes(value)
}

function assertNonEmpty(value: string | undefined, errorType: string): void {
  if (!value || value.trim().length === 0) {
    throw new ApplicationError(errorType)
  }
}

function assertNoUnexpectedFields(props: object): void {
  const forbidden = Object.keys(props).filter((key) => !ALLOWED_CREATE_FIELDS.has(key))
  if (forbidden.length > 0) {
    throw new ApplicationError('PLUGGY_WEBHOOK_EVENT_UNEXPECTED_FIELD', { fields: forbidden })
  }
}
