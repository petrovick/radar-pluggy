import { Decimal } from 'decimal.js'
import type { PluggyClient } from 'pluggy-sdk'
import { ApplicationError } from '../../shared/application-error.js'
import { pluggySdkError, toDateOrUndefined } from './pluggy-client.gateway.js'

// Mesmo shape que PluggyLoanRep.save espera — a fronteira de conversão pra Decimal (fronteira-pluggy
// regra 1) acontece aqui, uma vez, não em quem consome esta lista.
//
// Captura integral do schema `Loan` (change pluggy-complete-data-capture, spec pluggy-loan) — reverte
// o corte antes documentado neste arquivo. Listas/objetos aninhados complexos (`interestRates`,
// `contractedFees`, `contractedFinanceCharges`, `warranties`, `installments`, `payments`) são
// carregados opacos, mesmo tratamento de `merchant`/`paymentData` em pluggy-account-transaction.ts.
export interface PluggyLoanDto {
  loanId: string
  itemId: string
  contractNumber: string | undefined
  productName: string
  type: string | undefined
  kind: string
  // `date` do schema `Loan`: "Date when the loan data was collected".
  collectedAt: Date | undefined
  contractDate: Date | undefined
  settlementDate: Date | undefined
  contractAmount: Decimal | undefined
  currencyCode: string
  dueDate: Date | undefined
  totalInstallments: number | undefined
  paidInstallments: number | undefined
  dueInstallments: number | undefined
  pastDueInstallments: number | undefined
  // `payments.contractOutstandingBalance` — o dado central: o saldo devedor atual.
  outstandingBalance: Decimal | undefined
  ipocCode: string | undefined
  disbursementDates: Date[] | undefined
  firstInstallmentDueDate: Date | undefined
  cet: Decimal | undefined
  installmentPeriodicity: string | undefined
  installmentPeriodicityAdditionalInfo: string | undefined
  amortizationScheduled: string | undefined
  amortizationScheduledAdditionalInfo: string | undefined
  cnpjConsignee: string | undefined
  interestRates: Record<string, unknown>[] | undefined
  contractedFees: Record<string, unknown>[] | undefined
  contractedFinanceCharges: Record<string, unknown>[] | undefined
  warranties: Record<string, unknown>[] | undefined
  installments: Record<string, unknown> | undefined
  payments: Record<string, unknown> | undefined
  // Payload bruto, exatamente como recebido, capturado antes desta validação (change
  // pluggy-complete-data-capture, spec pluggy-raw-payload-audit).
  raw: Record<string, unknown>
}

export interface PluggyLoansPageDto {
  results: PluggyLoanDto[]
  page: number
  total: number
  totalPages: number
}

interface PluggyLoansResponse {
  results?: unknown
  page?: unknown
  total?: unknown
  totalPages?: unknown
}

// `GET /loans` pelo `pluggy-sdk` (padroes-de-engenharia, 3b) — sem retry nosso (regra 3). Empréstimo
// com campo obrigatório (id/productName/kind/currencyCode) ausente ou do tipo errado recusa a chamada
// inteira, nomeando o item e o índice — nunca segue com um empréstimo inválido silenciosamente
// descartado ou com valor default. Campo opcional aceita ausente/null mas recusa se vier presente com
// tipo errado.
export class PluggyLoansGateway {
  async fetchLoansPage(
    itemId: string,
    client: PluggyClient,
    page = 1,
    pageSize = 500,
  ): Promise<PluggyLoansPageDto> {
    if (!Number.isInteger(page) || page < 1) {
      throw new ApplicationError('PLUGGY_LOANS_INVALID_PAGE', { itemId, page })
    }

    let data: PluggyLoansResponse
    try {
      data = (await client.fetchLoans(itemId, { page, pageSize })) as unknown as PluggyLoansResponse
    } catch (error) {
      throw pluggySdkError(
        error,
        {
          timeout: 'PLUGGY_LOANS_TIMEOUT',
          unavailable: 'PLUGGY_LOANS_UNAVAILABLE',
          upstream: 'PLUGGY_LOANS_UPSTREAM_ERROR',
        },
        { itemId },
      )
    }

    return this.parseLoansPage(itemId, data, page)
  }

  // Sem gerador `fetchLoanPages`, ao contrário de `PluggyInvestmentsGateway`: lá o gerador tem um
  // segundo consumidor real (`load-pluggy-history.impl.ts`, carga de histórico). Aqui, quem percorre
  // as páginas é o `SyncPluggyPositionInteractor`, chamando `fetchLoansPage` uma vez por página
  // através de `readLoansPage` — não existe hoje nenhuma carga de histórico de empréstimo que
  // precisaria do gerador. Adicionar um método sem consumidor é antecipar uso hipotético
  // (padroes-de-engenharia, seção 2); nasce quando o segundo consumidor existir de verdade.

  private parseLoansPage(itemId: string, data: PluggyLoansResponse, requestedPage: number): PluggyLoansPageDto {
    if (!Array.isArray(data.results)) {
      throw new ApplicationError('PLUGGY_LOANS_RESPONSE_INVALID', { itemId, field: 'results' })
    }

    if (typeof data.page !== 'number' || !Number.isInteger(data.page)) {
      throw new ApplicationError('PLUGGY_LOANS_RESPONSE_INVALID', { itemId, field: 'page' })
    }
    if (data.page !== requestedPage) {
      throw new ApplicationError('PLUGGY_LOANS_PAGE_MISMATCH', {
        itemId,
        expectedPage: requestedPage,
        receivedPage: data.page,
      })
    }

    if (typeof data.totalPages !== 'number' || !Number.isInteger(data.totalPages) || data.totalPages < 0) {
      throw new ApplicationError('PLUGGY_LOANS_RESPONSE_INVALID', { itemId, field: 'totalPages' })
    }

    let total = 0
    if (data.total !== undefined && data.total !== null) {
      if (typeof data.total !== 'number' || !Number.isInteger(data.total) || data.total < 0) {
        throw new ApplicationError('PLUGGY_LOANS_RESPONSE_INVALID', { itemId, field: 'total' })
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

  private toDto(itemId: string, index: number, raw: unknown): PluggyLoanDto {
    const loan = raw as Record<string, unknown>

    const loanId = requireString(loan.id, itemId, index, 'id')
    const productName = requireString(loan.productName, itemId, index, 'productName')
    const kind = requireString(loan.kind, itemId, index, 'kind')
    const currencyCode = requireString(loan.currencyCode, itemId, index, 'currencyCode')

    return {
      loanId,
      itemId,
      productName,
      kind,
      currencyCode,
      contractNumber: optionalString(loan.contractNumber, itemId, index, 'contractNumber'),
      type: optionalString(loan.type, itemId, index, 'type'),
      collectedAt: optionalDate(loan.date, itemId, index, 'date'),
      contractDate: optionalDate(loan.contractDate, itemId, index, 'contractDate'),
      settlementDate: optionalDate(loan.settlementDate, itemId, index, 'settlementDate'),
      contractAmount: optionalDecimal(loan.contractAmount, itemId, index, 'contractAmount'),
      dueDate: optionalDate(loan.dueDate, itemId, index, 'dueDate'),
      totalInstallments: optionalInt(
        getNestedField(loan.installments, itemId, index, 'installments', 'totalNumberOfInstallments'),
        itemId,
        index,
        'installments.totalNumberOfInstallments',
      ),
      paidInstallments: optionalInt(
        getNestedField(loan.installments, itemId, index, 'installments', 'paidInstallments'),
        itemId,
        index,
        'installments.paidInstallments',
      ),
      dueInstallments: optionalInt(
        getNestedField(loan.installments, itemId, index, 'installments', 'dueInstallments'),
        itemId,
        index,
        'installments.dueInstallments',
      ),
      pastDueInstallments: optionalInt(
        getNestedField(loan.installments, itemId, index, 'installments', 'pastDueInstallments'),
        itemId,
        index,
        'installments.pastDueInstallments',
      ),
      outstandingBalance: optionalDecimal(
        getNestedField(loan.payments, itemId, index, 'payments', 'contractOutstandingBalance'),
        itemId,
        index,
        'payments.contractOutstandingBalance',
      ),
      ipocCode: optionalString(loan.ipocCode, itemId, index, 'ipocCode'),
      disbursementDates: optionalDateArray(loan.disbursementDates, itemId, index, 'disbursementDates'),
      firstInstallmentDueDate: optionalDate(loan.firstInstallmentDueDate, itemId, index, 'firstInstallmentDueDate'),
      cet: optionalDecimal(loan.CET, itemId, index, 'CET'),
      installmentPeriodicity: optionalString(loan.installmentPeriodicity, itemId, index, 'installmentPeriodicity'),
      installmentPeriodicityAdditionalInfo: optionalString(
        loan.installmentPeriodicityAdditionalInfo,
        itemId,
        index,
        'installmentPeriodicityAdditionalInfo',
      ),
      amortizationScheduled: optionalString(loan.amortizationScheduled, itemId, index, 'amortizationScheduled'),
      amortizationScheduledAdditionalInfo: optionalString(
        loan.amortizationScheduledAdditionalInfo,
        itemId,
        index,
        'amortizationScheduledAdditionalInfo',
      ),
      cnpjConsignee: optionalString(loan.cnpjConsignee, itemId, index, 'cnpjConsignee'),
      interestRates: optionalObjectArray(loan.interestRates, itemId, index, 'interestRates'),
      contractedFees: optionalObjectArray(loan.contractedFees, itemId, index, 'contractedFees'),
      contractedFinanceCharges: optionalObjectArray(
        loan.contractedFinanceCharges,
        itemId,
        index,
        'contractedFinanceCharges',
      ),
      warranties: optionalObjectArray(loan.warranties, itemId, index, 'warranties'),
      installments: optionalObject(loan.installments, itemId, index, 'installments'),
      payments: optionalObject(loan.payments, itemId, index, 'payments'),
      raw: loan,
    }
  }
}

function requireString(value: unknown, itemId: string, index: number, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApplicationError('PLUGGY_LOAN_RESPONSE_INVALID', { itemId, index, field })
  }
  return value
}

// Todas as datas do subconjunto capturado são opcionais no schema `Loan` (`date`, `contractDate`,
// `settlementDate`, `dueDate` — todas `Date | null`), então não existe `requireDate` aqui: ausente é
// ausente, nunca erro; presente e ilegível é que recusa (padroes-de-engenharia, 2.2.3).
function optionalDate(value: unknown, itemId: string, index: number, field: string): Date | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  const date = toDateOrUndefined(value)
  if (date === undefined) {
    throw new ApplicationError('PLUGGY_LOAN_RESPONSE_INVALID', { itemId, index, field })
  }
  return date
}

function optionalString(value: unknown, itemId: string, index: number, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApplicationError('PLUGGY_LOAN_RESPONSE_INVALID', { itemId, index, field })
  }
  return value
}

function optionalDecimal(value: unknown, itemId: string, index: number, field: string): Decimal | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ApplicationError('PLUGGY_LOAN_RESPONSE_INVALID', { itemId, index, field })
  }
  return new Decimal(String(value))
}

function optionalInt(value: unknown, itemId: string, index: number, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ApplicationError('PLUGGY_LOAN_RESPONSE_INVALID', { itemId, index, field })
  }
  return value
}

function optionalDateArray(value: unknown, itemId: string, index: number, field: string): Date[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (!Array.isArray(value)) {
    throw new ApplicationError('PLUGGY_LOAN_RESPONSE_INVALID', { itemId, index, field })
  }
  return value.map((entry, entryIndex) => {
    const date = toDateOrUndefined(entry)
    if (date === undefined) {
      throw new ApplicationError('PLUGGY_LOAN_RESPONSE_INVALID', { itemId, index, field: `${field}[${entryIndex}]` })
    }
    return date
  })
}

// Objeto/lista aninhada complexa (taxas, garantias, parcelas, pagamentos) carregada opaca — mesmo
// tratamento de `merchant`/`paymentData` em pluggy-account-transaction.ts.
function optionalObject(value: unknown, itemId: string, index: number, field: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ApplicationError('PLUGGY_LOAN_RESPONSE_INVALID', { itemId, index, field })
  }
  return value as Record<string, unknown>
}

function optionalObjectArray(
  value: unknown,
  itemId: string,
  index: number,
  field: string,
): Record<string, unknown>[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (!Array.isArray(value)) {
    throw new ApplicationError('PLUGGY_LOAN_RESPONSE_INVALID', { itemId, index, field })
  }
  return value as Record<string, unknown>[]
}

// `installments`/`payments` no schema `Loan` podem vir `null` inteiros — subcampo achatado vira
// ausente (undefined), nunca erro, quando o objeto pai é `null`/`undefined`. Objeto pai presente com
// tipo errado (não é objeto, ou é array) é resposta mal formada — recusa nomeada.
function getNestedField(
  parent: unknown,
  itemId: string,
  index: number,
  parentField: string,
  field: string,
): unknown {
  if (parent === undefined || parent === null) {
    return undefined
  }
  if (typeof parent !== 'object' || Array.isArray(parent)) {
    throw new ApplicationError('PLUGGY_LOAN_RESPONSE_INVALID', { itemId, index, field: parentField })
  }
  return (parent as Record<string, unknown>)[field]
}
