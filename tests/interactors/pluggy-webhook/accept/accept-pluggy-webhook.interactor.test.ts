import { describe, expect, it } from 'vitest'
import { AcceptPluggyWebhookInteractor } from '../../../../src/interactors/pluggy-webhook/accept/accept-pluggy-webhook.interactor.js'
import type { AcceptPluggyWebhookGateway } from '../../../../src/interactors/pluggy-webhook/accept/accept-pluggy-webhook.types.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'

const ITEM_ID = '00000000-0000-0000-0000-000000000001'

function buildGateway(overrides: Partial<AcceptPluggyWebhookGateway> = {}) {
  const enqueued: { eventId: string; itemId: string; event: string }[] = []

  const gateway: AcceptPluggyWebhookGateway = {
    addContext: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    isTrustedNotification: async () => true,
    enqueueEvent: async (input) => {
      enqueued.push(input)
      return { alreadyKnown: false }
    },
    ...overrides,
  }

  return { gateway, enqueued }
}

const buildInteractor = (gateway: AcceptPluggyWebhookGateway) =>
  new AcceptPluggyWebhookInteractor({ acceptPluggyWebhookImpl: gateway } as unknown as AppContainer)

const validInput = { eventId: 'evt-1', itemId: ITEM_ID, event: 'item/updated', providedSecret: 'segredo' }

describe('AcceptPluggyWebhookInteractor', () => {
  it('aceita a notificação confiável e enfileira o evento', async () => {
    const { gateway, enqueued } = buildGateway()

    const result = await buildInteractor(gateway).execute(validInput)

    expect(result.data).toEqual({ accepted: true, alreadyKnown: false })
    expect(enqueued).toEqual([{ eventId: 'evt-1', itemId: ITEM_ID, event: 'item/updated' }])
  })

  it('reentrega do mesmo evento também é aceita, marcada como já conhecida', async () => {
    const { gateway } = buildGateway({ enqueueEvent: async () => ({ alreadyKnown: true }) })

    const result = await buildInteractor(gateway).execute(validInput)

    expect(result.data).toEqual({ accepted: true, alreadyKnown: true })
  })

  it('assinatura inválida recusa sem enfileirar', async () => {
    const { gateway, enqueued } = buildGateway({ isTrustedNotification: async () => false })

    const result = await buildInteractor(gateway).execute(validInput)

    expect(result.error?.errorType).toBe('PLUGGY_WEBHOOK_NOT_TRUSTED')
    expect(enqueued).toEqual([])
  })

  it('item desconhecido recusa com a MESMA mensagem de assinatura inválida, sem revelar se o item existe', async () => {
    const { gateway } = buildGateway({ isTrustedNotification: async () => false })

    const desconhecido = await buildInteractor(gateway).execute({ ...validInput, itemId: 'item-que-nao-existe' })
    const assinaturaErrada = await buildInteractor(gateway).execute({ ...validInput, providedSecret: 'errado' })

    expect(desconhecido.error?.errorType).toBe(assinaturaErrada.error?.errorType)
  })

  it('eventId ausente recusa nomeando o campo, sem consultar confiança', async () => {
    let consultou = false
    const { gateway, enqueued } = buildGateway({
      isTrustedNotification: async () => {
        consultou = true
        return true
      },
    })

    const result = await buildInteractor(gateway).execute({ ...validInput, eventId: '' })

    expect(result.error?.errorType).toBe('PLUGGY_WEBHOOK_EVENT_ID_MISSING')
    expect(consultou).toBe(false)
    expect(enqueued).toEqual([])
  })

  it('erro inesperado vira erro nomeado do caso de uso', async () => {
    const { gateway } = buildGateway({
      enqueueEvent: async () => {
        throw new Error('deadlock')
      },
    })

    const result = await buildInteractor(gateway).execute(validInput)

    expect(result.error?.errorType).toBe('PLUGGY_WEBHOOK_ACCEPT_FAILED')
  })
})
