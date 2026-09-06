import { Decimal } from 'decimal.js'
import type { Model, ModelStatic } from 'sequelize'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import { PluggyAccount } from '../../entities/pluggy-account.js'
import type { PluggyAccountRow } from '../../infra/db/models/pluggy-account-model.js'

export interface SavePluggyAccountInput {
  itemId: string
  accountId: string
  type: string
  subtype?: string | undefined
  number: string
  name: string
  marketingName?: string | undefined
  balance: Decimal
  currencyCode: string
  owner?: string | undefined
  providerCreatedAt: Date
  providerUpdatedAt: Date
  level?: string | undefined
  brand?: string | undefined
  brandAdditionalInfo?: string | undefined
  balanceCloseDate?: Date | undefined
  balanceDueDate?: Date | undefined
  availableCreditLimit?: Decimal | undefined
  balanceForeignCurrency?: Decimal | undefined
  minimumPayment?: Decimal | undefined
  creditLimit?: Decimal | undefined
  isLimitFlexible?: boolean | undefined
  status?: 'ACTIVE' | 'BLOCKED' | 'CANCELLED' | undefined
  holderType?: 'MAIN' | 'ADDITIONAL' | undefined
  taxNumber?: string | undefined
  bankData?: Record<string, unknown> | undefined
  disaggregatedCreditLimits?: Record<string, unknown>[] | undefined
}

export class PluggyAccountRep {
  private readonly model: ModelStatic<Model<PluggyAccountRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyAccount
    this.getTransaction = params.getTransaction
  }

  // Upsert por (item_id, account_id) sobre a constraint uq_pluggy_connector_accounts_item_account.
  async save(input: SavePluggyAccountInput): Promise<PluggyAccount> {
    const draft = PluggyAccount.create({
      itemId: input.itemId,
      accountId: input.accountId,
      type: input.type,
      number: input.number,
      name: input.name,
      balance: input.balance,
      currencyCode: input.currencyCode,
      providerCreatedAt: input.providerCreatedAt,
      providerUpdatedAt: input.providerUpdatedAt,
      ...withDefined({
        subtype: input.subtype,
        marketingName: input.marketingName,
        owner: input.owner,
        level: input.level,
        brand: input.brand,
        brandAdditionalInfo: input.brandAdditionalInfo,
        balanceCloseDate: input.balanceCloseDate,
        balanceDueDate: input.balanceDueDate,
        availableCreditLimit: input.availableCreditLimit,
        balanceForeignCurrency: input.balanceForeignCurrency,
        minimumPayment: input.minimumPayment,
        creditLimit: input.creditLimit,
        isLimitFlexible: input.isLimitFlexible,
        status: input.status,
        holderType: input.holderType,
        taxNumber: input.taxNumber,
        bankData: input.bankData,
        disaggregatedCreditLimits: input.disaggregatedCreditLimits,
      }),
    })
    const now = new Date()

    const [row, created] = await this.model.findOrCreate({
      where: {
        item_id: draft.getItemId(),
        account_id: draft.getAccountId(),
      },
      defaults: toRow(draft, now),
      ...this.transactionOptions(),
    })

    if (!created) {
      await row.update(toRow(draft, now), this.transactionOptions())
    }

    return draft
  }

  async findByItemId(itemId: string): Promise<PluggyAccount[]> {
    const rows = await this.model.findAll({ where: { item_id: itemId } })
    return rows.map((r) => toEntity(r.get({ plain: true })))
  }

  async findByAccountId(accountId: string): Promise<PluggyAccount | undefined> {
    const row = await this.model.findOne({ where: { account_id: accountId } })
    return row ? toEntity(row.get({ plain: true })) : undefined
  }

  // Transação vigente do escopo, nunca por parâmetro (arquitetura-camadas, regra 2.4).
  private transactionOptions(): { transaction?: NonNullable<ReturnType<GetTransaction>> } {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    return transaction ? { transaction } : {}
  }
}

function toRow(account: PluggyAccount, now: Date): PluggyAccountRow {
  return {
    item_id: account.getItemId(),
    account_id: account.getAccountId(),
    type: account.getType(),
    subtype: account.getSubtype() ?? null,
    number: account.getNumber(),
    name: account.getName(),
    marketing_name: account.getMarketingName() ?? null,
    balance: account.getBalance().toFixed(2),
    currency_code: account.getCurrencyCode(),
    owner: account.getOwner() ?? null,
    provider_created_at: account.getProviderCreatedAt(),
    provider_updated_at: account.getProviderUpdatedAt(),
    level: account.getLevel() ?? null,
    brand: account.getBrand() ?? null,
    brand_additional_info: account.getBrandAdditionalInfo() ?? null,
    balance_close_date: account.getBalanceCloseDate() ?? null,
    balance_due_date: account.getBalanceDueDate() ?? null,
    available_credit_limit: account.getAvailableCreditLimit()?.toFixed(2) ?? null,
    balance_foreign_currency: account.getBalanceForeignCurrency()?.toFixed(2) ?? null,
    minimum_payment: account.getMinimumPayment()?.toFixed(2) ?? null,
    credit_limit: account.getCreditLimit()?.toFixed(2) ?? null,
    is_limit_flexible: account.getIsLimitFlexible() ?? null,
    status: account.getStatus() ?? null,
    holder_type: account.getHolderType() ?? null,
    tax_number: account.getTaxNumber() ?? null,
    bank_data: account.getBankData() ?? null,
    disaggregated_credit_limits: account.getDisaggregatedCreditLimits() ?? null,
    created_at: now,
    updated_at: now,
  } as PluggyAccountRow
}

export function toEntity(row: PluggyAccountRow): PluggyAccount {
  return PluggyAccount.reconstitute({
    itemId: row.item_id,
    accountId: row.account_id,
    type: row.type,
    number: row.number,
    name: row.name,
    balance: new Decimal(row.balance),
    currencyCode: row.currency_code,
    providerCreatedAt: row.provider_created_at,
    providerUpdatedAt: row.provider_updated_at,
    ...withDefined({
      subtype: row.subtype ?? undefined,
      marketingName: row.marketing_name ?? undefined,
      owner: row.owner ?? undefined,
      level: row.level ?? undefined,
      brand: row.brand ?? undefined,
      brandAdditionalInfo: row.brand_additional_info ?? undefined,
      balanceCloseDate: row.balance_close_date ?? undefined,
      balanceDueDate: row.balance_due_date ?? undefined,
      availableCreditLimit: row.available_credit_limit === null ? undefined : new Decimal(row.available_credit_limit),
      balanceForeignCurrency:
        row.balance_foreign_currency === null ? undefined : new Decimal(row.balance_foreign_currency),
      minimumPayment: row.minimum_payment === null ? undefined : new Decimal(row.minimum_payment),
      creditLimit: row.credit_limit === null ? undefined : new Decimal(row.credit_limit),
      isLimitFlexible: row.is_limit_flexible ?? undefined,
      status: (row.status ?? undefined) as 'ACTIVE' | 'BLOCKED' | 'CANCELLED' | undefined,
      holderType: (row.holder_type ?? undefined) as 'MAIN' | 'ADDITIONAL' | undefined,
      taxNumber: row.tax_number ?? undefined,
      bankData: row.bank_data ?? undefined,
      disaggregatedCreditLimits: row.disaggregated_credit_limits ?? undefined,
    }),
  })
}

function withDefined<T extends object>(fields: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }
}
