import type { Decimal } from 'decimal.js'
import { ApplicationError } from '../shared/application-error.js'

const ALLOWED_CREATE_FIELDS = new Set([
  'itemId',
  'investmentId',
  'quotaDate',
  'balance',
  'quantity',
  'value',
  'amount',
  'amountOriginal',
  'taxes',
  'taxes2',
  'currencyCode',
  'syncedAt',
])

export interface CreatePluggyPositionSnapshotProps {
  itemId: string
  investmentId: string
  quotaDate: Date
  balance: Decimal
  quantity?: Decimal | undefined
  value?: Decimal | undefined
  amount?: Decimal | undefined
  amountOriginal?: Decimal | undefined
  taxes?: Decimal | undefined
  taxes2?: Decimal | undefined
  currencyCode: string
  syncedAt: Date
}

export class PluggyPositionSnapshot {
  private constructor(
    private readonly itemId: string,
    private readonly investmentId: string,
    private readonly quotaDate: Date,
    private readonly balance: Decimal,
    private readonly quantity: Decimal | undefined,
    private readonly value: Decimal | undefined,
    private readonly amount: Decimal | undefined,
    private readonly amountOriginal: Decimal | undefined,
    private readonly taxes: Decimal | undefined,
    private readonly taxes2: Decimal | undefined,
    private readonly currencyCode: string,
    private readonly syncedAt: Date,
  ) {}

  static create(props: CreatePluggyPositionSnapshotProps): PluggyPositionSnapshot {
    assertNoUnexpectedFields(props)
    assertPresent(props.itemId, 'PLUGGY_POSITION_SNAPSHOT_ITEM_ID_MISSING')
    assertPresent(props.investmentId, 'PLUGGY_POSITION_SNAPSHOT_INVESTMENT_ID_MISSING')
    assertPresent(props.currencyCode, 'PLUGGY_POSITION_SNAPSHOT_CURRENCY_CODE_MISSING')
    if (props.balance === undefined || props.balance === null) {
      throw new ApplicationError('PLUGGY_POSITION_SNAPSHOT_BALANCE_MISSING', { investmentId: props.investmentId })
    }
    if (props.quotaDate === undefined || props.quotaDate === null || Number.isNaN(props.quotaDate.getTime())) {
      throw new ApplicationError('PLUGGY_POSITION_SNAPSHOT_QUOTA_DATE_MISSING', { investmentId: props.investmentId })
    }
    if (props.syncedAt === undefined || props.syncedAt === null || Number.isNaN(props.syncedAt.getTime())) {
      throw new ApplicationError('PLUGGY_POSITION_SNAPSHOT_SYNCED_AT_MISSING', { investmentId: props.investmentId })
    }

    return new PluggyPositionSnapshot(
      props.itemId,
      props.investmentId,
      props.quotaDate,
      props.balance,
      props.quantity,
      props.value,
      props.amount,
      props.amountOriginal,
      props.taxes,
      props.taxes2,
      props.currencyCode,
      props.syncedAt,
    )
  }

  static reconstitute(props: CreatePluggyPositionSnapshotProps): PluggyPositionSnapshot {
    return new PluggyPositionSnapshot(
      props.itemId,
      props.investmentId,
      props.quotaDate,
      props.balance,
      props.quantity,
      props.value,
      props.amount,
      props.amountOriginal,
      props.taxes,
      props.taxes2,
      props.currencyCode,
      props.syncedAt,
    )
  }

  getItemId(): string {
    return this.itemId
  }

  getInvestmentId(): string {
    return this.investmentId
  }

  getQuotaDate(): Date {
    return this.quotaDate
  }

  getBalance(): Decimal {
    return this.balance
  }

  getQuantity(): Decimal | undefined {
    return this.quantity
  }

  getValue(): Decimal | undefined {
    return this.value
  }

  getAmount(): Decimal | undefined {
    return this.amount
  }

  getAmountOriginal(): Decimal | undefined {
    return this.amountOriginal
  }

  getTaxes(): Decimal | undefined {
    return this.taxes
  }

  getTaxes2(): Decimal | undefined {
    return this.taxes2
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
    throw new ApplicationError('PLUGGY_POSITION_SNAPSHOT_UNEXPECTED_FIELD', { fields: forbidden })
  }
}
