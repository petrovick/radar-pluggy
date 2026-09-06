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
])

interface CreatePluggyLoanProps {
  loanId: string
  itemId: string
  contractNumber?: string
  productName: string
  type?: string
  kind: string
  // Subconjunto deliberado do schema `Loan` da Pluggy (~25 campos): esta entidade guarda a visão
  // patrimonial de "quanto eu devo", não a auditoria de contrato do Open Banking Brasil. O corte
  // completo, com o porquê de cada campo excluído, está documentado em
  // `adapters/gateways/pluggy-loans.gateway.ts`.
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
}

// Fotografia de estado do empréstimo (design análogo a `pluggy-position.ts`): construtor privado +
// invariante mínimo de presença, sem lógica de negócio além da validação de campo obrigatório.
export class PluggyLoan {
  private constructor(
    private readonly loanId: string,
    private readonly itemId: string,
    private readonly contractNumber: string | undefined,
    private readonly productName: string,
    private readonly type: string | undefined,
    private readonly kind: string,
    private readonly collectedAt: Date | undefined,
    private readonly contractDate: Date | undefined,
    private readonly settlementDate: Date | undefined,
    private readonly contractAmount: Decimal | undefined,
    private readonly currencyCode: string,
    private readonly dueDate: Date | undefined,
    private readonly totalInstallments: number | undefined,
    private readonly paidInstallments: number | undefined,
    private readonly dueInstallments: number | undefined,
    private readonly pastDueInstallments: number | undefined,
    private readonly outstandingBalance: Decimal | undefined,
  ) {}

  static create(props: CreatePluggyLoanProps): PluggyLoan {
    assertNoUnexpectedFields(props)
    assertPresent(props.loanId, 'PLUGGY_LOAN_LOAN_ID_MISSING')
    assertPresent(props.itemId, 'PLUGGY_LOAN_ITEM_ID_MISSING')
    assertPresent(props.productName, 'PLUGGY_LOAN_PRODUCT_NAME_MISSING')
    assertPresent(props.kind, 'PLUGGY_LOAN_KIND_MISSING')
    assertPresent(props.currencyCode, 'PLUGGY_LOAN_CURRENCY_CODE_MISSING')

    return new PluggyLoan(
      props.loanId,
      props.itemId,
      props.contractNumber,
      props.productName,
      props.type,
      props.kind,
      props.collectedAt,
      props.contractDate,
      props.settlementDate,
      props.contractAmount,
      props.currencyCode,
      props.dueDate,
      props.totalInstallments,
      props.paidInstallments,
      props.dueInstallments,
      props.pastDueInstallments,
      props.outstandingBalance,
    )
  }

  // Reconstrói a partir de uma linha já persistida (fronteira model → entity do repositório).
  static reconstitute(props: CreatePluggyLoanProps): PluggyLoan {
    return new PluggyLoan(
      props.loanId,
      props.itemId,
      props.contractNumber,
      props.productName,
      props.type,
      props.kind,
      props.collectedAt,
      props.contractDate,
      props.settlementDate,
      props.contractAmount,
      props.currencyCode,
      props.dueDate,
      props.totalInstallments,
      props.paidInstallments,
      props.dueInstallments,
      props.pastDueInstallments,
      props.outstandingBalance,
    )
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
