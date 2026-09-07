import { Op, type Model, type ModelStatic } from 'sequelize'
import { PluggyItemObservation, type CreatePluggyItemObservationProps } from '../../entities/pluggy-item-observation.js'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyItemObservationRow } from '../../infra/db/models/pluggy-item-observation-model.js'

export class PluggyItemObservationRep {
  private readonly model: ModelStatic<Model<PluggyItemObservationRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyItemObservation
    this.getTransaction = params.getTransaction
  }

  async read(itemId: string): Promise<PluggyItemObservation | undefined> {
    const row = await this.model.findOne({ where: { item_id: itemId }, ...this.transactionOptions() })
    return row ? toEntity(row.get({ plain: true })) : undefined
  }

  // Usado por `/credentials/status` (D20): lê todas as observações de uma vez, nunca uma consulta
  // por item — a tradução (`CheckPluggyCredentialInteractor`) decide o que fazer com um item sem
  // observação (`undefined`, item recém-vinculado, nunca observado ainda).
  async readMany(itemIds: string[]): Promise<PluggyItemObservation[]> {
    if (itemIds.length === 0) {
      return []
    }
    const rows = await this.model.findAll({ where: { item_id: itemIds }, ...this.transactionOptions() })
    return rows.map((row) => toEntity(row.get({ plain: true })))
  }

  // Escrita condicional (design.md D9.1/D17): só aceita quando `observationStartedAt` é
  // ESTRITAMENTE maior que o já persistido — empate nunca sobrescreve (a primeira gravação a
  // comitar vence). Devolve se a observação foi aceita; quem chama decide, com essa resposta, se
  // também atualiza o connector do vínculo (D18) — nunca separadamente.
  async tryAccept(props: CreatePluggyItemObservationProps): Promise<boolean> {
    const draft = PluggyItemObservation.create(props)
    const now = new Date()
    const options = this.transactionOptions()

    const [, created] = await this.model.findOrCreate({
      where: { item_id: draft.getItemId() },
      defaults: toRow(draft, now),
      ...options,
    })

    if (created) {
      return true
    }

    const [updated] = await this.model.update(toRow(draft, now), {
      where: { item_id: draft.getItemId(), observation_started_at: { [Op.lt]: draft.getObservationStartedAt() } },
      ...options,
    })
    return updated > 0
  }

  private transactionOptions(): { transaction?: NonNullable<ReturnType<GetTransaction>> } {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    return transaction ? { transaction } : {}
  }
}

function toRow(observation: PluggyItemObservation, now: Date): PluggyItemObservationRow {
  return {
    item_id: observation.getItemId(),
    status: observation.getStatus(),
    execution_status: observation.getExecutionStatus(),
    status_detail: observation.getStatusDetail() ?? null,
    item_products: observation.getItemProducts() ?? null,
    last_updated_at: observation.getLastUpdatedAt() ?? null,
    next_auto_sync_at: observation.getNextAutoSyncAt() ?? null,
    connector_id: observation.getConnectorId() ?? null,
    observation_started_at: observation.getObservationStartedAt(),
    created_at: now,
    updated_at: now,
  } as PluggyItemObservationRow
}

export function toEntity(row: PluggyItemObservationRow): PluggyItemObservation {
  return PluggyItemObservation.reconstitute({
    itemId: row.item_id,
    status: row.status,
    executionStatus: row.execution_status,
    statusDetail: row.status_detail ?? undefined,
    itemProducts: row.item_products ?? undefined,
    lastUpdatedAt: row.last_updated_at ?? undefined,
    nextAutoSyncAt: row.next_auto_sync_at ?? undefined,
    connectorId: row.connector_id ?? undefined,
    observationStartedAt: row.observation_started_at,
  })
}
