import type { Model, ModelStatic } from 'sequelize'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyAccountRawRow } from '../../infra/db/models/pluggy-account-raw-model.js'

export interface SavePluggyAccountRawInput {
  itemId: string
  accountId: string
  rawPayload: Record<string, unknown>
  capturedAt: Date
}

// Log append-only (spec pluggy-raw-payload-audit): sempre `create`, nunca upsert.
export class PluggyAccountRawRep {
  private readonly model: ModelStatic<Model<PluggyAccountRawRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyAccountRaw
    this.getTransaction = params.getTransaction
  }

  async save(input: SavePluggyAccountRawInput): Promise<void> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    await this.model.create(
      {
        item_id: input.itemId,
        account_id: input.accountId,
        raw_payload: input.rawPayload,
        captured_at: input.capturedAt,
      } as PluggyAccountRawRow,
      transaction ? { transaction } : {},
    )
  }
}
