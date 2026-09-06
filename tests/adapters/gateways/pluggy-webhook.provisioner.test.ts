import { describe, expect, it } from 'vitest'
import { PluggyWebhookProvisioner, WEBHOOK_SECRET_HEADER } from '../../../src/adapters/gateways/pluggy-webhook.provisioner.js'
import type { AppContainer } from '../../../src/infra/bootstrap/register.js'
import { PluggyCredential } from '../../../src/entities/pluggy-credential.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

// O cliente do SDK não é exercitado aqui: estes testes cobrem o provisioner, e o gateway de borda é
// fingido logo abaixo. O stub existe só para o provisioner ter o que repassar.
const fakeSdkClient = {} as never

const URL_HTTPS = 'https://pluggy-connector.example.com/webhooks/pluggy'

type Provisioned = { verb: 'create' | 'update'; webhookId?: string; url: string; header: string; secret: string }

// A decisão de negócio deste colaborador é escolher entre criar e ROTACIONAR conforme a credencial já
// ter ou não webhook, e persistir o que a Pluggy confirmou. É o cenário de tasks.md 7.4 ("backfill sem
// webhook_id, webhook remoto já configurado") — testado aqui, no nível onde a decisão mora. Colaborador
// extraído de `ReconcilePluggyWebhookImpl` para ser compartilhado com `RegisterPluggyCredentialImpl`
// (PENDENCIAS.md 3.1).
//
// `fetchWebhook` por padrão CONFIRMA que o webhook existente ainda existe do lado da Pluggy — é o que
// faz o caso "existing" seguir para update. Os testes que simulam o webhook ter sumido do lado deles
// sobrescrevem esse comportamento (ver `build` com `fetchWebhook` customizado).
function build(
  credential: PluggyCredential | undefined,
  webhookUrl = URL_HTTPS,
  fetchWebhook: (webhookId: string) => Promise<{ webhookId: string; url: string; event: string }> = async (
    webhookId,
  ) => ({ webhookId, url: URL_HTTPS, event: 'all' }),
) {
  const calls: Provisioned[] = []
  const saved: { credentialId: number; secret: string; webhookId: string; url: string; event: string }[] = []

  const container = {
    logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    getTransaction: () => null,
    setTransaction: () => {},
    db: { models: {} },
    webhookUrl,
    pluggyCredentialRep: {
      findAll: async () => (credential ? [credential] : []),
      findById: async () => credential,
      saveWebhook: async (credentialId: number, webhook: Record<string, string>) => {
        saved.push({ credentialId, ...webhook } as (typeof saved)[number])
      },
    },
    pluggyClientGateway: { clientFor: () => fakeSdkClient },
    pluggyWebhooksGateway: {
      fetchWebhook: (webhookId: string) => fetchWebhook(webhookId),
      createWebhook: async (url: string, header: string, secret: string) => {
        calls.push({ verb: 'create', url, header, secret })
        return { webhookId: 'wh-novo', url, event: 'all' }
      },
      updateWebhook: async (webhookId: string, url: string, header: string, secret: string) => {
        calls.push({ verb: 'update', webhookId, url, header, secret })
        return { webhookId, url, event: 'all' }
      },
    },
  } as unknown as AppContainer

  return { provisioner: new PluggyWebhookProvisioner(container), calls, saved }
}

const semWebhook = () =>
  PluggyCredential.reconstitute({ id: 7, personId: 1, clientId: 'client-id', clientSecret: 'client-secret' })

const comWebhook = () =>
  PluggyCredential.reconstitute({
    id: 7,
    personId: 1,
    clientId: 'client-id',
    clientSecret: 'client-secret',
    webhook: { secret: 'segredo-antigo', webhookId: 'wh-existente', url: URL_HTTPS, event: 'all' },
  })

describe('PluggyWebhookProvisioner.provisionFor', () => {
  it('credencial sem webhook é INSCRITA (create), com o segredo no header próprio', async () => {
    const { provisioner, calls, saved } = build(semWebhook())

    await provisioner.provisionFor(7)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.verb).toBe('create')
    expect(calls[0]?.header).toBe(WEBHOOK_SECRET_HEADER)
    expect(saved[0]).toMatchObject({ credentialId: 7, webhookId: 'wh-novo', url: URL_HTTPS, event: 'all' })
  })

  it('credencial já inscrita é ROTACIONADA (update no mesmo webhookId), nunca inscrita de novo', async () => {
    const { provisioner, calls, saved } = build(comWebhook())

    await provisioner.provisionFor(7)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.verb).toBe('update')
    expect(calls[0]?.webhookId).toBe('wh-existente')
    // Segredo NOVO: reconciliar (ou cadastrar) é também rotacionar.
    expect(calls[0]?.secret).not.toBe('segredo-antigo')
    expect(saved[0]?.secret).toBe(calls[0]?.secret)
  })

  it('grava o que a Pluggy confirmou, não o que foi pedido', async () => {
    const { provisioner, saved } = build(semWebhook())

    await provisioner.provisionFor(7)

    // `wh-novo` e `all` vieram da resposta, não do input.
    expect(saved[0]).toMatchObject({ webhookId: 'wh-novo', event: 'all' })
  })

  it('segredo é diferente a cada provisionamento', async () => {
    const { provisioner, calls } = build(comWebhook())

    await provisioner.provisionFor(7)
    await provisioner.provisionFor(7)

    expect(calls[0]?.secret).not.toBe(calls[1]?.secret)
  })

  it('sem PLUGGY_WEBHOOK_URL recusa nomeando a configuração, sem chamar a Pluggy', async () => {
    const { provisioner, calls } = build(semWebhook(), '')

    await expect(provisioner.provisionFor(7)).rejects.toMatchObject({ errorType: 'PLUGGY_WEBHOOK_URL_MISSING' })
    expect(calls).toEqual([])
  })

  it('credencial inexistente recusa nomeada', async () => {
    const { provisioner } = build(undefined)

    await expect(provisioner.provisionFor(7)).rejects.toBeInstanceOf(ApplicationError)
  })

  it('webhook existente e CONFIRMADO na Pluggy: chama updateWebhook, nunca createWebhook', async () => {
    const { provisioner, calls } = build(comWebhook())

    await provisioner.provisionFor(7)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.verb).toBe('update')
  })

  it('webhook existente mas SUMIDO do lado da Pluggy (fetchWebhook recusa 404): chama createWebhook, nunca updateWebhook', async () => {
    const { provisioner, calls, saved } = build(comWebhook(), URL_HTTPS, async () => {
      throw new ApplicationError('PLUGGY_WEBHOOK_NOT_FOUND', { webhookId: 'wh-existente' })
    })

    await provisioner.provisionFor(7)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.verb).toBe('create')
    expect(saved[0]?.webhookId).toBe('wh-novo')
  })

  it('fetchWebhook falha com outro erro: propaga, sem chamar createWebhook nem updateWebhook', async () => {
    const { provisioner, calls } = build(comWebhook(), URL_HTTPS, async () => {
      throw new ApplicationError('PLUGGY_WEBHOOKS_UNAVAILABLE')
    })

    await expect(provisioner.provisionFor(7)).rejects.toMatchObject({ errorType: 'PLUGGY_WEBHOOKS_UNAVAILABLE' })
    expect(calls).toEqual([])
  })
})
