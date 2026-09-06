import type { Decimal } from 'decimal.js'
import { ApplicationError } from '../shared/application-error.js'

const ALLOWED_CREATE_FIELDS = new Set([
  'itemId',
  'loanId',
  'outstandingBalance',
  'totalInstallments',
  'paidInstallments',
  'dueInstallments',
  'pastDueInstallments',
  'currencyCode',
  'syncedAt',
])

export interface CreatePluggyLoanSnapshotProps {
  itemId: string
  loanId: string
  outstandingBalance?: Decimal | undefined
  totalInstallments?: number | undefined
  paidInstallments?: number | undefined
  dueInstallments?: number | undefined
  pastDueInstallments?: number | undefined
  currencyCode: string
  syncedAt: Date
}

// Histórico da evolução do saldo devedor: uma linha por sincronização (não por dia útil como o
// snapshot de posição, que segue a `quotaDate` do provedor — `Loan` não expõe data de cotação
// equivalente). `outstandingBalance` opcional porque `payments` no schema da Pluggy pode ser `null`
// inteiro (design análogo a `pluggy-position-snapshot.ts`).
export class PluggyLoanSnapshot {
  private constructor(
    private readonly itemId: string,
    private readonly loanId: string,
    private readonly outstandingBalance: Decimal | undefined,
    private readonly totalInstallments: number | undefined,
    private readonly paidInstallments: number | undefined,
    private readonly dueInstallments: number | undefined,
    private readonly pastDueInstallments: number | undefined,
    private readonly currencyCode: string,
    private readonly syncedAt: Date,
  ) {}

  static create(props: CreatePluggyLoanSnapshotProps): PluggyLoanSnapshot {
    assertNoUnexpectedFields(props)
    assertPresent(props.itemId, 'PLUGGY_LOAN_SNAPSHOT_ITEM_ID_MISSING')
    assertPresent(props.loanId, 'PLUGGY_LOAN_SNAPSHOT_LOAN_ID_MISSING')
    assertPresent(props.currencyCode, 'PLUGGY_LOAN_SNAPSHOT_CURRENCY_CODE_MISSING')
    if (props.syncedAt === undefined || props.syncedAt === null || Number.isNaN(props.syncedAt.getTime())) {
      throw new ApplicationError('PLUGGY_LOAN_SNAPSHOT_SYNCED_AT_MISSING', { loanId: props.loanId })
    }

    return new PluggyLoanSnapshot(
      props.itemId,
      props.loanId,
      props.outstandingBalance,
      props.totalInstallments,
      props.paidInstallments,
      props.dueInstallments,
      props.pastDueInstallments,
      props.currencyCode,
      props.syncedAt,
    )
  }

  static reconstitute(props: CreatePluggyLoanSnapshotProps): PluggyLoanSnapshot {
    return new PluggyLoanSnapshot(
      props.itemId,
      props.loanId,
      props.outstandingBalance,
      props.totalInstallments,
      props.paidInstallments,
      props.dueInstallments,
      props.pastDueInstallments,
      props.currencyCode,
      props.syncedAt,
    )
  }

  getItemId(): string {
    return this.itemId
  }

  getLoanId(): string {
    return this.loanId
  }

  getOutstandingBalance(): Decimal | undefined {
    return this.outstandingBalance
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

  getCurrencyCode(): string {
    return this.currencyCode
  }

  getSyncedAt(): Date {
    return this.syncedAt
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
    throw new ApplicationError('PLUGGY_LOAN_SNAPSHOT_UNEXPECTED_FIELD', { fields: forbidden })
  }
}
