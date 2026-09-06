import { describe, expect, it, vi } from 'vitest'
import { PluggyWebhooksGateway } from '../../../src/adapters/gateways/pluggy-webhooks.gateway.js'
import { fakePluggyClient, pluggySdkHttpError, pluggySdkNetworkFailure, pluggySdkTimeout } from './fake-pluggy-client.js'

const gateway = new PluggyWebhooksGateway()

const URL_HTTPS = 'https://pluggy-connector.example.com/webhooks/pluggy'

const PROVISIONED = { id: 'wh-1', url: URL_HTTPS, event: 'all', headers: {} }

function clientReturning(body: unknown) {
  return fakePluggyClient({ createWebhook: async () => body, updateWebhook: async () => body })
}

function clientRejecting(error: unknown) {
  const reject = async () => {
    throw error
  }
  return fakePluggyClient({ createWebhook: reject, updateWebhook: reject, fetchWebhook: reject })
}

describe('PluggyWebhooksGateway', () => {
  it('cria o webhook com event=all e o segredo de entrada no header, devolvendo o que foi provisionado', async () => {
    // Método, URL e header de api key deixaram de ser nossos: o teste passa a afirmar o que
    // pedimos ao SDK, que é a fronteira que sobrou (padroes-de-engenharia, 3b).
    const createWebhook = vi.fn().mockResolvedValue(PROVISIONED)

    const webhook = await gateway.createWebhook(
      URL_HTTPS,
      'x-pluggy-connector-secret',
      'segredo',
      fakePluggyClient({ createWebhook }),
    )

    expect(createWebhook).toHaveBeenCalledWith('all', URL_HTTPS, { 'x-pluggy-connector-secret': 'segredo' })
    // Persiste o que foi EFETIVAMENTE provisionado, não o que pedimos.
    expect(webhook).toEqual({ webhookId: 'wh-1', url: URL_HTTPS, event: 'all' })
  })

  it('rotação usa PATCH no webhook existente, nunca cria uma segunda inscrição', async () => {
    const updateWebhook = vi.fn().mockResolvedValue(PROVISIONED)
    const createWebhook = vi.fn()

    await gateway.updateWebhook('wh-1', URL_HTTPS, 'x-secret', 'novo-segredo', fakePluggyClient({ updateWebhook, createWebhook }))

    expect(updateWebhook).toHaveBeenCalledWith('wh-1', {
      url: URL_HTTPS,
      event: 'all',
      headers: { 'x-secret': 'novo-segredo' },
    })
    // Rotação nunca cria uma segunda inscrição: duas para a mesma URL entregariam o evento duas vezes.
    expect(createWebhook).not.toHaveBeenCalled()
  })

  it('recusa URL não-HTTPS antes de sair para a rede', async () => {
    const createWebhook = vi.fn()

    await expect(
      gateway.createWebhook(
        'http://pluggy-connector.example.com/hook',
        'x-secret',
        'segredo',
        fakePluggyClient({ createWebhook }),
      ),
    ).rejects.toMatchObject({ errorType: 'PLUGGY_WEBHOOK_URL_NOT_HTTPS' })
    expect(createWebhook, 'a validação acontece antes de qualquer chamada ao SDK').not.toHaveBeenCalled()
  })

  it('recusa URL malformada antes de sair para a rede', async () => {
    const createWebhook = vi.fn()

    await expect(
      gateway.createWebhook('nao-e-url', 'x-secret', 'segredo', fakePluggyClient({ createWebhook })),
    ).rejects.toMatchObject({ errorType: 'PLUGGY_WEBHOOK_URL_INVALID' })
    expect(createWebhook).not.toHaveBeenCalled()
  })

  it('resposta sem id recusa: sem id não há como rotacionar depois, o provisionamento fica incompleto', async () => {
    const client = clientReturning({ url: URL_HTTPS, event: 'all' })

    await expect(gateway.createWebhook(URL_HTTPS, 'x-secret', 'segredo', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_WEBHOOKS_RESPONSE_INVALID',
      details: { field: 'id' },
    })
  })

  it('falha de provisionamento vira erro nomeado, com o code que restou do status engolido', async () => {
    const client = clientRejecting(pluggySdkHttpError(400, 'url inválida'))

    await expect(gateway.createWebhook(URL_HTTPS, 'x-secret', 'segredo', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_WEBHOOKS_UPSTREAM_ERROR',
      details: { path: '/webhooks', pluggyCode: 400, pluggyMessage: 'url inválida' },
    })
  })

  it('falha de rede vira indisponível, não erro da Pluggy', async () => {
    const client = clientRejecting(pluggySdkNetworkFailure())

    await expect(gateway.createWebhook(URL_HTTPS, 'x-secret', 'segredo', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_WEBHOOKS_UNAVAILABLE',
    })
  })

  it('timeout vira erro nomeado próprio', async () => {
    const client = clientRejecting(pluggySdkTimeout())

    await expect(gateway.createWebhook(URL_HTTPS, 'x-secret', 'segredo', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_WEBHOOKS_TIMEOUT',
    })
  })
})

describe('PluggyWebhooksGateway.fetchWebhook', () => {
  it('traduz a resposta de sucesso no mesmo formato de createWebhook/updateWebhook', async () => {
    const fetchWebhook = vi.fn().mockResolvedValue(PROVISIONED)

    const webhook = await gateway.fetchWebhook('wh-1', fakePluggyClient({ fetchWebhook }))

    expect(fetchWebhook).toHaveBeenCalledWith('wh-1')
    expect(webhook).toEqual({ webhookId: 'wh-1', url: URL_HTTPS, event: 'all' })
  })

  // É este erro nomeado que o provisioner usa para decidir que o webhook sumiu do lado da Pluggy.
  it('recusa com PLUGGY_WEBHOOK_NOT_FOUND quando a Pluggy devolve 404', async () => {
    const client = clientRejecting(pluggySdkHttpError(404))

    await expect(gateway.fetchWebhook('wh-sumiu', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_WEBHOOK_NOT_FOUND',
    })
  })

  it('outro erro upstream (não 404) mantém o nome genérico', async () => {
    const client = clientRejecting(pluggySdkHttpError(500, 'internal'))

    await expect(gateway.fetchWebhook('wh-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_WEBHOOKS_UPSTREAM_ERROR',
    })
  })
})
