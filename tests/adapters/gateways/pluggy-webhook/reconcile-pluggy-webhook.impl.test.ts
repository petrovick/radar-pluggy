import { describe, expect, it } from 'vitest'
import ReconcilePluggyWebhookImpl from '../../../../src/adapters/gateways/pluggy-webhook/reconcile-pluggy-webhook.impl.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import { PluggyCredential } from '../../../../src/entities/pluggy-credential.js'
import { currentCallContext } from '../../../../src/infra/tools/call-context.js'

function build(credentials: PluggyCredential[], provisionCalls: number[]) {
  const container = {
    logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    getTransaction: () => null,
    setTransaction: () => {},
    db: { models: {} },
    pluggyCredentialRep: {
      findByPersonId: async (personId: number) => credentials.filter((c) => c.getPersonId() === personId),
    },
    pluggyWebhookProvisioner: {
      provisionFor: async (credentialId: number) => {
        provisionCalls.push(credentialId)
      },
    },
  } as unknown as AppContainer

  return new ReconcilePluggyWebhookImpl(container)
}

const credPessoa1 = () =>
  PluggyCredential.reconstitute({ id: 7, personId: 1, clientId: 'client-id-1', clientSecret: 'client-secret' })

const credPessoa1ComWebhook = () =>
  PluggyCredential.reconstitute({
    id: 8,
    personId: 1,
    clientId: 'client-id-2',
    clientSecret: 'client-secret-2',
    webhook: { secret: 'segredo', webhookId: 'wh-existente', url: 'https://x.example.com', event: 'all' },
  })

const credPessoa2 = () =>
  PluggyCredential.reconstitute({ id: 9, personId: 2, clientId: 'client-id-p2', clientSecret: 'client-secret-p2' })

describe('ReconcilePluggyWebhookImpl', () => {
  it('lista o estado de provisionamento apenas das credenciais do titular', async () => {
    const impl = build([credPessoa1(), credPessoa1ComWebhook(), credPessoa2()], [])

    // Pessoa 1 só enxerga as suas (7 e 8), jamais a credencial 9 da pessoa 2
    await expect(impl.listCredentialWebhookStates(1)).resolves.toEqual([
      { credentialId: 7, provisioned: false },
      { credentialId: 8, provisioned: true },
    ])

    // Pessoa 2 só enxerga a sua (9)
    await expect(impl.listCredentialWebhookStates(2)).resolves.toEqual([
      { credentialId: 9, provisioned: false },
    ])
  })

  it('provisionWebhook delega para o PluggyWebhookProvisioner compartilhado (arquitetura-camadas, 2.3.1)', async () => {
    const provisionCalls: number[] = []
    const impl = build([], provisionCalls)

    await impl.provisionWebhook(7)

    expect(provisionCalls).toEqual([7])
  })

  it('provisionWebhook roda sob trigger=WEBHOOK_RECONCILIATION (tasks.md 8.8)', async () => {
    let triggerSeen: string | undefined
    const container = {
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: () => null,
      setTransaction: () => {},
      db: { models: {} },
      pluggyCredentialRep: { findByPersonId: async () => [] },
      pluggyWebhookProvisioner: {
        provisionFor: async () => {
          triggerSeen = currentCallContext()?.trigger
        },
      },
    } as unknown as AppContainer
    const impl = new ReconcilePluggyWebhookImpl(container)

    await impl.provisionWebhook(7)

    expect(triggerSeen).toBe('WEBHOOK_RECONCILIATION')
  })
})
