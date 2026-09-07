import { ApplicationError } from '../shared/application-error.js'

const ALLOWED_CREATE_FIELDS = new Set(['eventId', 'itemId', 'event'])

// Categoria de tratamento (design.md D28) — a inscrição já pede `event: 'all'`, então a Pluggy manda
// todo tipo de evento; cada um vira exatamente uma destas quatro categorias, nunca "reconhecido e
// ignorado" por padrão silencioso.
export const WEBHOOK_EVENT_CATEGORIES = ['FULL_INGESTION', 'OBSERVATION_REFRESH', 'TERMINAL', 'IGNORED'] as const
export type WebhookEventCategory = (typeof WEBHOOK_EVENT_CATEGORIES)[number]

const FULL_INGESTION_EVENTS = new Set(['item/created', 'item/updated'])
// `item/waiting_user_action` (D28) é distinto de `item/waiting_user_input` — os dois só atualizam o
// estado observado, nunca disparam ingestão.
const OBSERVATION_REFRESH_EVENTS = new Set([
  'item/error',
  'item/waiting_user_input',
  'item/waiting_user_action',
  'item/login_succeeded',
])
const TERMINAL_EVENTS = new Set(['item/deleted'])

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

  // Quatro categorias fechadas (design.md D28): `FULL_INGESTION` adquire lease e roda Position+
  // History; `OBSERVATION_REFRESH` só releem o estado observado (sem lease, sem sincronizar);
  // `TERMINAL` (`item/deleted`) marca o vínculo inativo sem tentar reler — o recurso já não existe
  // na Pluggy; `IGNORED` é decisão deliberada e documentada (`connector/status_updated` e demais),
  // nunca "esquecido".
  categorize(): WebhookEventCategory {
    if (FULL_INGESTION_EVENTS.has(this.event)) {
      return 'FULL_INGESTION'
    }
    if (OBSERVATION_REFRESH_EVENTS.has(this.event)) {
      return 'OBSERVATION_REFRESH'
    }
    if (TERMINAL_EVENTS.has(this.event)) {
      return 'TERMINAL'
    }
    return 'IGNORED'
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
