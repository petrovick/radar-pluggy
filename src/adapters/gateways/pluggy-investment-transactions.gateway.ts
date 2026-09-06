import { Decimal } from 'decimal.js'
import { ApplicationError } from '../../shared/application-error.js'
import { pluggySdkError, toDateOrUndefined, type PluggyConnectorClient } from './pluggy-client.gateway.js'


export interface PluggyInvestmentTransactionDto {
  transactionId: string
  investmentId: string
  type: string
  movementType: string | undefined
  quantity: Decimal | undefined
  value: Decimal | undefined
  amount: Decimal | undefined
  netAmount: Decimal | undefined
  priceFactor: Decimal | undefined
  indexerPercentage: Decimal | undefined
  agreedRate: Decimal | undefined
  date: Date
  tradeDate: Date | undefined
  description: string | undefined
  brokerageNumber: string | undefined
  serviceTax: Decimal | undefined
  brokerageFee: Decimal | undefined
  incomeTax: Decimal | undefined
  tradingAssetsNoticeFee: Decimal | undefined
  maintenanceFee: Decimal | undefined
  settlementFee: Decimal | undefined
  clearingFee: Decimal | undefined
  stockExchangeFee: Decimal | undefined
  custodyFee: Decimal | undefined
  operatingFee: Decimal | undefined
  other: Decimal | undefined
  iof: Decimal | undefined
  iofProvision: Decimal | undefined
  // Payload bruto, exatamente como recebido, capturado antes desta validação (change
  // pluggy-complete-data-capture, spec pluggy-raw-payload-audit).
  raw: Record<string, unknown>
}

export interface PluggyInvestmentTransactionsPageDto {
  results: PluggyInvestmentTransactionDto[]
  page: number
  total: number
  totalPages: number
}

interface PluggyInvestmentTransactionsResponse {
  results?: unknown
  page?: unknown
  total?: unknown
  totalPages?: unknown
}

export class PluggyInvestmentTransactionsGateway {
  async fetchTransactionsPage(
    investmentId: string,
    client: PluggyConnectorClient,
    page = 1,
    pageSize = 500,
  ): Promise<PluggyInvestmentTransactionsPageDto> {
    if (!Number.isInteger(page) || page < 1) {
      throw new ApplicationError('PLUGGY_INVESTMENT_TRANSACTIONS_INVALID_PAGE', { investmentId, page })
    }

    let data: PluggyInvestmentTransactionsResponse
    try {
      // `fetchInvestmentTransactions`, nunca `fetchAllInvestmentTransactions`: a versão "all" acumula
      // a lista inteira em memória e impediria persistir por página (padroes-de-engenharia, 3b.2).
      data = (await client.fetchInvestmentTransactions(investmentId, {
        page,
        pageSize,
      })) as unknown as PluggyInvestmentTransactionsResponse
    } catch (error) {
      throw pluggySdkError(
        error,
        {
          timeout: 'PLUGGY_INVESTMENT_TRANSACTIONS_TIMEOUT',
          unavailable: 'PLUGGY_INVESTMENT_TRANSACTIONS_UNAVAILABLE',
          upstream: 'PLUGGY_INVESTMENT_TRANSACTIONS_UPSTREAM_ERROR',
        },
        { investmentId },
      )
    }

    return this.parseTransactionsPage(investmentId, data, page)
  }

  // Uma página por vez, entregue na hora — ver a nota em `pluggy-accounts.gateway.ts#fetchAccountPages`.
  async *fetchTransactionPages(
    investmentId: string,
    client: PluggyConnectorClient,
  ): AsyncGenerator<PluggyInvestmentTransactionsPageDto> {
    const firstPage = await this.fetchTransactionsPage(investmentId, client, 1)
    yield firstPage

    for (let page = 2; page <= firstPage.totalPages; page++) {
      const nextPage = await this.fetchTransactionsPage(investmentId, client, page)
      if (nextPage.totalPages !== firstPage.totalPages) {
        throw new ApplicationError('PLUGGY_INVESTMENT_TRANSACTIONS_TOTAL_PAGES_CHANGED', {
          investmentId,
          expectedTotalPages: firstPage.totalPages,
          receivedTotalPages: nextPage.totalPages,
        })
      }
      yield nextPage
    }
  }

  private parseTransactionsPage(
    investmentId: string,
    data: PluggyInvestmentTransactionsResponse,
    requestedPage: number,
  ): PluggyInvestmentTransactionsPageDto {

    // Envelope obrigatório, sem default silencioso — ver a mesma nota em `pluggy-accounts.gateway.ts`.
    // `GET /investments/{id}/transactions` sempre traz `results`/`page`/`totalPages` (design.md,
    // tabela de rotas; confirmado no dump de 264 movimentações).
    if (!Array.isArray(data.results)) {
      throw new ApplicationError('PLUGGY_INVESTMENT_TRANSACTIONS_RESPONSE_INVALID', { investmentId, field: 'results' })
    }
    const rawResults: unknown[] = data.results

    if (typeof data.page !== 'number' || !Number.isInteger(data.page)) {
      throw new ApplicationError('PLUGGY_INVESTMENT_TRANSACTIONS_RESPONSE_INVALID', { investmentId, field: 'page' })
    }
    if (data.page !== requestedPage) {
      throw new ApplicationError('PLUGGY_INVESTMENT_TRANSACTIONS_PAGE_MISMATCH', {
        investmentId,
        expectedPage: requestedPage,
        receivedPage: data.page,
      })
    }
    const page = data.page

    if (typeof data.totalPages !== 'number' || !Number.isInteger(data.totalPages) || data.totalPages < 0) {
      throw new ApplicationError('PLUGGY_INVESTMENT_TRANSACTIONS_RESPONSE_INVALID', { investmentId, field: 'totalPages' })
    }
    const totalPages = data.totalPages

    if (typeof data.total !== 'number' || !Number.isInteger(data.total) || data.total < 0) {
      throw new ApplicationError('PLUGGY_INVESTMENT_TRANSACTIONS_RESPONSE_INVALID', { investmentId, field: 'total' })
    }
    const total = data.total

    const results = rawResults.map((raw, index) => this.toDto(investmentId, index, raw))

    return {
      results,
      page,
      total,
      totalPages,
    }
  }

  private toDto(investmentId: string, index: number, raw: unknown): PluggyInvestmentTransactionDto {
    if (typeof raw !== 'object' || raw === null) {
      throw new ApplicationError('PLUGGY_INVESTMENT_TRANSACTION_RESPONSE_INVALID', { investmentId, index, field: 'root' })
    }
    const tx = raw as Record<string, unknown>

    const transactionId = requireString(tx.id, investmentId, index, 'id')
    const type = requireString(tx.type, investmentId, index, 'type')
    const date = requireDate(tx.date, investmentId, index, 'date')

    const expenses = (typeof tx.expenses === 'object' && tx.expenses !== null ? tx.expenses : {}) as Record<string, unknown>

    return {
      transactionId,
      investmentId,
      type,
      date,
      movementType: optionalString(tx.movementType, investmentId, index, 'movementType'),
      quantity: optionalDecimal(tx.quantity, investmentId, index, 'quantity'),
      value: optionalDecimal(tx.value, investmentId, index, 'value'),
      amount: optionalDecimal(tx.amount, investmentId, index, 'amount'),
      netAmount: optionalDecimal(tx.netAmount, investmentId, index, 'netAmount'),
      priceFactor: optionalDecimal(tx.priceFactor, investmentId, index, 'priceFactor'),
      indexerPercentage: optionalDecimal(tx.indexerPercentage, investmentId, index, 'indexerPercentage'),
      agreedRate: optionalDecimal(tx.agreedRate, investmentId, index, 'agreedRate'),
      tradeDate: optionalDate(tx.tradeDate, investmentId, index, 'tradeDate'),
      description: optionalString(tx.description, investmentId, index, 'description'),
      brokerageNumber: optionalString(tx.brokerageNumber, investmentId, index, 'brokerageNumber'),
      serviceTax: optionalDecimal(expenses.serviceTax, investmentId, index, 'expenses.serviceTax'),
      brokerageFee: optionalDecimal(expenses.brokerageFee, investmentId, index, 'expenses.brokerageFee'),
      incomeTax: optionalDecimal(expenses.incomeTax, investmentId, index, 'expenses.incomeTax'),
      tradingAssetsNoticeFee: optionalDecimal(expenses.tradingAssetsNoticeFee, investmentId, index, 'expenses.tradingAssetsNoticeFee'),
      maintenanceFee: optionalDecimal(expenses.maintenanceFee, investmentId, index, 'expenses.maintenanceFee'),
      settlementFee: optionalDecimal(expenses.settlementFee, investmentId, index, 'expenses.settlementFee'),
      clearingFee: optionalDecimal(expenses.clearingFee, investmentId, index, 'expenses.clearingFee'),
      stockExchangeFee: optionalDecimal(expenses.stockExchangeFee, investmentId, index, 'expenses.stockExchangeFee'),
      custodyFee: optionalDecimal(expenses.custodyFee, investmentId, index, 'expenses.custodyFee'),
      operatingFee: optionalDecimal(expenses.operatingFee, investmentId, index, 'expenses.operatingFee'),
      other: optionalDecimal(expenses.other, investmentId, index, 'expenses.other'),
      iof: optionalDecimal(expenses.iof, investmentId, index, 'expenses.iof'),
      iofProvision: optionalDecimal(expenses.iofProvision, investmentId, index, 'expenses.iofProvision'),
      raw: tx,
    }
  }
}

function requireString(value: unknown, investmentId: string, index: number, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApplicationError('PLUGGY_INVESTMENT_TRANSACTION_RESPONSE_INVALID', { investmentId, index, field })
  }
  return value
}

function requireDate(value: unknown, investmentId: string, index: number, field: string): Date {
  // Aceita as duas formas: o SDK converte para `Date` só quando a string tinha
  // milissegundo (padroes-de-engenharia, 3b.1). Ilegível recusa, nunca vira `undefined`.
  const date = toDateOrUndefined(value)
  if (date === undefined) {
    throw new ApplicationError('PLUGGY_INVESTMENT_TRANSACTION_RESPONSE_INVALID', { investmentId, index, field })
  }
  return date
}

function optionalString(value: unknown, investmentId: string, index: number, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApplicationError('PLUGGY_INVESTMENT_TRANSACTION_RESPONSE_INVALID', { investmentId, index, field })
  }
  return value
}

function optionalDate(value: unknown, investmentId: string, index: number, field: string): Date | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  const date = toDateOrUndefined(value)
  if (date === undefined) {
    throw new ApplicationError('PLUGGY_INVESTMENT_TRANSACTION_RESPONSE_INVALID', { investmentId, index, field })
  }
  return date
}

function optionalDecimal(value: unknown, investmentId: string, index: number, field: string): Decimal | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ApplicationError('PLUGGY_INVESTMENT_TRANSACTION_RESPONSE_INVALID', { investmentId, index, field })
  }
  return new Decimal(String(value))
}
