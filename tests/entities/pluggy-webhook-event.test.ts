import { describe, expect, it } from 'vitest'
import { PluggyWebhookEvent, WEBHOOK_EVENT_STATES } from '../../src/entities/pluggy-webhook-event.js'
import { ApplicationError } from '../../src/shared/application-error.js'

function validProps() {
  return { eventId: 'evt-1', itemId: 'item-1', event: 'item/updated' }
}

describe('PluggyWebhookEvent.create', () => {
  it('evento novo entra PENDING com zero tentativas e sem resumo de erro', () => {
    const event = PluggyWebhookEvent.create(validProps())

    expect(event.getState()).toBe('PENDING')
    expect(event.getAttempts()).toBe(0)
    expect(event.getErrorSummary()).toBeUndefined()
  })

  it.each([
    ['eventId', 'PLUGGY_WEBHOOK_EVENT_ID_MISSING'],
    ['itemId', 'PLUGGY_WEBHOOK_EVENT_ITEM_ID_MISSING'],
    ['event', 'PLUGGY_WEBHOOK_EVENT_TYPE_MISSING'],
  ])('campo obrigatório %s ausente recusa nomeando o campo', (campo, errorType) => {
    expect(() => PluggyWebhookEvent.create({ ...validProps(), [campo]: '' })).toThrowError(
      expect.objectContaining({ errorType }),
    )
  })

  it.each(['eventId', 'itemId', 'event'])('campo obrigatório %s só com espaço é ausente, não valor', (campo) => {
    expect(() => PluggyWebhookEvent.create({ ...validProps(), [campo]: '   ' })).toThrowError(ApplicationError)
  })

  it('campo inesperado em runtime recusa nomeando o campo', () => {
    expect(() =>
      PluggyWebhookEvent.create({ ...validProps(), state: 'SUCCEEDED' } as unknown as ReturnType<typeof validProps>),
    ).toThrowError(expect.objectContaining({ errorType: 'PLUGGY_WEBHOOK_EVENT_UNEXPECTED_FIELD' }))
  })

  it('evento recém-criado não tem id: requireId recusa em vez de inventar', () => {
    expect(() => PluggyWebhookEvent.create(validProps()).requireId()).toThrowError(
      expect.objectContaining({ errorType: 'PLUGGY_WEBHOOK_EVENT_ID_NOT_PERSISTED' }),
    )
  })
})

describe('PluggyWebhookEvent.reconstitute', () => {
  function reconstituteProps(state: string) {
    return { id: 7, eventId: 'evt-1', itemId: 'item-1', event: 'item/updated', state, attempts: 2 }
  }

  it.each([...WEBHOOK_EVENT_STATES])('aceita o estado documentado %s', (state) => {
    expect(PluggyWebhookEvent.reconstitute(reconstituteProps(state)).getState()).toBe(state)
  })

  it('estado fora do conjunto documentado recusa nomeando o estado e o evento', () => {
    // Linha gravada por uma versão futura (ou corrompida) não vira estado válido em silêncio: um
    // `FAILED` lido como se fosse trabalhável faria o worker girar num evento que ninguém conclui.
    expect(() => PluggyWebhookEvent.reconstitute(reconstituteProps('FAILED'))).toThrowError(
      expect.objectContaining({
        errorType: 'PLUGGY_WEBHOOK_EVENT_STATE_UNKNOWN',
        details: { state: 'FAILED', eventId: 'evt-1' },
      }),
    )
  })

  it('preserva tentativas e resumo de erro da linha persistida', () => {
    const event = PluggyWebhookEvent.reconstitute({
      ...reconstituteProps('PENDING'),
      errorSummary: 'PLUGGY_ITEMS_TIMEOUT',
    })

    expect(event.getAttempts()).toBe(2)
    expect(event.getErrorSummary()).toBe('PLUGGY_ITEMS_TIMEOUT')
    expect(event.requireId()).toBe(7)
  })
})

// A regra que governa o laço de drenagem: evento não aplicável é concluído sem trabalho, e é a
// entidade que decide isso — não um `if` no worker (arquitetura-camadas, 2.3.1.1).
describe('PluggyWebhookEvent.isApplicable', () => {
  function eventOfType(event: string): PluggyWebhookEvent {
    return PluggyWebhookEvent.create({ eventId: 'evt-1', itemId: 'item-1', event })
  }

  it.each(['item/created', 'item/updated'])('%s dispara carga', (event) => {
    expect(eventOfType(event).isApplicable()).toBe(true)
  })

  it.each([
    'item/error',
    'item/deleted',
    'item/waiting_user_input',
    'item/login_succeeded',
    'connector/status_updated',
    'payment_intent/created',
  ])('%s não dispara carga', (event) => {
    expect(eventOfType(event).isApplicable()).toBe(false)
  })

  it('nome parecido não conta: prefixo ou sufixo não é o evento documentado', () => {
    // Casamento por igualdade, nunca por `startsWith`/`includes`: um evento novo chamado
    // `item/updated_partially` não pode entrar por semelhança de nome.
    expect(eventOfType('item/updated_partially').isApplicable()).toBe(false)
    expect(eventOfType('xitem/updated').isApplicable()).toBe(false)
    expect(eventOfType('ITEM/UPDATED').isApplicable()).toBe(false)
  })
})
