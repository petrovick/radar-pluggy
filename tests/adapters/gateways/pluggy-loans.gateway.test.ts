import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { PluggyLoansGateway } from '../../../src/adapters/gateways/pluggy-loans.gateway.js'
import { fakePluggyClient, pluggySdkTimeout } from './fake-pluggy-client.js'

const gateway = new PluggyLoansGateway()

function clientReturning(body: unknown) {
  return fakePluggyClient({ fetchLoans: async () => body })
}

function clientRejecting(error: unknown) {
  return fakePluggyClient({
    fetchLoans: async () => {
      throw error
    },
  })
}

function rawLoan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'loan-1',
    itemId: 'item-1',
    contractNumber: '12345',
    productName: 'Crédito Pessoal',
    type: 'CREDITO_PESSOAL_SEM_CONSIGNACAO',
    kind: 'LOAN',
    date: '2026-08-01T00:00:00.000Z',
    contractDate: '2026-01-01T00:00:00.000Z',
    settlementDate: null,
    contractAmount: 10000,
    currencyCode: 'BRL',
    dueDate: '2028-01-01T00:00:00.000Z',
    installments: {
      totalNumberOfInstallments: 24,
      paidInstallments: 5,
      dueInstallments: 19,
      pastDueInstallments: 0,
    },
    payments: {
      contractOutstandingBalance: 8000.5,
    },
    ...overrides,
  }
}

describe('PluggyLoansGateway.fetchLoansPage', () => {
  it('traduz e converte contractAmount/outstandingBalance para Decimal', async () => {
    const client = clientReturning({ page: 1, total: 1, totalPages: 1, results: [rawLoan()] })

    const page = await gateway.fetchLoansPage('item-1', client)
    const loan = page.results[0]
    expect(loan?.loanId).toBe('loan-1')
    expect(loan?.productName).toBe('Crédito Pessoal')
    expect(loan?.kind).toBe('LOAN')
    expect(loan?.contractAmount).toEqual(new Decimal('10000'))
    expect(loan?.outstandingBalance).toEqual(new Decimal('8000.5'))
    expect(loan?.totalInstallments).toBe(24)
    expect(loan?.paidInstallments).toBe(5)
    expect(loan?.dueInstallments).toBe(19)
    expect(loan?.pastDueInstallments).toBe(0)
    expect(loan?.collectedAt).toEqual(new Date('2026-08-01T00:00:00.000Z'))
  })

  it('devolve página com metadados validados', async () => {
    const client = clientReturning({ page: 1, total: 2, totalPages: 2, results: [rawLoan()] })

    const page = await gateway.fetchLoansPage('item-1', client, 1)
    expect(page.page).toBe(1)
    expect(page.totalPages).toBe(2)
    expect(page.total).toBe(2)
    expect(page.results).toHaveLength(1)
  })

  it('recusa quando página retornada diverge da requisitada', async () => {
    const client = clientReturning({ page: 2, total: 10, totalPages: 5, results: [] })

    await expect(gateway.fetchLoansPage('item-1', client, 1)).rejects.toMatchObject({
      errorType: 'PLUGGY_LOANS_PAGE_MISMATCH',
    })
  })

  it('recusa quando metadados de paginação são inválidos', async () => {
    const client = clientReturning({ page: 1, total: 10, totalPages: -1, results: [] })

    await expect(gateway.fetchLoansPage('item-1', client, 1)).rejects.toMatchObject({
      errorType: 'PLUGGY_LOANS_RESPONSE_INVALID',
      details: { field: 'totalPages' },
    })
  })

  it('devolve lista vazia quando results é [] — nem todo item tem empréstimo', async () => {
    const client = clientReturning({ page: 1, total: 0, totalPages: 1, results: [] })

    const page = await gateway.fetchLoansPage('item-1', client)
    expect(page.results).toEqual([])
  })

  it('recusa nomeando o item e o campo quando um empréstimo não traz productName', async () => {
    const loanWithoutProductName = rawLoan()
    delete loanWithoutProductName.productName
    const client = clientReturning({ page: 1, total: 1, totalPages: 1, results: [loanWithoutProductName] })

    await expect(gateway.fetchLoansPage('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_LOAN_RESPONSE_INVALID',
      details: { itemId: 'item-1', index: 0, field: 'productName' },
    })
  })

  it('aceita empréstimo sem nenhum campo opcional', async () => {
    const client = clientReturning({
      page: 1,
      total: 1,
      totalPages: 1,
      results: [
        {
          id: 'loan-2',
          itemId: 'item-1',
          productName: 'Financiamento',
          kind: 'FINANCING',
          currencyCode: 'BRL',
        },
      ],
    })

    const page = await gateway.fetchLoansPage('item-1', client)
    const loan = page.results[0]
    expect(loan?.contractNumber).toBeUndefined()
    expect(loan?.type).toBeUndefined()
    expect(loan?.collectedAt).toBeUndefined()
    expect(loan?.contractAmount).toBeUndefined()
    expect(loan?.totalInstallments).toBeUndefined()
    expect(loan?.outstandingBalance).toBeUndefined()
  })

  it('installments/payments null inteiros viram subcampos ausentes, nunca erro', async () => {
    const client = clientReturning({
      page: 1,
      total: 1,
      totalPages: 1,
      results: [rawLoan({ installments: null, payments: null })],
    })

    const page = await gateway.fetchLoansPage('item-1', client)
    const loan = page.results[0]
    expect(loan?.totalInstallments).toBeUndefined()
    expect(loan?.paidInstallments).toBeUndefined()
    expect(loan?.dueInstallments).toBeUndefined()
    expect(loan?.pastDueInstallments).toBeUndefined()
    expect(loan?.outstandingBalance).toBeUndefined()
  })

  it('installments presente com tipo errado (não objeto) recusa nomeando o campo', async () => {
    const client = clientReturning({
      page: 1,
      total: 1,
      totalPages: 1,
      results: [rawLoan({ installments: 'não é objeto' })],
    })

    await expect(gateway.fetchLoansPage('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_LOAN_RESPONSE_INVALID',
      details: { itemId: 'item-1', index: 0, field: 'installments' },
    })
  })

  it('recusa nomeando o campo quando um opcional aninhado vem presente com tipo errado', async () => {
    const client = clientReturning({
      page: 1,
      total: 1,
      totalPages: 1,
      results: [rawLoan({ installments: { totalNumberOfInstallments: 'vinte e quatro' } })],
    })

    await expect(gateway.fetchLoansPage('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_LOAN_RESPONSE_INVALID',
      details: { itemId: 'item-1', index: 0, field: 'installments.totalNumberOfInstallments' },
    })
  })

  it('recusa com PLUGGY_LOANS_TIMEOUT quando a chamada estoura o timeout', async () => {
    const client = clientRejecting(pluggySdkTimeout())

    await expect(gateway.fetchLoansPage('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_LOANS_TIMEOUT',
    })
  })

  it('propaga a página requisitada para o client do SDK', async () => {
    const client = fakePluggyClient({
      fetchLoans: async (_itemId: string, options: { page: number }) => ({
        page: options.page,
        total: 2,
        totalPages: 2,
        results: [rawLoan({ id: `loan-${options.page}` })],
      }),
    })

    const page2 = await gateway.fetchLoansPage('item-1', client, 2)
    expect(page2.page).toBe(2)
    expect(page2.results[0]?.loanId).toBe('loan-2')
  })

  // Change pluggy-complete-data-capture, spec pluggy-loan: schema completo do contrato.
  it('lê o schema completo do contrato quando presente', async () => {
    const client = clientReturning({
      page: 1,
      total: 1,
      totalPages: 1,
      results: [
        rawLoan({
          ipocCode: 'IPOC-123',
          disbursementDates: ['2026-01-01T00:00:00.000Z'],
          firstInstallmentDueDate: '2026-02-01T00:00:00.000Z',
          CET: 15.5,
          installmentPeriodicity: 'MONTHLY',
          amortizationScheduled: 'SAC',
          cnpjConsignee: '12.345.678/0001-00',
          interestRates: [{ taxType: 'NOMINAL' }],
          contractedFees: [{ name: 'Tarifa' }],
          contractedFinanceCharges: [{ type: 'IOF' }],
          warranties: [{ type: 'AVAL' }],
        }),
      ],
    })

    const page = await gateway.fetchLoansPage('item-1', client)
    const loan = page.results[0]
    expect(loan?.ipocCode).toBe('IPOC-123')
    expect(loan?.disbursementDates).toEqual([new Date('2026-01-01T00:00:00.000Z')])
    expect(loan?.firstInstallmentDueDate).toEqual(new Date('2026-02-01T00:00:00.000Z'))
    expect(loan?.cet).toEqual(new Decimal('15.5'))
    expect(loan?.installmentPeriodicity).toBe('MONTHLY')
    expect(loan?.amortizationScheduled).toBe('SAC')
    expect(loan?.cnpjConsignee).toBe('12.345.678/0001-00')
    expect(loan?.interestRates).toEqual([{ taxType: 'NOMINAL' }])
    expect(loan?.contractedFees).toEqual([{ name: 'Tarifa' }])
    expect(loan?.contractedFinanceCharges).toEqual([{ type: 'IOF' }])
    expect(loan?.warranties).toEqual([{ type: 'AVAL' }])
    expect(loan?.installments).toEqual({
      totalNumberOfInstallments: 24,
      paidInstallments: 5,
      dueInstallments: 19,
      pastDueInstallments: 0,
    })
    expect(loan?.payments).toEqual({ contractOutstandingBalance: 8000.5 })
  })

  it('empréstimo sem nenhum campo do schema completo mantém tudo indefinido', async () => {
    const client = clientReturning({
      page: 1,
      total: 1,
      totalPages: 1,
      results: [
        { id: 'loan-2', itemId: 'item-1', productName: 'Financiamento', kind: 'FINANCING', currencyCode: 'BRL' },
      ],
    })

    const page = await gateway.fetchLoansPage('item-1', client)
    const loan = page.results[0]
    expect(loan?.ipocCode).toBeUndefined()
    expect(loan?.disbursementDates).toBeUndefined()
    expect(loan?.interestRates).toBeUndefined()
    expect(loan?.installments).toBeUndefined()
    expect(loan?.payments).toBeUndefined()
  })

  it('recusa quando um item de disbursementDates é ilegível como data', async () => {
    const client = clientReturning({
      page: 1,
      total: 1,
      totalPages: 1,
      results: [rawLoan({ disbursementDates: ['não é data'] })],
    })

    await expect(gateway.fetchLoansPage('item-1', client)).rejects.toMatchObject({
      errorType: 'PLUGGY_LOAN_RESPONSE_INVALID',
      details: { itemId: 'item-1', index: 0, field: 'disbursementDates[0]' },
    })
  })
})
