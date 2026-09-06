import type { Model, ModelStatic } from 'sequelize'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyItemRawRow } from '../../infra/db/models/pluggy-item-raw-model.js'

export interface SavePluggyItemRawInput {
  itemId: string
  rawPayload: Record<string, unknown>
  capturedAt: Date
}

// Log append-only (spec pluggy-raw-payload-audit): sempre `create`, nunca upsert — cada
// sincronização grava uma linha nova, mesmo idêntica à anterior. Sem entity: não há invariante de
// negócio a validar além da presença das colunas, que o tipo já garante.
export class PluggyItemRawRep {
  private readonly model: ModelStatic<Model<PluggyItemRawRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyItemRaw
    this.getTransaction = params.getTransaction
  }

  async save(input: SavePluggyItemRawInput): Promise<void> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    await this.model.create(
      { item_id: input.itemId, raw_payload: input.rawPayload, captured_at: input.capturedAt } as PluggyItemRawRow,
      transaction ? { transaction } : {},
    )
  }
}
