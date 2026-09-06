import type { Model, ModelStatic } from 'sequelize'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyLoanRawRow } from '../../infra/db/models/pluggy-loan-raw-model.js'

export interface SavePluggyLoanRawInput {
  itemId: string
  loanId: string
  rawPayload: Record<string, unknown>
  capturedAt: Date
}

// Log append-only (spec pluggy-raw-payload-audit): sempre `create`, nunca upsert.
export class PluggyLoanRawRep {
  private readonly model: ModelStatic<Model<PluggyLoanRawRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyLoanRaw
    this.getTransaction = params.getTransaction
  }

  async save(input: SavePluggyLoanRawInput): Promise<void> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    await this.model.create(
      {
        item_id: input.itemId,
        loan_id: input.loanId,
        raw_payload: input.rawPayload,
        captured_at: input.capturedAt,
      } as PluggyLoanRawRow,
      transaction ? { transaction } : {},
    )
  }
}
