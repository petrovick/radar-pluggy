import type { Model, ModelStatic } from 'sequelize'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyConsentRawRow } from '../../infra/db/models/pluggy-consent-raw-model.js'

export interface SavePluggyConsentRawInput {
  itemId: string
  consentId: string
  rawPayload: Record<string, unknown>
  capturedAt: Date
}

// Log append-only (spec pluggy-raw-payload-audit): sempre `create`, nunca upsert.
export class PluggyConsentRawRep {
  private readonly model: ModelStatic<Model<PluggyConsentRawRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyConsentRaw
    this.getTransaction = params.getTransaction
  }

  async save(input: SavePluggyConsentRawInput): Promise<void> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    await this.model.create(
      {
        item_id: input.itemId,
        consent_id: input.consentId,
        raw_payload: input.rawPayload,
        captured_at: input.capturedAt,
      } as PluggyConsentRawRow,
      transaction ? { transaction } : {},
    )
  }
}
