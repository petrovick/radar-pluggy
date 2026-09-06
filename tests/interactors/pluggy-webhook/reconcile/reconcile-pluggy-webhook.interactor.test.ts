import { describe, expect, it } from 'vitest'
import { ReconcilePluggyWebhookInteractor } from '../../../../src/interactors/pluggy-webhook/reconcile/reconcile-pluggy-webhook.interactor.js'
import type {
  CredentialWebhookState,
  ReconcilePluggyWebhookGateway,
} from '../../../../src/interactors/pluggy-webhook/reconcile/reconcile-pluggy-webhook.types.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

function build(states: CredentialWebhookState[], failFor: number[] = []) {
  const provisioned: number[] = []

  const gateway: ReconcilePluggyWebhookGateway = {
    addContext: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    listCredentialWebhookStates: async () => states,
    provisionWebhook: async (credentialId) => {
      if (failFor.includes(credentialId)) {
        throw new ApplicationError('PLUGGY_WEBHOOKS_UPSTREAM_ERROR', { status: 400 })
      }
      provisioned.push(credentialId)
    },
  }

  const interactor = new ReconcilePluggyWebhookInteractor({
    reconcilePluggyWebhookImpl: gateway,
  } as unknown as AppContainer)

  return { interactor, provisioned }
}

describe('ReconcilePluggyWebhookInteractor', () => {
  it('credencial sem webhook conta como provisionada; com webhook, como atualizada', async () => {
    const { interactor, provisioned } = build([
      { credentialId: 1, provisioned: false },
      { credentialId: 2, provisioned: true },
    ])

    const result = await interactor.execute({ personId: 1 })

    expect(result.data).toEqual({ provisioned: 1, updated: 1, failed: 0 })
    expect(provisioned).toEqual([1, 2])
  })

  it('falha numa credencial não impede as outras de receberem gatilho', async () => {
    const { interactor, provisioned } = build(
      [
        { credentialId: 1, provisioned: false },
        { credentialId: 2, provisioned: false },
        { credentialId: 3, provisioned: false },
      ],
      [2],
    )

    const result = await interactor.execute({ personId: 1 })

    expect(result.data).toEqual({ provisioned: 2, updated: 0, failed: 1 })
    expect(provisioned).toEqual([1, 3])
  })

  it('rodar duas vezes seguidas é inofensivo — a operação é idempotente por desenho', async () => {
    const { interactor } = build([{ credentialId: 1, provisioned: true }])

    const primeira = await interactor.execute({ personId: 1 })
    const segunda = await interactor.execute({ personId: 1 })

    expect(primeira.data).toEqual(segunda.data)
  })

  it('nenhuma credencial cadastrada devolve zeros, não erro', async () => {
    const { interactor } = build([])

    const result = await interactor.execute({ personId: 1 })

    expect(result.data).toEqual({ provisioned: 0, updated: 0, failed: 0 })
  })

  it('falha ao listar credenciais vira erro nomeado', async () => {
    const gateway = {
      addContext: () => {},
      logInfo: () => {},
      logWarn: () => {},
      logError: () => {},
      listCredentialWebhookStates: async () => {
        throw new Error('banco fora')
      },
      provisionWebhook: async () => {},
    } as unknown as ReconcilePluggyWebhookGateway
    const interactor = new ReconcilePluggyWebhookInteractor({
      reconcilePluggyWebhookImpl: gateway,
    } as unknown as AppContainer)

    const result = await interactor.execute({ personId: 1 })

    expect(result.error?.errorType).toBe('PLUGGY_WEBHOOK_RECONCILIATION_FAILED')
  })

  it('isola estritamente as credenciais de titulares distintos', async () => {
    const person1States: CredentialWebhookState[] = [{ credentialId: 101, provisioned: false }]
    const person2States: CredentialWebhookState[] = [{ credentialId: 202, provisioned: true }]
    const provisioned: number[] = []

    const gateway: ReconcilePluggyWebhookGateway = {
      addContext: () => {},
      logInfo: () => {},
      logWarn: () => {},
      logError: () => {},
      listCredentialWebhookStates: async (personId: number) => {
        if (personId === 1) return person1States
        if (personId === 2) return person2States
        return []
      },
      provisionWebhook: async (credentialId) => {
        provisioned.push(credentialId)
      },
    }

    const interactor = new ReconcilePluggyWebhookInteractor({
      reconcilePluggyWebhookImpl: gateway,
    } as unknown as AppContainer)

    const result = await interactor.execute({ personId: 1 })

    expect(result.data).toEqual({ provisioned: 1, updated: 0, failed: 0 })
    expect(provisioned).toEqual([101])
    expect(provisioned).not.toContain(202)
  })
})
