import { describe, expect, it } from 'vitest'
import { PluggyConsentsGateway } from '../../../src/adapters/gateways/pluggy-consents.gateway.js'
import { fakePluggyClient, pluggySdkTimeout } from './fake-pluggy-client.js'

const gateway = new PluggyConsentsGateway()

function clientReturning(body: unknown) {
  return fakePluggyClient({ fetchConsents: async () => body })
}

function clientRejecting(error: unknown) {
  return fakePluggyClient({
    fetchConsents: async () => {
      throw error
    },
  })
}

describe('PluggyConsentsGateway', () => {
  it('traduz consentimento com expiresAt e revokedAt presentes', async () => {
    const client = clientReturning({
      page: 1,
      total: 1,
      totalPages: 1,
      results: [
        {
          id: 'consent-1',
          itemId: 'item-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2027-01-01T00:00:00.000Z',
          revokedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    })

    const [consent] = await gateway.fetchConsents('item-1', client)
    expect(consent?.consentId).toBe('consent-1')
    expect(consent?.grantedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    expect(consent?.expiresAt).toEqual(new Date('2027-01-01T00:00:00.000Z'))
    expect(consent?.revokedAt).toEqual(new Date('2026-06-01T00:00:00.000Z'))
  })

  it('expiresAt e revokedAt ausentes/null viram undefined — consentimento sem prazo e nunca revogado', async () => {
    const client = clientReturning({
      page: 1,
      total: 1,
      totalPages: 1,
      results: [{ id: 'consent-1', itemId: 'item-1', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: null, revokedAt: null }],
    })

    const [consent] = await gateway.fetchConsents('item-1', client)
    expect(consent?.expiresAt).toBeUndefined()
    expect(consent?.revokedAt).toBeUndefined()
  })

  it('devolve lista vazia quando results é []', async () => {
    const client = clientReturning({ page: 1, total: 0, totalPages: 1, results: [] })

    await expect(gateway.fetchConsents('item-1', client)).resolves.toEqual([])
  })

  it('recusa nomeando o campo quando id está ausente', async () => {
    const client = clientReturning({
      page: 1,
      total: 1,
      totalPages: 1,
      results: [{ itemId: 'item-1', createdAt: '2026-01-01T00:00:00.000Z' }],
    })

    await expect(gateway.fetchConsents('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_CONSENT_RESPONSE_INVALID',
      details: { itemId: 'item-1', index: 0, field: 'id' },
    })
  })

  it('recusa nomeando o campo quando createdAt está ausente ou ilegível', async () => {
    const client = clientReturning({
      page: 1,
      total: 1,
      totalPages: 1,
      results: [{ id: 'consent-1', itemId: 'item-1' }],
    })

    await expect(gateway.fetchConsents('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_CONSENT_RESPONSE_INVALID',
      details: { itemId: 'item-1', index: 0, field: 'createdAt' },
    })
  })

  it('recusa quando expiresAt vem presente com formato inválido', async () => {
    const client = clientReturning({
      page: 1,
      total: 1,
      totalPages: 1,
      results: [{ id: 'consent-1', itemId: 'item-1', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: 'não é data' }],
    })

    await expect(gateway.fetchConsents('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_CONSENT_RESPONSE_INVALID',
      details: { itemId: 'item-1', index: 0, field: 'expiresAt' },
    })
  })

  it('recusa quando totalPages é maior que 1 — volume nunca esperado neste domínio', async () => {
    const client = clientReturning({ page: 1, total: 501, totalPages: 2, results: [] })

    await expect(gateway.fetchConsents('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_CONSENTS_TOO_MANY_RESULTS',
      details: { itemId: 'item-1', totalPages: 2 },
    })
  })

  it('recusa quando metadados de paginação são inválidos', async () => {
    const client = clientReturning({ page: 1, total: 1, totalPages: -1, results: [] })

    await expect(gateway.fetchConsents('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_CONSENTS_RESPONSE_INVALID',
      details: { field: 'totalPages' },
    })
  })

  it('recusa com PLUGGY_CONSENTS_TIMEOUT quando a chamada estoura o timeout', async () => {
    const client = clientRejecting(pluggySdkTimeout())

    await expect(gateway.fetchConsents('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_CONSENTS_TIMEOUT',
    })
  })

  // Change pluggy-complete-data-capture, spec pluggy-consent: escopo autorizado.
  it('lê products e openFinancePermissionsGranted quando presentes', async () => {
    const client = clientReturning({
      page: 1,
      total: 1,
      totalPages: 1,
      results: [
        {
          id: 'consent-1',
          itemId: 'item-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          products: ['ACCOUNTS', 'INVESTMENTS'],
          openFinancePermissionsGranted: ['ACCOUNTS_READ', 'INVESTMENTS_READ'],
        },
      ],
    })

    const [consent] = await gateway.fetchConsents('item-1', client)
    expect(consent?.products).toEqual(['ACCOUNTS', 'INVESTMENTS'])
    expect(consent?.openFinancePermissionsGranted).toEqual(['ACCOUNTS_READ', 'INVESTMENTS_READ'])
  })

  it('consentimento sem products/permissions mantém os dois indefinidos', async () => {
    const client = clientReturning({
      page: 1,
      total: 1,
      totalPages: 1,
      results: [{ id: 'consent-1', itemId: 'item-1', createdAt: '2026-01-01T00:00:00.000Z' }],
    })

    const [consent] = await gateway.fetchConsents('item-1', client)
    expect(consent?.products).toBeUndefined()
    expect(consent?.openFinancePermissionsGranted).toBeUndefined()
  })

  it('recusa quando products vem com item que não é string', async () => {
    const client = clientReturning({
      page: 1,
      total: 1,
      totalPages: 1,
      results: [
        { id: 'consent-1', itemId: 'item-1', createdAt: '2026-01-01T00:00:00.000Z', products: ['ACCOUNTS', 123] },
      ],
    })

    await expect(gateway.fetchConsents('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_CONSENT_RESPONSE_INVALID',
      details: { itemId: 'item-1', index: 0, field: 'products' },
    })
  })
})
