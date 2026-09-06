import { Decimal } from 'decimal.js'
import type { PluggyClient } from 'pluggy-sdk'
import { ApplicationError } from '../../shared/application-error.js'
import { pluggySdkError, toDateOrUndefined } from './pluggy-client.gateway.js'
import type { PluggyPositionMetadata } from '../../entities/pluggy-position.js'

// Mesmo shape que PluggyPositionRep.save espera — a fronteira de conversão pra Decimal (fronteira-pluggy
// regra 1) acontece aqui, uma vez, não em quem consome esta lista.
export interface PluggyInvestmentDto {
  investmentId: string
  itemId: string
  type: string
  subtype: string | undefined
  name: string
  code: string | undefined
  isin: string | undefined
  currencyCode: string
  balance: Decimal
  quantity: Decimal | undefined
  amountOriginal: Decimal | undefined
  value?: Decimal | undefined
  amount?: Decimal | undefined
  taxes?: Decimal | undefined
  taxes2?: Decimal | undefined
  status: string | undefined
  institutionName: string | undefined
  institutionNumber: string | undefined
  quotaDate: Date
  // `updatedAt` do schema `Investment`: "Date of the last update of the investment data". Opcional na
  // Pluggy, e é o que a carga de histórico usa como portão incremental da custódia — ausente força
  // varredura integral (spec pluggy-transaction-history).
  updatedAt: Date | undefined
  // Campos capturados na change pluggy-complete-data-capture (spec pluggy-position-sync) — antes
  // descartados aqui mesmo, antes de chegar à entity.
  issuerCnpj: string | undefined
  number: string | undefined
  amountWithdrawal: Decimal | undefined
  amountProfit: Decimal | undefined
  dueDate: Date | undefined
  issuer: string | undefined
  issueDate: Date | undefined
  purchaseDate: Date | undefined
  rate: Decimal | undefined
  rateType: string | undefined
  fixedAnnualRate: Decimal | undefined
  lastMonthRate: Decimal | undefined
  annualRate: Decimal | undefined
  lastTwelveMonthsRate: Decimal | undefined
  owner: string | undefined
  metadata: PluggyPositionMetadata | undefined
  // Payload bruto, exatamente como recebido, capturado antes desta validação (change
  // pluggy-complete-data-capture, spec pluggy-raw-payload-audit).
  raw: Record<string, unknown>
}

export interface PluggyInvestmentsPageDto {
  results: PluggyInvestmentDto[]
  page: number
  total: number
  totalPages: number
}

interface PluggyInvestmentsResponse {
  results?: unknown
  page?: unknown
  total?: unknown
  totalPages?: unknown
}

// `GET /investments` pelo `pluggy-sdk` (padroes-de-engenharia, 3b) — sem retry nosso (regra 3).
// Investimento com campo obrigatório (id/itemId/type/balance/name/
// currencyCode/date) ausente ou do tipo errado recusa a chamada inteira, nomeando o item e o índice —
// nunca segue com um investimento inválido silenciosamente descartado ou com valor default. Campo
// opcional aceita ausente/null mas recusa se vier presente com tipo errado.
export class PluggyInvestmentsGateway {
  async fetchInvestmentsPage(
    itemId: string,
    client: PluggyClient,
    page = 1,
    pageSize = 500,
  ): Promise<PluggyInvestmentsPageDto> {
    if (!Number.isInteger(page) || page < 1) {
      throw new ApplicationError('PLUGGY_INVESTMENTS_INVALID_PAGE', { itemId, page })
    }

    let data: PluggyInvestmentsResponse
    try {
      // Segundo parâmetro é o filtro de `type`, que não usamos: queremos todos os investimentos.
      data = (await client.fetchInvestments(itemId, undefined, { page, pageSize })) as unknown as PluggyInvestmentsResponse
    } catch (error) {
      throw pluggySdkError(
        error,
        {
          timeout: 'PLUGGY_INVESTMENTS_TIMEOUT',
          unavailable: 'PLUGGY_INVESTMENTS_UNAVAILABLE',
          upstream: 'PLUGGY_INVESTMENTS_UPSTREAM_ERROR',
        },
        { itemId },
      )
    }

    return this.parseInvestmentsPage(itemId, data, page)
  }

  // Uma página por vez, entregue na hora — mesmo padrão dos outros gateways de borda
  // (arquitetura-camadas, 2.2.2): nada acumulado em memória, e quem consome persiste por página.
  async *fetchInvestmentPages(itemId: string, client: PluggyClient): AsyncGenerator<PluggyInvestmentsPageDto> {
    const firstPage = await this.fetchInvestmentsPage(itemId, client, 1)
    yield firstPage

    for (let page = 2; page <= firstPage.totalPages; page++) {
      const nextPage = await this.fetchInvestmentsPage(itemId, client, page)
      if (nextPage.totalPages !== firstPage.totalPages) {
        throw new ApplicationError('PLUGGY_INVESTMENTS_TOTAL_PAGES_CHANGED', {
          itemId,
          expectedTotalPages: firstPage.totalPages,
          receivedTotalPages: nextPage.totalPages,
        })
      }
      yield nextPage
    }
  }

  private parseInvestmentsPage(
    itemId: string,
    data: PluggyInvestmentsResponse,
    requestedPage: number,
  ): PluggyInvestmentsPageDto {
    if (!Array.isArray(data.results)) {
      throw new ApplicationError('PLUGGY_INVESTMENTS_RESPONSE_INVALID', { itemId, field: 'results' })
    }

    // Validação de metadados de paginação
    if (typeof data.page !== 'number' || !Number.isInteger(data.page)) {
      throw new ApplicationError('PLUGGY_INVESTMENTS_RESPONSE_INVALID', { itemId, field: 'page' })
    }
    if (data.page !== requestedPage) {
      throw new ApplicationError('PLUGGY_INVESTMENTS_PAGE_MISMATCH', {
        itemId,
        expectedPage: requestedPage,
        receivedPage: data.page,
      })
    }

    if (typeof data.totalPages !== 'number' || !Number.isInteger(data.totalPages) || data.totalPages < 0) {
      throw new ApplicationError('PLUGGY_INVESTMENTS_RESPONSE_INVALID', { itemId, field: 'totalPages' })
    }

    let total = 0
    if (data.total !== undefined && data.total !== null) {
      if (typeof data.total !== 'number' || !Number.isInteger(data.total) || data.total < 0) {
        throw new ApplicationError('PLUGGY_INVESTMENTS_RESPONSE_INVALID', { itemId, field: 'total' })
      }
      total = data.total
    } else {
      total = data.results.length
    }

    const results = data.results.map((raw, index) => this.toDto(itemId, index, raw))

    return {
      results,
      page: data.page,
      total,
      totalPages: data.totalPages,
    }
  }

  private toDto(itemId: string, index: number, raw: unknown): PluggyInvestmentDto {
    const investment = raw as Record<string, unknown>

    const investmentId = requireString(investment.id, itemId, index, 'id')
    const type = requireString(investment.type, itemId, index, 'type')
    const name = requireString(investment.name, itemId, index, 'name')
    const currencyCode = requireString(investment.currencyCode, itemId, index, 'currencyCode')
    const balance = requireDecimal(investment.balance, itemId, index, 'balance')
    const quotaDate = requireDate(investment.date, itemId, index, 'date')

    return {
      investmentId,
      itemId,
      type,
      name,
      currencyCode,
      balance,
      quotaDate,
      updatedAt: optionalDate(investment.updatedAt, itemId, index, 'updatedAt'),
      subtype: optionalString(investment.subtype, itemId, index, 'subtype'),
      code: optionalString(investment.code, itemId, index, 'code'),
      isin: optionalString(investment.isin, itemId, index, 'isin'),
      quantity: optionalDecimal(investment.quantity, itemId, index, 'quantity'),
      amountOriginal: optionalDecimal(investment.amountOriginal, itemId, index, 'amountOriginal'),
      value: optionalDecimal(investment.value, itemId, index, 'value'),
      amount: optionalDecimal(investment.amount, itemId, index, 'amount'),
      taxes: optionalDecimal(investment.taxes, itemId, index, 'taxes'),
      taxes2: optionalDecimal(investment.taxes2, itemId, index, 'taxes2'),
      status: optionalString(investment.status, itemId, index, 'status'),
      institutionName: optionalString(
        getInstitutionField(investment.institution, itemId, index, 'name'),
        itemId,
        index,
        'institution.name',
      ),
      institutionNumber: optionalString(
        getInstitutionField(investment.institution, itemId, index, 'number'),
        itemId,
        index,
        'institution.number',
      ),
      issuerCnpj: optionalString(investment.issuerCNPJ, itemId, index, 'issuerCNPJ'),
      number: optionalString(investment.number, itemId, index, 'number'),
      amountWithdrawal: optionalDecimal(investment.amountWithdrawal, itemId, index, 'amountWithdrawal'),
      amountProfit: optionalDecimal(investment.amountProfit, itemId, index, 'amountProfit'),
      dueDate: optionalDate(investment.dueDate, itemId, index, 'dueDate'),
      issuer: optionalString(investment.issuer, itemId, index, 'issuer'),
      issueDate: optionalDate(investment.issueDate, itemId, index, 'issueDate'),
      purchaseDate: optionalDate(investment.purchaseDate, itemId, index, 'purchaseDate'),
      rate: optionalDecimal(investment.rate, itemId, index, 'rate'),
      rateType: optionalString(investment.rateType, itemId, index, 'rateType'),
      fixedAnnualRate: optionalDecimal(investment.fixedAnnualRate, itemId, index, 'fixedAnnualRate'),
      lastMonthRate: optionalDecimal(investment.lastMonthRate, itemId, index, 'lastMonthRate'),
      annualRate: optionalDecimal(investment.annualRate, itemId, index, 'annualRate'),
      lastTwelveMonthsRate: optionalDecimal(
        investment.lastTwelveMonthsRate,
        itemId,
        index,
        'lastTwelveMonthsRate',
      ),
      owner: optionalString(investment.owner, itemId, index, 'owner'),
      metadata: optionalMetadata(investment.metadata, itemId, index),
      raw: investment,
    }
  }
}

function requireString(value: unknown, itemId: string, index: number, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApplicationError('PLUGGY_INVESTMENT_RESPONSE_INVALID', { itemId, index, field })
  }
  return value
}

function requireDecimal(value: unknown, itemId: string, index: number, field: string): Decimal {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ApplicationError('PLUGGY_INVESTMENT_RESPONSE_INVALID', { itemId, index, field })
  }
  return new Decimal(String(value))
}

function requireDate(value: unknown, itemId: string, index: number, field: string): Date {
  // Aceita as duas formas: o SDK converte para `Date` só quando a string tinha
  // milissegundo (padroes-de-engenharia, 3b.1). Ilegível recusa, nunca vira `undefined`.
  const date = toDateOrUndefined(value)
  if (date === undefined) {
    throw new ApplicationError('PLUGGY_INVESTMENT_RESPONSE_INVALID', { itemId, index, field })
  }
  return date
}

// Ausente é ausente; presente com formato inválido é recusa nomeada, nunca "assume que não mudou" —
// um `updatedAt` ilegível virando `undefined` em silêncio já é o fallback de varredura integral, mas
// esconderia resposta quebrada do fornecedor (arquitetura-camadas, 2.2.3).
function optionalDate(value: unknown, itemId: string, index: number, field: string): Date | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  const date = toDateOrUndefined(value)
  if (date === undefined) {
    throw new ApplicationError('PLUGGY_INVESTMENT_RESPONSE_INVALID', { itemId, index, field })
  }
  return date
}

function optionalString(value: unknown, itemId: string, index: number, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApplicationError('PLUGGY_INVESTMENT_RESPONSE_INVALID', { itemId, index, field })
  }
  return value
}

function optionalDecimal(value: unknown, itemId: string, index: number, field: string): Decimal | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ApplicationError('PLUGGY_INVESTMENT_RESPONSE_INVALID', { itemId, index, field })
  }
  return new Decimal(String(value))
}

function getInstitutionField(institution: unknown, itemId: string, index: number, field: 'name' | 'number'): unknown {
  if (institution === undefined || institution === null) {
    return undefined
  }
  if (typeof institution !== 'object' || Array.isArray(institution)) {
    throw new ApplicationError('PLUGGY_INVESTMENT_RESPONSE_INVALID', { itemId, index, field: 'institution' })
  }
  return (institution as Record<string, unknown>)[field]
}

// `InvestmentMetadata` (taxRegime/proposalNumber/processNumber) — objeto pequeno e fechado,
// carregado inteiro; cada campo interno é string opcional, sem invariante próprio a validar aqui.
function optionalMetadata(
  value: unknown,
  itemId: string,
  index: number,
): PluggyPositionMetadata | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ApplicationError('PLUGGY_INVESTMENT_RESPONSE_INVALID', { itemId, index, field: 'metadata' })
  }
  const raw = value as Record<string, unknown>
  return {
    taxRegime: optionalString(raw.taxRegime, itemId, index, 'metadata.taxRegime'),
    proposalNumber: optionalString(raw.proposalNumber, itemId, index, 'metadata.proposalNumber'),
    processNumber: optionalString(raw.processNumber, itemId, index, 'metadata.processNumber'),
  }
}
