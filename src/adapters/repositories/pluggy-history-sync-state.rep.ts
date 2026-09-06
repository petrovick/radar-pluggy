import type { Model, ModelStatic } from 'sequelize'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import { PluggyHistorySyncState } from '../../entities/pluggy-history-sync-state.js'
import type { PluggyHistorySyncStateRow } from '../../infra/db/models/pluggy-history-sync-state-model.js'

export interface SavePluggyHistorySyncStateInput {
  itemId: string
  lastCompletedItemUpdatedAt: Date
}

export class PluggyHistorySyncStateRep {
  private readonly model: ModelStatic<Model<PluggyHistorySyncStateRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyHistorySyncState
    this.getTransaction = params.getTransaction
  }

  async save(input: SavePluggyHistorySyncStateInput): Promise<PluggyHistorySyncState> {
    const draft = PluggyHistorySyncState.create({
      itemId: input.itemId,
      lastCompletedItemUpdatedAt: input.lastCompletedItemUpdatedAt,
    })
    const now = new Date()

    const [row, created] = await this.model.findOrCreate({
      where: { item_id: draft.getItemId() },
      defaults: toRow(draft, now),
      ...this.transactionOptions(),
    })

    if (!created) {
      await row.update(toRow(draft, now), this.transactionOptions())
    }

    return draft
  }

  async findByItemId(itemId: string): Promise<PluggyHistorySyncState | undefined> {
    const row = await this.model.findOne({ where: { item_id: itemId } })
    return row ? toEntity(row.get({ plain: true })) : undefined
  }

  // Transação vigente do escopo, nunca por parâmetro (arquitetura-camadas, regra 2.4).
  private transactionOptions(): { transaction?: NonNullable<ReturnType<GetTransaction>> } {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    return transaction ? { transaction } : {}
  }
}

function toRow(state: PluggyHistorySyncState, now: Date): PluggyHistorySyncStateRow {
  return {
    item_id: state.getItemId(),
    last_completed_item_updated_at: state.getLastCompletedItemUpdatedAt(),
    created_at: now,
    updated_at: now,
  } as PluggyHistorySyncStateRow
}

export function toEntity(row: PluggyHistorySyncStateRow): PluggyHistorySyncState {
  return PluggyHistorySyncState.reconstitute({
    itemId: row.item_id,
    lastCompletedItemUpdatedAt: row.last_completed_item_updated_at,
  })
}
