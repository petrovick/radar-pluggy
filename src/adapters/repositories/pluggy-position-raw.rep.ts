import type { Model, ModelStatic } from 'sequelize'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyPositionRawRow } from '../../infra/db/models/pluggy-position-raw-model.js'

export interface SavePluggyPositionRawInput {
  itemId: string
  investmentId: string
  rawPayload: Record<string, unknown>
  capturedAt: Date
}

// Log append-only (spec pluggy-raw-payload-audit): sempre `create`, nunca upsert.
export class PluggyPositionRawRep {
  private readonly model: ModelStatic<Model<PluggyPositionRawRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyPositionRaw
    this.getTransaction = params.getTransaction
  }

  async save(input: SavePluggyPositionRawInput): Promise<void> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    await this.model.create(
      {
        item_id: input.itemId,
        investment_id: input.investmentId,
        raw_payload: input.rawPayload,
        captured_at: input.capturedAt,
      } as PluggyPositionRawRow,
      transaction ? { transaction } : {},
    )
  }
}
