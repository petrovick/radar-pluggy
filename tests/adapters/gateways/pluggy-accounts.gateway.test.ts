import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import type { PluggyAccountDto, PluggyAccountsPageDto } from '../../../src/adapters/gateways/pluggy-accounts.gateway.js'
import { PluggyAccountsGateway } from '../../../src/adapters/gateways/pluggy-accounts.gateway.js'
import { fakePluggyClient, pluggySdkTimeout } from './fake-pluggy-client.js'

const gateway = new PluggyAccountsGateway()

// O SDK entrega o objeto já desserializado; o que o gateway faz, e o que estes testes exercitam, é
// validar e traduzir (padroes-de-engenharia, 3b).
function clientReturning(body: unknown) {
  return fakePluggyClient({ fetchAccountsPage: async () => body })
}

function clientRejecting(error: unknown) {
  return fakePluggyClient({
    fetchAccountsPage: async () => {
      throw error
    },
  })
}

// O gateway entrega página a página (D6). Nos testes que se interessam pelo conteúdo, achatamos —
// mas nunca no código de produção: lá quem itera persiste cada página na hora (6.1).
async function collectAccounts(pages: AsyncGenerator<PluggyAccountsPageDto>): Promise<PluggyAccountDto[]> {
  const all: PluggyAccountDto[] = []
  for await (const page of pages) {
    all.push(...page.results)
  }
  return all
}

function validAccountPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-1',
    itemId: 'item-1',
    type: 'BANK',
    subtype: 'CHECKING_ACCOUNT',
    name: 'Banco Exemplo',
    number: '12345-6',
    balance: 1500.50,
    currencyCode: 'BRL',
    createdAt: '2026-08-23T04:26:12.808Z',
    updatedAt: '2026-09-03T04:40:13.435Z',
    ...overrides,
  }
}

// Envelope sempre presente: é o que `/accounts` devolve de verdade (design.md, tabela de rotas), e o
// parser agora recusa qualquer coisa fora dessa forma em vez de assumir `totalPages: 1` em silêncio.
function envelope(results: unknown[], overrides: Record<string, unknown> = {}) {
  return { page: 1, total: results.length, totalPages: 1, results, ...overrides }
}

describe('PluggyAccountsGateway', () => {
  it('converte balance para Decimal na borda e valida campos obrigatórios', async () => {
    const client = clientReturning(envelope([validAccountPayload()]))

    const [account] = await collectAccounts(gateway.fetchAccountPages('item-1', client))
    expect(account?.balance).toEqual(new Decimal('1500.50'))
    expect(account?.accountId).toBe('acc-1')
    expect(account?.type).toBe('BANK')
  })

  it('fetchAccountsPage devolve página com metadados validados', async () => {
    const client = clientReturning(envelope([validAccountPayload()], { total: 2, totalPages: 2 }))

    const page = await gateway.fetchAccountsPage('item-1', client, 1)
    expect(page.page).toBe(1)
    expect(page.totalPages).toBe(2)
    expect(page.total).toBe(2)
  })

  it('fetchAccountPages entrega uma página por vez, sem acumular, até a última', async () => {
    // A página agora chega como argumento do método do SDK, não como query string na URL.
    const client = fakePluggyClient({
      fetchAccountsPage: async (_itemId: string, page: number) =>
        envelope([validAccountPayload({ id: `acc-${page}`, balance: 100 * page })], {
          page,
          total: 2,
          totalPages: 2,
        }),
    })

    const seen: number[] = []
    for await (const page of gateway.fetchAccountPages('item-1', client)) {
      seen.push(page.page)
      // Prova que o consumidor recebe cada página antes de a próxima ser buscada: se o gateway
      // acumulasse tudo antes de devolver, este corpo só rodaria depois da última requisição.
      expect(page.results).toHaveLength(1)
    }

    expect(seen).toEqual([1, 2])
  })

  it('recusa quando página retornada diverge da requisitada', async () => {
    const client = clientReturning(envelope([], { page: 2, total: 5, totalPages: 3 }))

    await expect(gateway.fetchAccountsPage('item-1', client, 1)).rejects.toMatchObject({
      errorType: 'PLUGGY_ACCOUNTS_PAGE_MISMATCH',
    })
  })

  it('recusa quando totalPages muda durante o laço entre páginas', async () => {
    const client = fakePluggyClient({
      fetchAccountsPage: async (_itemId: string, page: number) =>
        envelope([validAccountPayload()], { page, total: 5, totalPages: page === 1 ? 2 : 3 }),
    })

    await expect(collectAccounts(gateway.fetchAccountPages('item-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_ACCOUNTS_TOTAL_PAGES_CHANGED',
    })
  })

  it('recusa resposta sem envelope de paginação, em vez de assumir página única', async () => {
    const client = clientReturning([validAccountPayload()])

    await expect(gateway.fetchAccountsPage('item-1', client, 1)).rejects.toMatchObject({
      errorType: 'PLUGGY_ACCOUNTS_RESPONSE_INVALID',
      details: { field: 'results' },
    })
  })

  it('recusa envelope sem totalPages, em vez de assumir 1', async () => {
    const client = clientReturning({ page: 1, total: 1, results: [validAccountPayload()] })

    await expect(gateway.fetchAccountsPage('item-1', client, 1)).rejects.toMatchObject({
      errorType: 'PLUGGY_ACCOUNTS_RESPONSE_INVALID',
      details: { field: 'totalPages' },
    })
  })

  it('recusa quando campo obrigatório está ausente', async () => {
    const client = clientReturning(envelope([validAccountPayload({ number: '' })]))

    await expect(collectAccounts(gateway.fetchAccountPages('item-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_ACCOUNT_RESPONSE_INVALID',
      details: { field: 'number' },
    })
  })

  it('recusa quando tipo é inválido (não string)', async () => {
    const client = clientReturning(envelope([validAccountPayload({ type: 123 })]))

    await expect(collectAccounts(gateway.fetchAccountPages('item-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_ACCOUNT_RESPONSE_INVALID',
      details: { field: 'type' },
    })
  })

  it('lida com timeout', async () => {
    const client = clientRejecting(pluggySdkTimeout())

    await expect(collectAccounts(gateway.fetchAccountPages('item-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_ACCOUNTS_TIMEOUT',
    })
  })

  it('conta CREDIT com creditData completo traduz para Decimal e Date na borda', async () => {
    const client = clientReturning(
      envelope([
        validAccountPayload({
          type: 'CREDIT',
          creditData: {
            level: 'BLACK',
            brand: 'MASTERCARD',
            brandAdditionalInfo: 'Bandeira parceira',
            balanceCloseDate: '2026-08-20T00:00:00.000Z',
            balanceDueDate: '2026-08-27T00:00:00.000Z',
            availableCreditLimit: 5000,
            balanceForeignCurrency: 0,
            minimumPayment: 150.5,
            creditLimit: 10000,
            isLimitFlexible: true,
            status: 'ACTIVE',
            holderType: 'MAIN',
          },
        }),
      ]),
    )

    const [account] = await collectAccounts(gateway.fetchAccountPages('item-1', client))
    expect(account?.level).toBe('BLACK')
    expect(account?.brand).toBe('MASTERCARD')
    expect(account?.brandAdditionalInfo).toBe('Bandeira parceira')
    expect(account?.balanceCloseDate).toEqual(new Date('2026-08-20T00:00:00.000Z'))
    expect(account?.balanceDueDate).toEqual(new Date('2026-08-27T00:00:00.000Z'))
    expect(account?.availableCreditLimit).toEqual(new Decimal('5000'))
    expect(account?.balanceForeignCurrency).toEqual(new Decimal('0'))
    expect(account?.minimumPayment).toEqual(new Decimal('150.5'))
    expect(account?.creditLimit).toEqual(new Decimal('10000'))
    expect(account?.isLimitFlexible).toBe(true)
    expect(account?.status).toBe('ACTIVE')
    expect(account?.holderType).toBe('MAIN')
  })

  it('conta BANK sem creditData (null) não quebra e os campos de crédito ficam undefined', async () => {
    const client = clientReturning(envelope([validAccountPayload({ type: 'BANK', creditData: null })]))

    const [account] = await collectAccounts(gateway.fetchAccountPages('item-1', client))
    expect(account?.level).toBeUndefined()
    expect(account?.brand).toBeUndefined()
    expect(account?.brandAdditionalInfo).toBeUndefined()
    expect(account?.balanceCloseDate).toBeUndefined()
    expect(account?.balanceDueDate).toBeUndefined()
    expect(account?.availableCreditLimit).toBeUndefined()
    expect(account?.balanceForeignCurrency).toBeUndefined()
    expect(account?.minimumPayment).toBeUndefined()
    expect(account?.creditLimit).toBeUndefined()
    expect(account?.isLimitFlexible).toBeUndefined()
    expect(account?.status).toBeUndefined()
    expect(account?.holderType).toBeUndefined()
  })

  it('conta sem creditData no payload (ausente, não só null) também mantém campos de crédito undefined', async () => {
    const client = clientReturning(envelope([validAccountPayload()]))

    const [account] = await collectAccounts(gateway.fetchAccountPages('item-1', client))
    expect(account?.brand).toBeUndefined()
  })

  it('recusa quando creditData vem presente mas não é um objeto', async () => {
    const client = clientReturning(envelope([validAccountPayload({ type: 'CREDIT', creditData: 'invalido' })]))

    await expect(collectAccounts(gateway.fetchAccountPages('item-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_ACCOUNT_RESPONSE_INVALID',
      details: { field: 'creditData' },
    })
  })

  it('recusa quando campo interno de creditData tem tipo inválido', async () => {
    const client = clientReturning(
      envelope([validAccountPayload({ type: 'CREDIT', creditData: { creditLimit: 'dez mil' } })]),
    )

    await expect(collectAccounts(gateway.fetchAccountPages('item-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_ACCOUNT_RESPONSE_INVALID',
      details: { field: 'creditData.creditLimit' },
    })
  })

  it('recusa quando balanceCloseDate de creditData é ilegível', async () => {
    const client = clientReturning(
      envelope([validAccountPayload({ type: 'CREDIT', creditData: { balanceCloseDate: 'nunca' } })]),
    )

    await expect(collectAccounts(gateway.fetchAccountPages('item-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_ACCOUNT_RESPONSE_INVALID',
      details: { field: 'creditData.balanceCloseDate' },
    })
  })

  it('recusa quando status de creditData não é um dos valores conhecidos', async () => {
    const client = clientReturning(
      envelope([validAccountPayload({ type: 'CREDIT', creditData: { status: 'EM_ANALISE' } })]),
    )

    await expect(collectAccounts(gateway.fetchAccountPages('item-1', client))).rejects.toMatchObject({
      errorType: 'PLUGGY_ACCOUNT_RESPONSE_INVALID',
      details: { field: 'creditData.status' },
    })
  })
})
