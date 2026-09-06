import type { Model, ModelStatic } from 'sequelize'
import { PluggyItem } from '../../entities/pluggy-item.js'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyItemRow } from '../../infra/db/models/pluggy-item-model.js'

export interface SavePluggyItemInput {
  itemId: string
  personId: number | undefined
  status: string
  executionStatus: string | undefined
  lastUpdatedAt: Date | undefined
}

export class PluggyItemRep {
  private readonly model: ModelStatic<Model<PluggyItemRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyItem
    this.getTransaction = params.getTransaction
  }

  // Unicidade de item_id garantida por findOrCreate sobre a constraint real do banco — nunca
  // "buscar, e se não achar, criar" em dois passos (modelagem-de-dados, idempotência de escrita).
  // Quando a linha já existe, `findOrCreate` a devolve intocada (não escreve `defaults` de novo) —
  // a atualização de status/watermark acontece à parte, contra o estado REAL persistido, nunca
  // contra o rascunho recém-validado: só assim `advanceWatermark` compara com uma marca d'água
  // que existe de verdade (achado do engenheiro-pluggy-connector na primeira revisão).
  async save(input: SavePluggyItemInput): Promise<PluggyItem> {
    const draft = PluggyItem.create({
      itemId: input.itemId,
      personId: input.personId,
      status: input.status,
      ...(input.executionStatus !== undefined ? { executionStatus: input.executionStatus } : {}),
    })
    if (input.lastUpdatedAt !== undefined) {
      draft.advanceWatermark(input.lastUpdatedAt)
    }

    const now = new Date()
    const transaction = this.getTransaction(DB_NAMES.MAIN)

    const [row, created] = await this.model.findOrCreate({
      where: { item_id: draft.getItemId() },
      defaults: {
        item_id: draft.getItemId(),
        person_id: draft.getPersonId(),
        status: draft.getStatus(),
        execution_status: draft.getExecutionStatus() ?? null,
        last_updated_at: draft.getLastUpdatedAt() ?? null,
        created_at: now,
        updated_at: now,
      } as PluggyItemRow,
      ...(transaction ? { transaction } : {}),
    })

    if (created) {
      return draft
    }

    const persisted = toEntity(row.get())
    persisted.updateStatus(draft.getStatus(), draft.getExecutionStatus())
    if (input.lastUpdatedAt !== undefined) {
      persisted.advanceWatermark(input.lastUpdatedAt)
    }

    await row.update(
      {
        status: persisted.getStatus(),
        execution_status: persisted.getExecutionStatus() ?? null,
        last_updated_at: persisted.getLastUpdatedAt() ?? null,
        updated_at: now,
      },
      transaction ? { transaction } : {},
    )

    return persisted
  }

  async findByItemId(itemId: string): Promise<PluggyItem | undefined> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    const row = await this.model.findOne({
      where: { item_id: itemId },
      ...(transaction ? { transaction } : {}),
    })
    return row ? toEntity(row.get()) : undefined
  }
}

export function toEntity(row: PluggyItemRow): PluggyItem {
  return PluggyItem.reconstitute({
    itemId: row.item_id,
    personId: row.person_id,
    status: row.status,
    executionStatus: row.execution_status ?? undefined,
    lastUpdatedAt: row.last_updated_at ?? undefined,
  })
}
