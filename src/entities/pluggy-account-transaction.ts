import type { Decimal } from 'decimal.js'
import { ApplicationError } from '../shared/application-error.js'

const ALLOWED_CREATE_FIELDS = new Set([
  'itemId',
  'accountId',
  'transactionId',
  'description',
  'descriptionRaw',
  'currencyCode',
  'amount',
  'amountInAccountCurrency',
  'balance',
  'date',
  'transactionType',
  'status',
  'categoryId',
  'category',
  'operationType',
  'operationTypeAdditionalInfo',
  'providerCode',
  'providerId',
  'sourceOrder',
  'merchant',
  'paymentData',
  'creditCardMetadata',
  'providerCreatedAt',
  'providerUpdatedAt',
])

export interface CreatePluggyAccountTransactionProps {
  itemId: string
  accountId: string
  transactionId: string
  description: string
  descriptionRaw?: string | undefined
  currencyCode: string
  amount: Decimal
  amountInAccountCurrency?: Decimal | undefined
  balance?: Decimal | undefined
  date: Date
  transactionType: string
  status: string
  categoryId?: string | undefined
  category?: string | undefined
  operationType?: string | undefined
  operationTypeAdditionalInfo?: string | undefined
  providerCode?: string | undefined
  providerId?: string | undefined
  sourceOrder?: number | undefined
  merchant?: Record<string, unknown> | undefined
  paymentData?: Record<string, unknown> | undefined
  // `CreditCardMetadata` inteiro (change pluggy-complete-data-capture, spec
  // pluggy-transaction-history) — parcelamento, `billId`, `billForecastDate`, tipo de tarifa.
  // Presente só quando a transação é de cartão de crédito; carregado opaco, mesmo tratamento de
  // `merchant`/`paymentData`.
  creditCardMetadata?: Record<string, unknown> | undefined
  // Obrigatórios: o spec de pluggy-transaction-history exige `createdAt`/`updatedAt` no extrato, e a
  // entidade é a fronteira que garante isso por si — não o gateway que hoje por acaso sempre envia.
  providerCreatedAt: Date
  providerUpdatedAt: Date
}

// Construtor recebe `props` por nome, não por posição: `merchant`, `paymentData` e
// `creditCardMetadata` são três campos `Record<string, unknown> | undefined` — uma transposição
// entre dois deles compilaria sem erro e gravaria dado de comerciante/pagamento/cartão trocado em
// silêncio (mesmo raciocínio de `pluggy-account.ts`).
export class PluggyAccountTransaction {
  private readonly itemId: string
  private readonly accountId: string
  private readonly transactionId: string
  private readonly description: string
  private readonly descriptionRaw: string | undefined
  private readonly currencyCode: string
  private readonly amount: Decimal
  private readonly amountInAccountCurrency: Decimal | undefined
  private readonly balance: Decimal | undefined
  private readonly date: Date
  private readonly transactionType: string
  private readonly status: string
  private readonly categoryId: string | undefined
  private readonly category: string | undefined
  private readonly operationType: string | undefined
  private readonly operationTypeAdditionalInfo: string | undefined
  private readonly providerCode: string | undefined
  private readonly providerId: string | undefined
  private readonly sourceOrder: number | undefined
  private readonly merchant: Record<string, unknown> | undefined
  private readonly paymentData: Record<string, unknown> | undefined
  private readonly creditCardMetadata: Record<string, unknown> | undefined
  private readonly providerCreatedAt: Date
  private readonly providerUpdatedAt: Date

  private constructor(props: CreatePluggyAccountTransactionProps) {
    this.itemId = props.itemId
    this.accountId = props.accountId
    this.transactionId = props.transactionId
    this.description = props.description
    this.descriptionRaw = props.descriptionRaw
    this.currencyCode = props.currencyCode
    this.amount = props.amount
    this.amountInAccountCurrency = props.amountInAccountCurrency
    this.balance = props.balance
    this.date = props.date
    this.transactionType = props.transactionType
    this.status = props.status
    this.categoryId = props.categoryId
    this.category = props.category
    this.operationType = props.operationType
    this.operationTypeAdditionalInfo = props.operationTypeAdditionalInfo
    this.providerCode = props.providerCode
    this.providerId = props.providerId
    this.sourceOrder = props.sourceOrder
    this.merchant = props.merchant
    this.paymentData = props.paymentData
    this.creditCardMetadata = props.creditCardMetadata
    this.providerCreatedAt = props.providerCreatedAt
    this.providerUpdatedAt = props.providerUpdatedAt
  }

  static create(props: CreatePluggyAccountTransactionProps): PluggyAccountTransaction {
    assertNoUnexpectedFields(props)
    assertPresent(props.itemId, 'PLUGGY_ACCOUNT_TRANSACTION_ITEM_ID_MISSING')
    assertPresent(props.accountId, 'PLUGGY_ACCOUNT_TRANSACTION_ACCOUNT_ID_MISSING')
    assertPresent(props.transactionId, 'PLUGGY_ACCOUNT_TRANSACTION_TRANSACTION_ID_MISSING')
    assertPresent(props.description, 'PLUGGY_ACCOUNT_TRANSACTION_DESCRIPTION_MISSING')
    assertPresent(props.currencyCode, 'PLUGGY_ACCOUNT_TRANSACTION_CURRENCY_CODE_MISSING')
    assertPresent(props.transactionType, 'PLUGGY_ACCOUNT_TRANSACTION_TYPE_MISSING')
    assertPresent(props.status, 'PLUGGY_ACCOUNT_TRANSACTION_STATUS_MISSING')

    if (props.amount === undefined || props.amount === null) {
      throw new ApplicationError('PLUGGY_ACCOUNT_TRANSACTION_AMOUNT_MISSING', { transactionId: props.transactionId })
    }
    if (props.date === undefined || props.date === null || Number.isNaN(props.date.getTime())) {
      throw new ApplicationError('PLUGGY_ACCOUNT_TRANSACTION_DATE_MISSING', { transactionId: props.transactionId })
    }
    assertInstant(props.providerCreatedAt, 'PLUGGY_ACCOUNT_TRANSACTION_PROVIDER_CREATED_AT_MISSING', props.transactionId)
    assertInstant(props.providerUpdatedAt, 'PLUGGY_ACCOUNT_TRANSACTION_PROVIDER_UPDATED_AT_MISSING', props.transactionId)

    return new PluggyAccountTransaction(props)
  }

  static reconstitute(props: CreatePluggyAccountTransactionProps): PluggyAccountTransaction {
    return new PluggyAccountTransaction(props)
  }

  getItemId(): string { return this.itemId }
  getAccountId(): string { return this.accountId }
  getTransactionId(): string { return this.transactionId }
  getDescription(): string { return this.description }
  getDescriptionRaw(): string | undefined { return this.descriptionRaw }
  getCurrencyCode(): string { return this.currencyCode }
  getAmount(): Decimal { return this.amount }
  getAmountInAccountCurrency(): Decimal | undefined { return this.amountInAccountCurrency }
  getBalance(): Decimal | undefined { return this.balance }
  getDate(): Date { return this.date }
  getTransactionType(): string { return this.transactionType }
  getStatus(): string { return this.status }
  getCategoryId(): string | undefined { return this.categoryId }
  getCategory(): string | undefined { return this.category }
  getOperationType(): string | undefined { return this.operationType }
  getOperationTypeAdditionalInfo(): string | undefined { return this.operationTypeAdditionalInfo }
  getProviderCode(): string | undefined { return this.providerCode }
  getProviderId(): string | undefined { return this.providerId }
  getSourceOrder(): number | undefined { return this.sourceOrder }
  getMerchant(): Record<string, unknown> | undefined { return this.merchant }
  getPaymentData(): Record<string, unknown> | undefined { return this.paymentData }
  getCreditCardMetadata(): Record<string, unknown> | undefined { return this.creditCardMetadata }
  getProviderCreatedAt(): Date { return this.providerCreatedAt }
  getProviderUpdatedAt(): Date { return this.providerUpdatedAt }
}

function assertInstant(value: Date | undefined, errorType: string, transactionId: string): void {
  if (value === undefined || value === null || Number.isNaN(value.getTime())) {
    throw new ApplicationError(errorType, { transactionId })
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
    throw new ApplicationError('PLUGGY_ACCOUNT_TRANSACTION_UNEXPECTED_FIELD', { fields: forbidden })
  }
}
