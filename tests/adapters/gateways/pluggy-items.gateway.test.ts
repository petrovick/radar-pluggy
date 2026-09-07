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
  it('devolve status, executionStatus, lastUpdatedAt e updatedAt em caso de sucesso', async () => {
    const client = clientReturning({
      status: 'UPDATED',
      executionStatus: 'SUCCESS',
      lastUpdatedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    })

    await expect(gateway.fetchItem('item-1', client)).resolves.toEqual({
      status: 'UPDATED',
      executionStatus: 'SUCCESS',
      lastUpdatedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      nextAutoSyncAt: undefined,
      // `statusDetail` ausente é item sem ressalva alguma — normal, não erro.
      products: {},
      itemProducts: undefined,
      connector: undefined,
      // Change pluggy-complete-data-capture, spec pluggy-raw-payload-audit: payload bruto inteiro.
      raw: {
        status: 'UPDATED',
        executionStatus: 'SUCCESS',
        lastUpdatedAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    })
  })

  it('recusa quando updatedAt está ausente — campo obrigatório do SDK (D27)', async () => {
    const client = clientReturning({ status: 'UPDATED', executionStatus: 'SUCCESS' })

    await expect(gateway.fetchItem('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_ITEMS_RESPONSE_INVALID',
      details: { itemId: 'item-1', field: 'updatedAt' },
    })
  })

  it('expõe os avisos por produto do statusDetail, com a chave correta de investmentTransactions e loans (D7)', async () => {
    const client = clientReturning({
      status: 'UPDATED',
      executionStatus: 'PARTIAL_SUCCESS',
      lastUpdatedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      statusDetail: {
        accounts: { isUpdated: true, lastUpdatedAt: '2026-08-01T00:00:00.000Z' },
        investments: {
          isUpdated: false,
          lastUpdatedAt: null,
          warnings: [{ code: 'RATE_LIMIT', message: 'monthly limit reached', providerMessage: null }],
        },
        investmentTransactions: { isUpdated: true, lastUpdatedAt: '2026-08-01T00:00:00.000Z' },
        loans: { isUpdated: true, lastUpdatedAt: '2026-08-01T00:00:00.000Z' },
        identity: { isUpdated: false, lastUpdatedAt: null },
      },
    })

    const item = await gateway.fetchItem('item-1', client)

    expect(item.products.accounts).toEqual({ isUpdated: true, lastUpdatedAt: '2026-08-01T00:00:00.000Z', warnings: [] })
    expect(item.products.investments?.warnings).toEqual([{ code: 'RATE_LIMIT', message: 'monthly limit reached' }])
    expect(item.products.investmentTransactions).toEqual({
      isUpdated: true,
      lastUpdatedAt: '2026-08-01T00:00:00.000Z',
      warnings: [],
    })
    expect(item.products.loans).toEqual({ isUpdated: true, lastUpdatedAt: '2026-08-01T00:00:00.000Z', warnings: [] })
    // `identity` não é produto que este serviço consome (fronteira-pluggy, regra 5).
    expect(item.products).not.toHaveProperty('identity')
  })

  it('a chave antiga em plural (investmentsTransactions) nunca é reconhecida — só a correta bate', async () => {
    const client = clientReturning({
      status: 'UPDATED',
      executionStatus: 'PARTIAL_SUCCESS',
      lastUpdatedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      statusDetail: { investmentsTransactions: { isUpdated: true, lastUpdatedAt: '2026-08-01T00:00:00.000Z' } },
    })

    const item = await gateway.fetchItem('item-1', client)
    expect(item.products).not.toHaveProperty('investmentsTransactions')
    expect(item.products).not.toHaveProperty('investmentTransactions')
  })

  it('recusa statusDetail com forma inesperada, em vez de assumir "sem avisos"', async () => {
    const client = clientReturning({
      status: 'UPDATED',
      executionStatus: 'PARTIAL_SUCCESS',
      lastUpdatedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      statusDetail: { investments: { warnings: [{ message: 'sem code' }] } },
    })

    await expect(gateway.fetchItem('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_ITEMS_RESPONSE_INVALID',
      details: { field: 'statusDetail.investments.warnings[0]' },
    })
  })

  it('devolve lastUpdatedAt undefined quando a Pluggy não traz esse campo', async () => {
    const client = clientReturning({ status: 'UPDATING', executionStatus: 'SUCCESS', updatedAt: '2026-08-01T00:00:00.000Z' })

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
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    })

    const item = await gateway.fetchItem('item-1', client)

    expect(item.lastUpdatedAt).toBe('2026-08-01T00:00:00.000Z')
    expect(item.updatedAt).toBe('2026-08-01T00:00:00.000Z')
  })

  it('passa o itemId ao SDK, sem montar URL nem header', async () => {
    const fetchItem = vi.fn().mockResolvedValue({ status: 'UPDATED', executionStatus: 'SUCCESS', updatedAt: '2026-08-01T00:00:00.000Z' })

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
    const client = clientReturning({
      status: 'UPDATED',
      executionStatus: 'SUCCESS',
      lastUpdatedAt: 12345,
      updatedAt: '2026-08-01T00:00:00.000Z',
    })

    try {
      await gateway.fetchItem('item-1', client)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).errorType).toBe('PLUGGY_ITEMS_RESPONSE_INVALID')
      expect((error as ApplicationError).details).toMatchObject({ itemId: 'item-1', field: 'lastUpdatedAt' })
    }
  })

  describe('itemProducts (D26)', () => {
    it('parseia a lista de produtos habilitados neste Item, do payload bruto', async () => {
      const client = clientReturning({
        status: 'UPDATED',
        executionStatus: 'SUCCESS',
        updatedAt: '2026-08-01T00:00:00.000Z',
        products: ['ACCOUNTS', 'TRANSACTIONS'],
      })

      const item = await gateway.fetchItem('item-1', client)
      expect(item.itemProducts).toEqual(['ACCOUNTS', 'TRANSACTIONS'])
    })

    it('produtos ausentes viram UNKNOWN (undefined), nunca []', async () => {
      const client = clientReturning({ status: 'UPDATED', executionStatus: 'SUCCESS', updatedAt: '2026-08-01T00:00:00.000Z' })

      const item = await gateway.fetchItem('item-1', client)
      expect(item.itemProducts).toBeUndefined()
    })

    it('produtos em formato não reconhecível (não array de strings) viram UNKNOWN, nunca erro nem []', async () => {
      const client = clientReturning({
        status: 'UPDATED',
        executionStatus: 'SUCCESS',
        updatedAt: '2026-08-01T00:00:00.000Z',
        products: [{ nome: 'ACCOUNTS' }],
      })

      const item = await gateway.fetchItem('item-1', client)
      expect(item.itemProducts).toBeUndefined()
    })

    it('lista vazia de verdade (a Pluggy afirmando nenhum produto) é distinta de UNKNOWN', async () => {
      const client = clientReturning({
        status: 'UPDATED',
        executionStatus: 'SUCCESS',
        updatedAt: '2026-08-01T00:00:00.000Z',
        products: [],
      })

      const item = await gateway.fetchItem('item-1', client)
      expect(item.itemProducts).toEqual([])
    })
  })

  describe('connector (D8/D19)', () => {
    it('parseia connectorId, nome, imagem, cor e produtos suportados a partir do payload do Item', async () => {
      const client = clientReturning({
        status: 'UPDATED',
        executionStatus: 'SUCCESS',
        updatedAt: '2026-08-01T00:00:00.000Z',
        connector: {
          id: 201,
          name: 'Banco Exemplo',
          imageUrl: 'https://cdn.pluggy.ai/connectors/201.svg',
          primaryColor: '000000',
          products: ['ACCOUNTS', 'TRANSACTIONS', 'INVESTMENTS'],
        },
      })

      const item = await gateway.fetchItem('item-1', client)
      expect(item.connector).toEqual({
        connectorId: 201,
        name: 'Banco Exemplo',
        imageUrl: 'https://cdn.pluggy.ai/connectors/201.svg',
        primaryColor: '000000',
        products: ['ACCOUNTS', 'TRANSACTIONS', 'INVESTMENTS'],
      })
    })

    it('connector ausente vira undefined, nunca erro', async () => {
      const client = clientReturning({ status: 'UPDATED', executionStatus: 'SUCCESS', updatedAt: '2026-08-01T00:00:00.000Z' })
      const item = await gateway.fetchItem('item-1', client)
      expect(item.connector).toBeUndefined()
    })

    it('recusa nomeando o campo quando connector.id vem com tipo errado', async () => {
      const client = clientReturning({
        status: 'UPDATED',
        executionStatus: 'SUCCESS',
        updatedAt: '2026-08-01T00:00:00.000Z',
        connector: { id: '201', name: 'Banco Exemplo' },
      })

      await expect(gateway.fetchItem('item-1', client)).rejects.toMatchObject({
        errorType: 'PLUGGY_ITEMS_RESPONSE_INVALID',
        details: { field: 'connector.id' },
      })
    })
  })

  it('parseia nextAutoSyncAt quando presente', async () => {
    const client = clientReturning({
      status: 'UPDATED',
      executionStatus: 'SUCCESS',
      updatedAt: '2026-08-01T00:00:00.000Z',
      nextAutoSyncAt: '2026-08-02T00:00:00.000Z',
    })

    const item = await gateway.fetchItem('item-1', client)
    expect(item.nextAutoSyncAt).toBe('2026-08-02T00:00:00.000Z')
  })
})
