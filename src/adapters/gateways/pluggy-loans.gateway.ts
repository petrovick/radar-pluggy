import { Decimal } from 'decimal.js'
import type { PluggyClient } from 'pluggy-sdk'
import { ApplicationError } from '../../shared/application-error.js'
import { pluggySdkError, toDateOrUndefined } from './pluggy-client.gateway.js'

// Mesmo shape que PluggyLoanRep.save espera — a fronteira de conversão pra Decimal (fronteira-pluggy
// regra 1) acontece aqui, uma vez, não em quem consome esta lista.
//
// Subconjunto deliberado do schema `Loan` da Pluggy (~25 campos, muitos aninhados: taxas, garantias,
// parcelas balão, liberações de pagamento). Este produto precisa hoje só da visão patrimonial de
// "quanto eu devo" — capturar tudo seria overengineering para dado de auditoria de contrato do Open
// Banking Brasil que ninguém consome. Fora de escopo, de propósito, e por isso:
//   - `ipocCode`: identificação padronizada de contrato, sem consumidor
//   - `disbursementDates`: datas de liberação de parcelas do contrato, auditoria
//   - `installmentPeriodicity`/`installmentPeriodicityAdditionalInfo`: frequência de parcela, auditoria
//   - `firstInstallmentDueDate`: redundante com o cronograma de parcelas, auditoria
//   - `CET`: custo efetivo total anualizado, indicador de comparação de oferta, não de saldo devedor
//   - `amortizationScheduled`/`amortizationScheduledAdditionalInfo`: sistema de amortização, auditoria
//   - `cnpjConsignee`: CNPJ do consignante, dado de auditoria de contrato consignado
//   - `interestRates`: lista de taxas de juros pactuadas, auditoria
//   - `contractedFees`/`contractedFinanceCharges`: tarifas e encargos pactuados, auditoria
//   - `warranties`: garantias do contrato, auditoria
//   - `installments.balloonPayments`: parcelas balão não regulares, auditoria
//   - `payments.releases`: liberações de pagamento fora da parcela, auditoria
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
