import { Decimal } from 'decimal.js'
import type { Model, ModelStatic } from 'sequelize'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import { PluggyAccountTransaction } from '../../entities/pluggy-account-transaction.js'
import type { PluggyAccountTransactionRow } from '../../infra/db/models/pluggy-account-transaction-model.js'

export interface SavePluggyAccountTransactionInput {
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
  creditCardMetadata?: Record<string, unknown> | undefined
  providerCreatedAt: Date
  providerUpdatedAt: Date
}

export class PluggyAccountTransactionRep {
  private readonly model: ModelStatic<Model<PluggyAccountTransactionRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyAccountTransaction
    this.getTransaction = params.getTransaction
  }

  // Upsert por (item_id, account_id, transaction_id)
  async save(input: SavePluggyAccountTransactionInput): Promise<PluggyAccountTransaction> {
    const draft = PluggyAccountTransaction.create({
      itemId: input.itemId,
      accountId: input.accountId,
      transactionId: input.transactionId,
      description: input.description,
      currencyCode: input.currencyCode,
      amount: input.amount,
      date: input.date,
      transactionType: input.transactionType,
      status: input.status,
      providerCreatedAt: input.providerCreatedAt,
      providerUpdatedAt: input.providerUpdatedAt,
      ...withDefined({
        descriptionRaw: input.descriptionRaw,
        amountInAccountCurrency: input.amountInAccountCurrency,
        balance: input.balance,
        categoryId: input.categoryId,
        category: input.category,
        operationType: input.operationType,
        operationTypeAdditionalInfo: input.operationTypeAdditionalInfo,
        providerCode: input.providerCode,
        providerId: input.providerId,
        sourceOrder: input.sourceOrder,
        merchant: input.merchant,
        paymentData: input.paymentData,
        creditCardMetadata: input.creditCardMetadata,
      }),
    })
    const now = new Date()

    const [row, created] = await this.model.findOrCreate({
      where: {
        item_id: draft.getItemId(),
        account_id: draft.getAccountId(),
        transaction_id: draft.getTransactionId(),
      },
      defaults: toRow(draft, now),
      ...this.transactionOptions(),
    })

    if (!created) {
      await row.update(toRow(draft, now), this.transactionOptions())
    }

    return draft
  }

  async saveMany(inputs: SavePluggyAccountTransactionInput[]): Promise<PluggyAccountTransaction[]> {
    const results: PluggyAccountTransaction[] = []
    for (const input of inputs) {
      results.push(await this.save(input))
    }
    return results
  }

  async findByAccountId(accountId: string): Promise<PluggyAccountTransaction[]> {
    const rows = await this.model.findAll({
      where: { account_id: accountId },
      order: [['date', 'ASC']],
    })
    return rows.map((r) => toEntity(r.get({ plain: true })))
  }

  // Transação vigente do escopo, nunca por parâmetro (arquitetura-camadas, regra 2.4).
  private transactionOptions(): { transaction?: NonNullable<ReturnType<GetTransaction>> } {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    return transaction ? { transaction } : {}
  }
}

function toRow(transaction: PluggyAccountTransaction, now: Date): PluggyAccountTransactionRow {
  return {
    item_id: transaction.getItemId(),
    account_id: transaction.getAccountId(),
    transaction_id: transaction.getTransactionId(),
    description: transaction.getDescription(),
    description_raw: transaction.getDescriptionRaw() ?? null,
    currency_code: transaction.getCurrencyCode(),
    amount: transaction.getAmount().toFixed(2),
    amount_in_account_currency: transaction.getAmountInAccountCurrency()?.toFixed(2) ?? null,
    balance: transaction.getBalance()?.toFixed(2) ?? null,
    date: transaction.getDate(),
    transaction_type: transaction.getTransactionType(),
    status: transaction.getStatus(),
    category_id: transaction.getCategoryId() ?? null,
    category: transaction.getCategory() ?? null,
    operation_type: transaction.getOperationType() ?? null,
    operation_type_additional_info: transaction.getOperationTypeAdditionalInfo() ?? null,
    provider_code: transaction.getProviderCode() ?? null,
    provider_id: transaction.getProviderId() ?? null,
    source_order: transaction.getSourceOrder() ?? null,
    merchant: transaction.getMerchant() ?? null,
    payment_data: transaction.getPaymentData() ?? null,
    credit_card_metadata: transaction.getCreditCardMetadata() ?? null,
    provider_created_at: transaction.getProviderCreatedAt(),
    provider_updated_at: transaction.getProviderUpdatedAt(),
    created_at: now,
    updated_at: now,
  } as PluggyAccountTransactionRow
}

export function toEntity(row: PluggyAccountTransactionRow): PluggyAccountTransaction {
  return PluggyAccountTransaction.reconstitute({
    itemId: row.item_id,
    accountId: row.account_id,
    transactionId: row.transaction_id,
    description: row.description,
    currencyCode: row.currency_code,
    amount: new Decimal(row.amount),
    date: row.date,
    transactionType: row.transaction_type,
    status: row.status,
    providerCreatedAt: row.provider_created_at,
    providerUpdatedAt: row.provider_updated_at,
    ...withDefined({
      descriptionRaw: row.description_raw ?? undefined,
      amountInAccountCurrency: row.amount_in_account_currency !== null ? new Decimal(row.amount_in_account_currency) : undefined,
      balance: row.balance !== null ? new Decimal(row.balance) : undefined,
      categoryId: row.category_id ?? undefined,
      category: row.category ?? undefined,
      operationType: row.operation_type ?? undefined,
      operationTypeAdditionalInfo: row.operation_type_additional_info ?? undefined,
      providerCode: row.provider_code ?? undefined,
      providerId: row.provider_id ?? undefined,
      sourceOrder: row.source_order !== null ? row.source_order : undefined,
      merchant: row.merchant ?? undefined,
      paymentData: row.payment_data ?? undefined,
      creditCardMetadata: row.credit_card_metadata ?? undefined,
    }),
  })
}

function withDefined<T extends object>(fields: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }
}
