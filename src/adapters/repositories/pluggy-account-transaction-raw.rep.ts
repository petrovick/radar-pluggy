import type { Model, ModelStatic } from 'sequelize'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyAccountTransactionRawRow } from '../../infra/db/models/pluggy-account-transaction-raw-model.js'

export interface SavePluggyAccountTransactionRawInput {
  itemId: string
  accountId: string
  transactionId: string
  rawPayload: Record<string, unknown>
  capturedAt: Date
}

// Log append-only (spec pluggy-raw-payload-audit): sempre `create`, nunca upsert.
export class PluggyAccountTransactionRawRep {
  private readonly model: ModelStatic<Model<PluggyAccountTransactionRawRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyAccountTransactionRaw
    this.getTransaction = params.getTransaction
  }

  async save(input: SavePluggyAccountTransactionRawInput): Promise<void> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    await this.model.create(
      {
        item_id: input.itemId,
        account_id: input.accountId,
        transaction_id: input.transactionId,
        raw_payload: input.rawPayload,
        captured_at: input.capturedAt,
      } as PluggyAccountTransactionRawRow,
      transaction ? { transaction } : {},
    )
  }
}
