import { describe, expect, it, vi } from 'vitest'
import { PluggyItemsGateway } from '../../../src/adapters/gateways/pluggy-items.gateway.js'
import { ApplicationError } from '../../../src/shared/application-error.js'
import {
  fakePluggyClient,
  pluggySdkHttpError,
  pluggySdkNetworkFailure,
  pluggySdkTimeout,
} from './fake-pluggy-client.js'

const gateway = new PluggyItemsGateway()

// O SDK entrega o objeto já desserializado; o gateway valida e traduz.
function clientReturning(item: unknown) {
  return fakePluggyClient({ fetchItem: async () => item })
}

function clientRejecting(error: unknown) {
  return fakePluggyClient({
    fetchItem: async () => {
      throw error
    },
  })
}

describe('PluggyItemsGateway.fetchItem', () => {
  it('devolve status, executionStatus e lastUpdatedAt em caso de sucesso', async () => {
    const client = clientReturning({ status: 'UPDATED', executionStatus: 'SUCCESS', lastUpdatedAt: '2026-08-01T00:00:00.000Z' })

    await expect(gateway.fetchItem('item-1', client)).resolves.toEqual({
      status: 'UPDATED',
      executionStatus: 'SUCCESS',
      lastUpdatedAt: '2026-08-01T00:00:00.000Z',
      // `statusDetail` ausente é item sem ressalva alguma — normal, não erro.
      products: {},
    })
  })

  it('expõe os avisos por produto do statusDetail, que distinguem produto limitado de fonte vazia', async () => {
    const client = clientReturning({
        status: 'UPDATED',
        executionStatus: 'PARTIAL_SUCCESS',
        lastUpdatedAt: '2026-08-01T00:00:00.000Z',
        statusDetail: {
          accounts: { isUpdated: true, lastUpdatedAt: '2026-08-01T00:00:00.000Z' },
          investments: {
            isUpdated: false,
            lastUpdatedAt: null,
            warnings: [{ code: 'RATE_LIMIT', message: 'monthly limit reached', providerMessage: null }],
          },
          identity: { isUpdated: false, lastUpdatedAt: null },
        },
      })

    const item = await gateway.fetchItem('item-1', client)

    expect(item.products.accounts).toEqual({ isUpdated: true, lastUpdatedAt: '2026-08-01T00:00:00.000Z', warnings: [] })
    expect(item.products.investments?.warnings).toEqual([{ code: 'RATE_LIMIT', message: 'monthly limit reached' }])
    // `identity` não é produto que este serviço consome (fronteira-pluggy, regra 5).
    expect(item.products).not.toHaveProperty('identity')
  })

  it('recusa statusDetail com forma inesperada, em vez de assumir "sem avisos"', async () => {
    const client = clientReturning({
        status: 'UPDATED',
        executionStatus: 'PARTIAL_SUCCESS',
        lastUpdatedAt: '2026-08-01T00:00:00.000Z',
        statusDetail: { investments: { warnings: [{ message: 'sem code' }] } },
      })

    await expect(gateway.fetchItem('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_ITEMS_RESPONSE_INVALID',
      details: { field: 'statusDetail.investments.warnings[0]' },
    })
  })

  it('devolve lastUpdatedAt undefined quando a Pluggy não traz esse campo', async () => {
    const client = clientReturning({ status: 'UPDATING', executionStatus: 'SUCCESS' })

    const item = await gateway.fetchItem('item-1', client)
    expect(item.lastUpdatedAt).toBeUndefined()
  })

  it('recusa com PLUGGY_ITEM_NOT_FOUND em 404, nomeando o itemId', async () => {
    const client = clientRejecting(pluggySdkHttpError(404))

    try {
      await gateway.fetchItem('item-inexistente', client)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_ITEM_NOT_FOUND')
      expect((error as ApplicationError).details).toMatchObject({ itemId: 'item-inexistente' })
    }
  })

  it('recusa com PLUGGY_ITEMS_TIMEOUT quando a chamada estoura o timeout', async () => {
    // O SDK não embrulha timeout: ele sobe como `Error` do got, com `name` reconhecível.
    const client = clientRejecting(pluggySdkTimeout())

    await expect(gateway.fetchItem('item-1', client)).rejects.toMatchObject({ errorType: 'PLUGGY_ITEMS_TIMEOUT' })
  })

  it('falha de rede recusa como indisponível, não como erro da Pluggy', async () => {
    const client = clientRejecting(pluggySdkNetworkFailure())

    await expect(gateway.fetchItem('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_ITEMS_UNAVAILABLE',
    })
  })

  it('erro da Pluggy sem nome próprio preserva code e message, que é o que resta do status engolido', async () => {
    const client = clientRejecting(pluggySdkHttpError(500, 'internal'))

    await expect(gateway.fetchItem('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_ITEMS_UPSTREAM_ERROR',
      details: { itemId: 'item-1', pluggyCode: 500, pluggyMessage: 'internal' },
    })
  })

  it('aceita lastUpdatedAt como Date, que é como o SDK o entrega quando a string tem milissegundo', async () => {
    // `deserializeJSONWithDates` converte só o formato de 24 caracteres; o mesmo campo chega `Date` ou
    // `string` conforme o que a Pluggy mandou (padroes-de-engenharia, 3b.1). As duas formas valem.
    const client = clientReturning({
      status: 'UPDATED',
      executionStatus: 'SUCCESS',
      lastUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
    })

    const item = await gateway.fetchItem('item-1', client)

    expect(item.lastUpdatedAt).toBe('2026-08-01T00:00:00.000Z')
  })

  it('passa o itemId ao SDK, sem montar URL nem header', async () => {
    const fetchItem = vi.fn().mockResolvedValue({ status: 'UPDATED', executionStatus: 'SUCCESS' })

    await gateway.fetchItem('item-42', fakePluggyClient({ fetchItem }))

    expect(fetchItem).toHaveBeenCalledWith('item-42')
  })

  it('recusa com PLUGGY_ITEMS_RESPONSE_INVALID quando a resposta não traz status/executionStatus', async () => {
    const client = clientReturning({})

    await expect(gateway.fetchItem('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_ITEMS_RESPONSE_INVALID',
    })
  })

  it('recusa nomeando o campo quando lastUpdatedAt vem presente com tipo errado (não some em silêncio)', async () => {
    const client = clientReturning({ status: 'UPDATED', executionStatus: 'SUCCESS', lastUpdatedAt: 12345 })

    try {
      await gateway.fetchItem('item-1', client)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_ITEMS_RESPONSE_INVALID')
      expect((error as ApplicationError).details).toMatchObject({ itemId: 'item-1', field: 'lastUpdatedAt' })
    }
  })
})
