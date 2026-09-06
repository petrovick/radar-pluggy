import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { PluggyInvestmentTransactionsGateway } from '../../../src/adapters/gateways/pluggy-investment-transactions.gateway.js'
import { fakePluggyClient, pluggySdkHttpError, pluggySdkTimeout } from './fake-pluggy-client.js'
import type {
  PluggyInvestmentTransactionDto,
  PluggyInvestmentTransactionsPageDto,
} from '../../../src/adapters/gateways/pluggy-investment-transactions.gateway.js'

async function collectTx(
  pages: AsyncGenerator<PluggyInvestmentTransactionsPageDto>,
): Promise<PluggyInvestmentTransactionDto[]> {
  const all: PluggyInvestmentTransactionDto[] = []
  for await (const page of pages) {
    all.push(...page.results)
  }
  return all
}

const gateway = new PluggyInvestmentTransactionsGateway()

// O SDK entrega o objeto já desserializado; o que o gateway faz, e o que estes testes exercitam, é
// validar e traduzir (padroes-de-engenharia, 3b).
function clientReturning(body: unknown) {
  return fakePluggyClient({ fetchInvestmentTransactions: async () => body })
}

function clientRejecting(error: unknown) {
  return fakePluggyClient({
    fetchInvestmentTransactions: async () => {
      throw error
    },
  })
}

function validTxPayload(id = 'itx-1', overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'BUY',
    date: '2026-06-23T00:00:00.000Z',
    quantity: 6.12345678,
    value: 34.26123456,
    amount: 205.56,
    netAmount: 205.56,
    priceFactor: 1,
    expenses: {
      brokerageFee: 2.5,
      incomeTax: 10.2,
    },
    ...overrides,
  }
}

describe('PluggyInvestmentTransactionsGateway', () => {
  it('converte valores para Decimal na fronteira (8 casas para quantidade e valor, 2 para despesas)', async () => {
    const client = clientReturning({
        page: 1,
        total: 1,
        totalPages: 1,
        results: [validTxPayload()],
      })

    const page = await gateway.fetchTransactionsPage('inv-1', client)
    expect(page.results).toHaveLength(1)
    expect(page.results[0]?.quantity).toEqual(new Decimal('6.12345678'))
    expect(page.results[0]?.value).toEqual(new Decimal('34.26123456'))
    expect(page.results[0]?.amount).toEqual(new Decimal('205.56'))
    expect(page.results[0]?.brokerageFee).toEqual(new Decimal('2.5'))
    expect(page.results[0]?.incomeTax).toEqual(new Decimal('10.2'))
  })

  it('fetchTransactionPages entrega uma página por vez até a última', async () => {
    // A página vem no `options` do método do SDK, não na query string.
    const client = fakePluggyClient({
      fetchInvestmentTransactions: async (_investmentId: string, options: { page: number }) => ({
        page: options.page,
        total: 2,
        totalPages: 2,
        results: [validTxPayload(`itx-${options.page}`)],
      }),
    })

    const all = await collectTx(gateway.fetchTransactionPages('inv-1', client))
    expect(all).toHaveLength(2)
    expect(all[0]?.transactionId).toBe('itx-1')
    expect(all[1]?.transactionId).toBe('itx-2')
  })

  it('recusa quando totalPages muda durante a varredura', async () => {
    const client = fakePluggyClient({
      fetchInvestmentTransactions: async (_investmentId: string, options: { page: number }) => ({
        page: options.page,
        total: 2,
        totalPages: options.page === 1 ? 2 : 3,
        results: [validTxPayload()],
      }),
    })

    await expect(collectTx(gateway.fetchTransactionPages('inv-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_INVESTMENT_TRANSACTIONS_TOTAL_PAGES_CHANGED',
    })
  })

  it('recusa quando campo obrigatório id está ausente', async () => {
    const client = clientReturning({
        page: 1,
        total: 1,
        totalPages: 1,
        results: [validTxPayload('', { id: '' })],
      })

    await expect(gateway.fetchTransactionsPage('inv-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_INVESTMENT_TRANSACTION_RESPONSE_INVALID',
      details: { field: 'id' },
    })
  })

  it('recusa com erro de timeout quando a chamada estoura', async () => {
    const client = clientRejecting(pluggySdkTimeout())

    await expect(gateway.fetchTransactionsPage('inv-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_INVESTMENT_TRANSACTIONS_TIMEOUT',
    })
  })

  it('recusa com UPSTREAM_ERROR quando status não é ok', async () => {
    const client = clientRejecting(pluggySdkHttpError(500))

    await expect(gateway.fetchTransactionsPage('inv-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_INVESTMENT_TRANSACTIONS_UPSTREAM_ERROR',
      details: { pluggyCode: 500 },
    })
  })
})
