import { Decimal } from 'decimal.js'
import type { Model, ModelStatic } from 'sequelize'
import { PluggyPositionSnapshot } from '../../entities/pluggy-position-snapshot.js'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyPositionSnapshotRow } from '../../infra/db/models/pluggy-position-snapshot-model.js'

export interface SavePluggyPositionSnapshotInput {
  itemId: string
  investmentId: string
  quotaDate: Date
  balance: Decimal
  quantity: Decimal | undefined
  amountOriginal: Decimal | undefined
  value?: Decimal | undefined
  amount?: Decimal | undefined
  taxes?: Decimal | undefined
  taxes2?: Decimal | undefined
  currencyCode: string
  syncedAt: Date
}

// Formato de repositório do `oplab-radar-api` (`adapters/repositories/car.repository.ts`): model vem
// da bag do container e a transação vigente é lida do escopo, nunca recebida por parâmetro.
export class PluggyPositionSnapshotRep {
  private readonly model: ModelStatic<Model<PluggyPositionSnapshotRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyPositionSnapshot
    this.getTransaction = params.getTransaction
  }

  // Upsert por (item_id, investment_id, quota_date) sobre a constraint uq_pluggy_connector_position_snapshots_item_investment_date.
  // Quota_date repetida atualiza a linha sem duplicar (design.md D11).
  async save(input: SavePluggyPositionSnapshotInput): Promise<PluggyPositionSnapshot> {
    const draft = PluggyPositionSnapshot.create({
      itemId: input.itemId,
      investmentId: input.investmentId,
      quotaDate: input.quotaDate,
      balance: input.balance,
      currencyCode: input.currencyCode,
      syncedAt: input.syncedAt,
      ...withDefined({
        quantity: input.quantity,
        amountOriginal: input.amountOriginal,
        value: input.value,
        amount: input.amount,
        taxes: input.taxes,
        taxes2: input.taxes2,
      }),
    })
    const now = new Date()
    const transaction = this.getTransaction(DB_NAMES.MAIN)

    const [row, created] = await this.model.findOrCreate({
      where: {
        item_id: draft.getItemId(),
        investment_id: draft.getInvestmentId(),
        quota_date: draft.getQuotaDate(),
      },
      defaults: toRow(draft, now),
      ...(transaction ? { transaction } : {}),
    })

    if (!created) {
      await row.update(toRow(draft, now), transaction ? { transaction } : {})
    }

    return draft
  }
}

function toRow(snapshot: PluggyPositionSnapshot, now: Date): PluggyPositionSnapshotRow {
  return {
    item_id: snapshot.getItemId(),
    investment_id: snapshot.getInvestmentId(),
    quota_date: snapshot.getQuotaDate(),
    balance: snapshot.getBalance().toFixed(2),
    quantity: snapshot.getQuantity()?.toFixed(8) ?? null,
    amount_original: snapshot.getAmountOriginal()?.toFixed(2) ?? null,
    value: snapshot.getValue()?.toFixed(8) ?? null,
    amount: snapshot.getAmount()?.toFixed(2) ?? null,
    taxes: snapshot.getTaxes()?.toFixed(2) ?? null,
    taxes2: snapshot.getTaxes2()?.toFixed(2) ?? null,
    currency_code: snapshot.getCurrencyCode(),
    synced_at: snapshot.getSyncedAt(),
    created_at: now,
  } as PluggyPositionSnapshotRow
}

export function toEntity(row: PluggyPositionSnapshotRow): PluggyPositionSnapshot {
  return PluggyPositionSnapshot.reconstitute({
    itemId: row.item_id,
    investmentId: row.investment_id,
    quotaDate: row.quota_date,
    balance: new Decimal(row.balance),
    currencyCode: row.currency_code,
    syncedAt: row.synced_at,
    ...withDefined({
      quantity: row.quantity !== null ? new Decimal(row.quantity) : undefined,
      amountOriginal: row.amount_original !== null ? new Decimal(row.amount_original) : undefined,
      value: row.value !== null ? new Decimal(row.value) : undefined,
      amount: row.amount !== null ? new Decimal(row.amount) : undefined,
      taxes: row.taxes !== null ? new Decimal(row.taxes) : undefined,
      taxes2: row.taxes2 !== null ? new Decimal(row.taxes2) : undefined,
    }),
  })
}

function withDefined<T extends object>(fields: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }
}
