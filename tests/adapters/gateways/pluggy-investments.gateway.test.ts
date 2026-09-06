import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { PluggyInvestmentsGateway } from '../../../src/adapters/gateways/pluggy-investments.gateway.js'
import { fakePluggyClient, pluggySdkTimeout } from './fake-pluggy-client.js'
import type {
  PluggyInvestmentDto,
  PluggyInvestmentsPageDto,
} from '../../../src/adapters/gateways/pluggy-investments.gateway.js'

async function collectInvestments(
  pages: AsyncGenerator<PluggyInvestmentsPageDto>,
): Promise<PluggyInvestmentDto[]> {
  const all: PluggyInvestmentDto[] = []
  for await (const page of pages) {
    all.push(...page.results)
  }
  return all
}

const gateway = new PluggyInvestmentsGateway()

// O SDK entrega o objeto já desserializado; o que o gateway faz, e o que estes testes exercitam, é
// validar e traduzir (padroes-de-engenharia, 3b).
function clientReturning(body: unknown) {
  return fakePluggyClient({ fetchInvestments: async () => body })
}

function clientRejecting(error: unknown) {
  return fakePluggyClient({
    fetchInvestments: async () => {
      throw error
    },
  })
}

describe('PluggyInvestmentsGateway', () => {
  it('converte balance, value com 8 casas e campos financeiros opcionais para Decimal', async () => {
    const client = clientReturning({
        page: 1,
        total: 1,
        totalPages: 1,
        results: [
          {
            id: 'inv-1',
            itemId: 'item-1',
            type: 'MUTUAL_FUND',
            subtype: 'MULTIMARKET_FUND',
            name: 'Fundo XYZ',
            code: '12.345.678/0001-00',
            isin: null,
            currencyCode: 'BRL',
            balance: 1359.39,
            quantity: 3.12345678,
            amountOriginal: 1000,
            value: 45.87654321,
            amount: 135.37,
            taxes: 1.5,
            taxes2: 0.75,
            status: 'ACTIVE',
            date: '2026-08-01T00:00:00.000Z',
            institution: { name: 'Banco Exemplo S/A', number: '00000000000191' },
          },
        ],
      })

    const [investment] = await collectInvestments(gateway.fetchInvestmentPages('item-1', client))
    expect(investment?.balance).toEqual(new Decimal('1359.39'))
    expect(investment?.quantity).toEqual(new Decimal('3.12345678'))
    expect(investment?.value).toEqual(new Decimal('45.87654321'))
    expect(investment?.amount).toEqual(new Decimal('135.37'))
    expect(investment?.taxes).toEqual(new Decimal('1.5'))
    expect(investment?.taxes2).toEqual(new Decimal('0.75'))
    expect(investment?.institutionName).toBe('Banco Exemplo S/A')
  })

  it('fetchInvestmentsPage devolve página com metadados validados', async () => {
    const client = clientReturning({
        page: 1,
        total: 2,
        totalPages: 2,
        results: [
          {
            id: 'inv-1',
            itemId: 'item-1',
            type: 'FIXED_INCOME',
            name: 'CDB',
            currencyCode: 'BRL',
            balance: 100,
            date: '2026-08-01T00:00:00.000Z',
          },
        ],
      })

    const page = await gateway.fetchInvestmentsPage('item-1', client, 1)
    expect(page.page).toBe(1)
    expect(page.totalPages).toBe(2)
    expect(page.total).toBe(2)
    expect(page.results).toHaveLength(1)
  })

  it('fetchInvestmentPages entrega uma página por vez até a última', async () => {
    // A página chega no `options` do método do SDK, não na query string da URL.
    const client = fakePluggyClient({
      fetchInvestments: async (_itemId: string, _type: unknown, options: { page: number }) => {
        const page = options.page
        return {
          page,
          total: 2,
          totalPages: 2,
          results: [
            {
              id: `inv-${page}`,
              itemId: 'item-1',
              type: 'FIXED_INCOME',
              name: `CDB ${page}`,
              currencyCode: 'BRL',
              balance: 100 * page,
              date: '2026-08-01T00:00:00.000Z',
            },
          ],
        }
      },
    })

    const investments = await collectInvestments(gateway.fetchInvestmentPages('item-1', client))
    expect(investments).toHaveLength(2)
    expect(investments[0]?.investmentId).toBe('inv-1')
    expect(investments[1]?.investmentId).toBe('inv-2')
  })

  it('recusa quando página retornada diverge da requisitada', async () => {
    const client = clientReturning({
        page: 2,
        total: 10,
        totalPages: 5,
        results: [],
      })

    await expect(gateway.fetchInvestmentsPage('item-1', client, 1)).rejects.toMatchObject({
      errorType: 'PLUGGY_INVESTMENTS_PAGE_MISMATCH',
    })
  })

  it('recusa quando metadados de paginação são inválidos', async () => {
    const client = clientReturning({
        page: 1,
        total: 10,
        totalPages: -1,
        results: [],
      })

    await expect(gateway.fetchInvestmentsPage('item-1', client, 1)).rejects.toMatchObject({
      errorType: 'PLUGGY_INVESTMENTS_RESPONSE_INVALID',
      details: { field: 'totalPages' },
    })
  })

  it('recusa quando totalPages muda durante a varredura entre páginas', async () => {
    // A página chega no `options` do método do SDK, não na query string da URL.
    const client = fakePluggyClient({
      fetchInvestments: async (_itemId: string, _type: unknown, options: { page: number }) => {
        const page = options.page
        return {
          page,
          total: 10,
          totalPages: page === 1 ? 2 : 3,
          results: [
            {
              id: `inv-${page}`,
              itemId: 'item-1',
              type: 'FIXED_INCOME',
              name: `CDB ${page}`,
              currencyCode: 'BRL',
              balance: 100,
              date: '2026-08-01T00:00:00.000Z',
            },
          ],
        }
      },
    })

    await expect(collectInvestments(gateway.fetchInvestmentPages('item-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_INVESTMENTS_TOTAL_PAGES_CHANGED',
    })
  })

  it('aceita investimento sem campo opcional (renda fixa sem quantity)', async () => {
    const client = clientReturning({
        page: 1,
        total: 1,
        totalPages: 1,
        results: [
          {
            id: 'inv-2',
            itemId: 'item-1',
            type: 'FIXED_INCOME',
            name: 'CDB Banco X',
            currencyCode: 'BRL',
            balance: 2000,
            date: '2026-08-01T00:00:00.000Z',
          },
        ],
      })

    const [investment] = await collectInvestments(gateway.fetchInvestmentPages('item-1', client))
    expect(investment?.quantity).toBeUndefined()
    expect(investment?.value).toBeUndefined()
    expect(investment?.institutionName).toBeUndefined()
  })

  it('devolve lista vazia quando results é []', async () => {
    const client = clientReturning({ page: 1, total: 0, totalPages: 1, results: [] })

    await expect(collectInvestments(gateway.fetchInvestmentPages('item-1', client))).resolves.toEqual([])
  })

  it('recusa nomeando o item e o campo quando um investimento não traz balance', async () => {
    const client = clientReturning({
        page: 1,
        total: 1,
        totalPages: 1,
        results: [
          {
            id: 'inv-1',
            itemId: 'item-1',
            type: 'MUTUAL_FUND',
            name: 'X',
            currencyCode: 'BRL',
            date: '2026-08-01T00:00:00.000Z',
          },
        ],
      })

    await expect(collectInvestments(gateway.fetchInvestmentPages('item-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_INVESTMENT_RESPONSE_INVALID',
      details: { itemId: 'item-1', index: 0, field: 'balance' },
    })
  })

  it('recusa nomeando o campo quando um opcional vem presente com tipo errado', async () => {
    const client = clientReturning({
        page: 1,
        total: 1,
        totalPages: 1,
        results: [
          {
            id: 'inv-1',
            itemId: 'item-1',
            type: 'MUTUAL_FUND',
            name: 'X',
            currencyCode: 'BRL',
            balance: 100,
            date: '2026-08-01T00:00:00.000Z',
            quantity: 'tres',
          },
        ],
      })

    await expect(collectInvestments(gateway.fetchInvestmentPages('item-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_INVESTMENT_RESPONSE_INVALID',
      details: { itemId: 'item-1', index: 0, field: 'quantity' },
    })
  })

  it('recusa com PLUGGY_INVESTMENTS_TIMEOUT quando a chamada estoura o timeout', async () => {
    const client = clientRejecting(pluggySdkTimeout())

    await expect(collectInvestments(gateway.fetchInvestmentPages('item-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_INVESTMENTS_TIMEOUT',
    })
  })
})

// `updatedAt` é o portão incremental da custódia (spec pluggy-transaction-history): sem ele a carga
// varre tudo de novo toda vez. Opcional no schema `Investment`, então as três formas importam.
describe('PluggyInvestmentsGateway — updatedAt do investimento', () => {
  function pageWith(updatedAt: unknown): unknown {
    const investment: Record<string, unknown> = {
      id: 'inv-1',
      itemId: 'item-1',
      type: 'EQUITY',
      name: 'VIVT3',
      currencyCode: 'BRL',
      balance: 304.5,
      date: '2026-08-01T00:00:00.000Z',
    }
    if (updatedAt !== undefined) {
      investment.updatedAt = updatedAt
    }
    return { page: 1, total: 1, totalPages: 1, results: [investment] }
  }

  it('lê updatedAt quando a Pluggy o envia', async () => {
    const client = clientReturning(pageWith('2026-08-30T12:00:00.000Z'))

    const page = await gateway.fetchInvestmentsPage('item-1', client)

    expect(page.results[0]?.updatedAt).toEqual(new Date('2026-08-30T12:00:00.000Z'))
  })

  it('ausente e null viram undefined — o consumidor cai no fallback de varredura integral', async () => {
    const clientAusente = clientReturning(pageWith(undefined))
    const clientNulo = clientReturning(pageWith(null))

    expect((await gateway.fetchInvestmentsPage('item-1', clientAusente)).results[0]?.updatedAt).toBeUndefined()
    expect((await gateway.fetchInvestmentsPage('item-1', clientNulo)).results[0]?.updatedAt).toBeUndefined()
  })

  it('presente com formato inválido recusa nomeando o campo, nunca vira undefined em silêncio', async () => {
    const client = clientReturning(pageWith('não é data'))

    await expect(gateway.fetchInvestmentsPage('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_INVESTMENT_RESPONSE_INVALID',
      details: { itemId: 'item-1', index: 0, field: 'updatedAt' },
    })
  })
})
