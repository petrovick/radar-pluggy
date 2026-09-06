import { Decimal } from 'decimal.js'
import { describe, expect, it, vi } from 'vitest'
import { PluggyAccountTransactionsGateway } from '../../../src/adapters/gateways/pluggy-account-transactions.gateway.js'
import { fakePluggyClient, pluggySdkHttpError, pluggySdkTimeout } from './fake-pluggy-client.js'
import type {
  PluggyAccountTransactionDto,
  PluggyAccountTransactionsPageDto,
} from '../../../src/adapters/gateways/pluggy-account-transactions.gateway.js'

async function collectTx(
  pages: AsyncGenerator<PluggyAccountTransactionsPageDto>,
): Promise<PluggyAccountTransactionDto[]> {
  const all: PluggyAccountTransactionDto[] = []
  for await (const page of pages) {
    all.push(...page.results)
  }
  return all
}

const gateway = new PluggyAccountTransactionsGateway()

// O SDK entrega o objeto já desserializado; o que o gateway faz, e o que estes testes exercitam, é
// validar e traduzir (padroes-de-engenharia, 3b).
function clientReturning(body: unknown) {
  return fakePluggyClient({ fetchTransactionsCursor: async () => body })
}

function clientRejecting(error: unknown) {
  return fakePluggyClient({
    fetchTransactionsCursor: async () => {
      throw error
    },
  })
}

function validTransactionPayload(accountId = 'acc-1', overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    description: 'Compra Mercado',
    currencyCode: 'BRL',
    amount: -18.24,
    date: '2026-09-03T04:22:50.758Z',
    accountId,
    type: 'DEBIT',
    status: 'POSTED',
    createdAt: '2026-09-03T04:40:13.580Z',
    updatedAt: '2026-09-03T04:40:13.580Z',
    ...overrides,
  }
}

describe('PluggyAccountTransactionsGateway', () => {
  it('converte amount e campos numéricos para Decimal na fronteira', async () => {
    const client = clientReturning({
        results: [validTransactionPayload('acc-1', { amount: -50.25, balance: 1200.5 })],
        next: null,
      })

    const page = await gateway.fetchTransactionsPage('acc-1', client)
    expect(page.results).toHaveLength(1)
    expect(page.results[0]?.amount).toEqual(new Decimal('-50.25'))
    expect(page.results[0]?.balance).toEqual(new Decimal('1200.5'))
    expect(page.next).toBeNull()
  })

  it('fetchTransactionPages entrega cada página e segue o cursor next relativo até next ser null', async () => {
    // O cursor volta ao SDK como o parâmetro `after`, extraído do link — nunca como URL a seguir.
    const fetchTransactionsCursor = vi.fn(async (_accountId: string, options: { after?: string }) =>
      options.after === 'token-pagina-2'
        ? { results: [validTransactionPayload('acc-1', { id: 'tx-2', amount: 100 })], next: null }
        : {
            results: [validTransactionPayload('acc-1', { id: 'tx-1', amount: -50 })],
            next: '/v2/transactions?accountId=acc-1&after=token-pagina-2',
          },
    )
    const client = fakePluggyClient({ fetchTransactionsCursor })

    const all = await collectTx(gateway.fetchTransactionPages('acc-1', client))
    expect(all).toHaveLength(2)
    expect(all[0]?.transactionId).toBe('tx-1')
    expect(all[1]?.transactionId).toBe('tx-2')
    // A primeira chamada vai sem cursor; a segunda leva só o token.
    expect(fetchTransactionsCursor.mock.calls[0]?.[1]).toEqual({})
    expect(fetchTransactionsCursor.mock.calls[1]?.[1]).toEqual({ after: 'token-pagina-2' })
  })

  it('cursor sem o parâmetro after recusa: paginação truncada gravaria histórico incompleto', async () => {
    // A validação anti-SSRF de caminho deixou de existir porque o caminho não vem mais do payload
    // (o endpoint é sempre `v2/transactions`). O que sobra de perigoso é `next` presente e inútil:
    // tratá-lo como "acabou" gravaria histórico parcial como se estivesse completo.
    const client = clientReturning({ results: [validTransactionPayload()], next: '/v2/transactions?accountId=acc-1' })

    await expect(collectTx(gateway.fetchTransactionPages('acc-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_TRANSACTIONS_CURSOR_INVALID',
    })
  })

  it('cursor ilegível como URL recusa em vez de virar fim de paginação', async () => {
    const client = clientReturning({ results: [validTransactionPayload()], next: '::: nao e url :::' })

    await expect(collectTx(gateway.fetchTransactionPages('acc-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_TRANSACTIONS_CURSOR_INVALID',
    })
  })

  it('cursor absoluto de outro host não vira requisição: só o token after é aproveitado', async () => {
    // Antes isto era recusa; agora é inofensivo por construção — o host nunca sai do payload, então
    // o pior que um `next` forjado consegue é sugerir um token, e o endpoint continua o mesmo.
    const fetchTransactionsCursor = vi.fn(async (_accountId: string, options: { after?: string }) =>
      options.after === undefined
        ? { results: [validTransactionPayload()], next: 'https://evil.example.com/v2/transactions?after=t2' }
        : { results: [], next: null },
    )

    await collectTx(gateway.fetchTransactionPages('acc-1', fakePluggyClient({ fetchTransactionsCursor })))

    expect(fetchTransactionsCursor.mock.calls[1]?.[1]).toEqual({ after: 't2' })
  })

  it('recusa ciclo de cursor', async () => {
    const client = clientReturning({
      results: [validTransactionPayload()],
      next: '/v2/transactions?accountId=acc-1&after=loop',
    })

    await expect(collectTx(gateway.fetchTransactionPages('acc-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_TRANSACTIONS_CURSOR_CYCLE',
    })
  })

  it('recusa quando transação vem com accountId diferente do consultado', async () => {
    const client = clientReturning({
        results: [validTransactionPayload('acc-divergente')],
        next: null,
      })

    await expect(gateway.fetchTransactionsPage('acc-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_TRANSACTIONS_ACCOUNT_ID_MISMATCH',
    })
  })

  it('recusa quando amount vem como string', async () => {
    const client = clientReturning({
        results: [validTransactionPayload('acc-1', { amount: '-18.24' })],
        next: null,
      })

    await expect(gateway.fetchTransactionsPage('acc-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_TRANSACTION_RESPONSE_INVALID',
      details: { field: 'amount' },
    })
  })

  it('lida com timeout', async () => {
    const client = clientRejecting(pluggySdkTimeout())

    await expect(gateway.fetchTransactionsPage('acc-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_TRANSACTIONS_TIMEOUT',
    })
  })

  it('lida com upstream error', async () => {
    const client = clientRejecting(pluggySdkHttpError(502))

    await expect(gateway.fetchTransactionsPage('acc-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_TRANSACTIONS_UPSTREAM_ERROR',
      details: { pluggyCode: 502 },
    })
  })

  // Change pluggy-complete-data-capture, spec pluggy-transaction-history: campo antes descartado.
  it('lê creditCardMetadata inteiro quando presente', async () => {
    const client = clientReturning({
      results: [
        validTransactionPayload('acc-1', {
          creditCardMetadata: { installmentNumber: 1, totalInstallments: 3, billForecastDate: '2026-10' },
        }),
      ],
      next: null,
    })

    const page = await gateway.fetchTransactionsPage('acc-1', client)
    expect(page.results[0]?.creditCardMetadata).toEqual({
      installmentNumber: 1,
      totalInstallments: 3,
      billForecastDate: '2026-10',
    })
  })

  it('transação de conta corrente sem creditCardMetadata mantém o campo indefinido', async () => {
    const client = clientReturning({ results: [validTransactionPayload()], next: null })

    const page = await gateway.fetchTransactionsPage('acc-1', client)
    expect(page.results[0]?.creditCardMetadata).toBeUndefined()
  })
})
