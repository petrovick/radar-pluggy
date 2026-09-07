import { Op, type Model, type ModelStatic } from 'sequelize'
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
  //
  // Escrita condicional no banco, nunca "ler, decidir em memória, escrever" (design.md D17): quando a
  // linha já existe, o `UPDATE` só é aplicado sob `last_updated_at IS NULL OR last_updated_at < :novo`
  // — uma execução mais antiga nunca sobrescreve uma mais nova, mesmo que a mais antiga termine (e
  // portanto tente gravar) depois. Zero linhas afetadas é no-op esperado, nunca erro.
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
    const options = transaction ? { transaction } : {}

    const [, created] = await this.model.findOrCreate({
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
      ...options,
    })

    if (created) {
      return draft
    }

    const versionGuard =
      input.lastUpdatedAt !== undefined
        ? { [Op.or]: [{ last_updated_at: { [Op.is]: null } }, { last_updated_at: { [Op.lt]: input.lastUpdatedAt } }] }
        : {}

    await this.model.update(
      {
        status: draft.getStatus(),
        execution_status: draft.getExecutionStatus() ?? null,
        ...(input.lastUpdatedAt !== undefined ? { last_updated_at: input.lastUpdatedAt } : {}),
        updated_at: now,
      } as Partial<PluggyItemRow>,
      { where: { item_id: draft.getItemId(), ...versionGuard }, ...options },
    )

    const persisted = await this.model.findOne({ where: { item_id: draft.getItemId() }, ...options })
    return persisted ? toEntity(persisted.get()) : draft
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
