import type { Decimal } from 'decimal.js'
import { ApplicationError } from '../shared/application-error.js'

// Único ponto de entrada de dado externo (gateway de empréstimos): o guard roda em runtime porque o
// excess-property check do TS não pega objeto montado dinamicamente, mesmo padrão de pluggy-position.ts.
const ALLOWED_CREATE_FIELDS = new Set([
  'loanId',
  'itemId',
  'contractNumber',
  'productName',
  'type',
  'kind',
  'collectedAt',
  'contractDate',
  'settlementDate',
  'contractAmount',
  'currencyCode',
  'dueDate',
  'totalInstallments',
  'paidInstallments',
  'dueInstallments',
  'pastDueInstallments',
  'outstandingBalance',
  'ipocCode',
  'disbursementDates',
  'firstInstallmentDueDate',
  'cet',
  'installmentPeriodicity',
  'installmentPeriodicityAdditionalInfo',
  'amortizationScheduled',
  'amortizationScheduledAdditionalInfo',
  'cnpjConsignee',
  'interestRates',
  'contractedFees',
  'contractedFinanceCharges',
  'warranties',
  'installments',
  'payments',
])

interface CreatePluggyLoanProps {
  loanId: string
  itemId: string
  contractNumber?: string
  productName: string
  type?: string
  kind: string
  collectedAt?: Date
  contractDate?: Date
  settlementDate?: Date
  contractAmount?: Decimal
  currencyCode: string
  dueDate?: Date
  totalInstallments?: number
  paidInstallments?: number
  dueInstallments?: number
  pastDueInstallments?: number
  // `payments.contractOutstandingBalance` no schema da Pluggy — o dado central desta entidade.
  outstandingBalance?: Decimal
  // Schema completo do contrato (change pluggy-complete-data-capture, spec pluggy-loan) — reverte o
  // corte antes documentado aqui. `interestRates`/`contractedFees`/`contractedFinanceCharges`/
  // `warranties`/`installments`/`payments` são objetos/listas aninhadas complexas do Open Banking
  // Brasil, carregadas opacas (mesmo tratamento de `merchant`/`paymentData` em
  // pluggy-account-transaction.ts): sem tipagem campo a campo, sem lógica de negócio nossa em cima.
  ipocCode?: string
  disbursementDates?: Date[]
  firstInstallmentDueDate?: Date
  cet?: Decimal
  installmentPeriodicity?: string
  installmentPeriodicityAdditionalInfo?: string
  amortizationScheduled?: string
  amortizationScheduledAdditionalInfo?: string
  cnpjConsignee?: string
  interestRates?: Record<string, unknown>[]
  contractedFees?: Record<string, unknown>[]
  contractedFinanceCharges?: Record<string, unknown>[]
  warranties?: Record<string, unknown>[]
  installments?: Record<string, unknown>
  payments?: Record<string, unknown>
}

// Fotografia de estado do empréstimo (design análogo a `pluggy-position.ts`): construtor privado +
// invariante mínimo de presença, sem lógica de negócio além da validação de campo obrigatório.
//
// Construtor recebe `props` por nome, não por posição: com quatro campos
// `Record<string, unknown>[] | undefined` consecutivos (`interestRates`, `contractedFees`,
// `contractedFinanceCharges`, `warranties`), um construtor posicional deixaria uma transposição
// entre dois parâmetros compilar sem erro e gravar dado de contrato trocado em silêncio — mesmo
// raciocínio de `pluggy-account.ts`.
export class PluggyLoan {
  private readonly loanId: string
  private readonly itemId: string
  private readonly contractNumber: string | undefined
  private readonly productName: string
  private readonly type: string | undefined
  private readonly kind: string
  private readonly collectedAt: Date | undefined
  private readonly contractDate: Date | undefined
  private readonly settlementDate: Date | undefined
  private readonly contractAmount: Decimal | undefined
  private readonly currencyCode: string
  private readonly dueDate: Date | undefined
  private readonly totalInstallments: number | undefined
  private readonly paidInstallments: number | undefined
  private readonly dueInstallments: number | undefined
  private readonly pastDueInstallments: number | undefined
  private readonly outstandingBalance: Decimal | undefined
  private readonly ipocCode: string | undefined
  private readonly disbursementDates: Date[] | undefined
  private readonly firstInstallmentDueDate: Date | undefined
  private readonly cet: Decimal | undefined
  private readonly installmentPeriodicity: string | undefined
  private readonly installmentPeriodicityAdditionalInfo: string | undefined
  private readonly amortizationScheduled: string | undefined
  private readonly amortizationScheduledAdditionalInfo: string | undefined
  private readonly cnpjConsignee: string | undefined
  private readonly interestRates: Record<string, unknown>[] | undefined
  private readonly contractedFees: Record<string, unknown>[] | undefined
  private readonly contractedFinanceCharges: Record<string, unknown>[] | undefined
  private readonly warranties: Record<string, unknown>[] | undefined
  private readonly installments: Record<string, unknown> | undefined
  private readonly payments: Record<string, unknown> | undefined

  private constructor(props: CreatePluggyLoanProps) {
    this.loanId = props.loanId
    this.itemId = props.itemId
    this.contractNumber = props.contractNumber
    this.productName = props.productName
    this.type = props.type
    this.kind = props.kind
    this.collectedAt = props.collectedAt
    this.contractDate = props.contractDate
    this.settlementDate = props.settlementDate
    this.contractAmount = props.contractAmount
    this.currencyCode = props.currencyCode
    this.dueDate = props.dueDate
    this.totalInstallments = props.totalInstallments
    this.paidInstallments = props.paidInstallments
    this.dueInstallments = props.dueInstallments
    this.pastDueInstallments = props.pastDueInstallments
    this.outstandingBalance = props.outstandingBalance
    this.ipocCode = props.ipocCode
    this.disbursementDates = props.disbursementDates
    this.firstInstallmentDueDate = props.firstInstallmentDueDate
    this.cet = props.cet
    this.installmentPeriodicity = props.installmentPeriodicity
    this.installmentPeriodicityAdditionalInfo = props.installmentPeriodicityAdditionalInfo
    this.amortizationScheduled = props.amortizationScheduled
    this.amortizationScheduledAdditionalInfo = props.amortizationScheduledAdditionalInfo
    this.cnpjConsignee = props.cnpjConsignee
    this.interestRates = props.interestRates
    this.contractedFees = props.contractedFees
    this.contractedFinanceCharges = props.contractedFinanceCharges
    this.warranties = props.warranties
    this.installments = props.installments
    this.payments = props.payments
  }

  static create(props: CreatePluggyLoanProps): PluggyLoan {
    assertNoUnexpectedFields(props)
    assertPresent(props.loanId, 'PLUGGY_LOAN_LOAN_ID_MISSING')
    assertPresent(props.itemId, 'PLUGGY_LOAN_ITEM_ID_MISSING')
    assertPresent(props.productName, 'PLUGGY_LOAN_PRODUCT_NAME_MISSING')
    assertPresent(props.kind, 'PLUGGY_LOAN_KIND_MISSING')
    assertPresent(props.currencyCode, 'PLUGGY_LOAN_CURRENCY_CODE_MISSING')

    return new PluggyLoan(props)
  }

  // Reconstrói a partir de uma linha já persistida (fronteira model → entity do repositório).
  static reconstitute(props: CreatePluggyLoanProps): PluggyLoan {
    return new PluggyLoan(props)
  }

  getLoanId(): string {
    return this.loanId
  }

  getItemId(): string {
    return this.itemId
  }

  getContractNumber(): string | undefined {
    return this.contractNumber
  }

  getProductName(): string {
    return this.productName
  }

  getType(): string | undefined {
    return this.type
  }

  getKind(): string {
    return this.kind
  }

  getCollectedAt(): Date | undefined {
    return this.collectedAt
  }

  getContractDate(): Date | undefined {
    return this.contractDate
  }

  getSettlementDate(): Date | undefined {
    return this.settlementDate
  }

  getContractAmount(): Decimal | undefined {
    return this.contractAmount
  }

  getCurrencyCode(): string {
    return this.currencyCode
  }

  getDueDate(): Date | undefined {
    return this.dueDate
  }

  getTotalInstallments(): number | undefined {
    return this.totalInstallments
  }

  getPaidInstallments(): number | undefined {
    return this.paidInstallments
  }

  getDueInstallments(): number | undefined {
    return this.dueInstallments
  }

  getPastDueInstallments(): number | undefined {
    return this.pastDueInstallments
  }

  getOutstandingBalance(): Decimal | undefined {
    return this.outstandingBalance
  }

  getIpocCode(): string | undefined {
    return this.ipocCode
  }

  getDisbursementDates(): Date[] | undefined {
    return this.disbursementDates
  }

  getFirstInstallmentDueDate(): Date | undefined {
    return this.firstInstallmentDueDate
  }

  getCet(): Decimal | undefined {
    return this.cet
  }

  getInstallmentPeriodicity(): string | undefined {
    return this.installmentPeriodicity
  }

  getInstallmentPeriodicityAdditionalInfo(): string | undefined {
    return this.installmentPeriodicityAdditionalInfo
  }

  getAmortizationScheduled(): string | undefined {
    return this.amortizationScheduled
  }

  getAmortizationScheduledAdditionalInfo(): string | undefined {
    return this.amortizationScheduledAdditionalInfo
  }

  getCnpjConsignee(): string | undefined {
    return this.cnpjConsignee
  }

  getInterestRates(): Record<string, unknown>[] | undefined {
    return this.interestRates
  }

  getContractedFees(): Record<string, unknown>[] | undefined {
    return this.contractedFees
  }

  getContractedFinanceCharges(): Record<string, unknown>[] | undefined {
    return this.contractedFinanceCharges
  }

  getWarranties(): Record<string, unknown>[] | undefined {
    return this.warranties
  }

  getInstallments(): Record<string, unknown> | undefined {
    return this.installments
  }

  getPayments(): Record<string, unknown> | undefined {
    return this.payments
  }
}

function assertPresent(value: string | undefined, errorType: string): void {
  if (!value || value.trim().length === 0) {
    throw new ApplicationError(errorType)
  }
}

function assertNoUnexpectedFields(props: object): void {
  const forbidden = Object.keys(props).filter((key) => !ALLOWED_CREATE_FIELDS.has(key))
  if (forbidden.length > 0) {
    throw new ApplicationError('PLUGGY_LOAN_UNEXPECTED_FIELD', { fields: forbidden })
  }
}
