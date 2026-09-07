import { Op, type Model, type ModelStatic } from 'sequelize'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import { PluggyHistoryCoverage } from '../../entities/pluggy-history-coverage.js'
import type { PluggyHistoryCoverageRow } from '../../infra/db/models/pluggy-history-coverage-model.js'

export interface SavePluggyHistoryCoverageInput {
  itemId: string
  referenceId: string
  referenceType: 'ACCOUNT' | 'INVESTMENT'
  oldestObservedTransactionAt?: Date | undefined
  newestObservedTransactionAt?: Date | undefined
  observedTransactionCount: number
  sourceUpdatedAt?: Date | undefined
  lastCompletedScanAt: Date
}

export class PluggyHistoryCoverageRep {
  private readonly model: ModelStatic<Model<PluggyHistoryCoverageRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyHistoryCoverage
    this.getTransaction = params.getTransaction
  }

  // Escrita condicional no banco (design.md D17), mesmo idioma de `PluggyItemRep.save`: nunca "ler,
  // decidir em memória, escrever". Versão primária é `source_updated_at` (quando a chamada o
  // fornece) — uma varredura mais antiga nunca sobrescreve uma mais nova, mesmo terminando depois.
  // Sem `source_updated_at` (D14: deixou de ser condição necessária para decidir *se* varre, mas
  // continua registrado quando disponível), o fallback é `last_completed_scan_at` — mesmo raciocínio
  // de D17. Zero linhas afetadas é no-op esperado, nunca erro.
  async save(input: SavePluggyHistoryCoverageInput): Promise<PluggyHistoryCoverage> {
    const draft = PluggyHistoryCoverage.create({
      itemId: input.itemId,
      referenceId: input.referenceId,
      referenceType: input.referenceType,
      observedTransactionCount: input.observedTransactionCount,
      lastCompletedScanAt: input.lastCompletedScanAt,
      ...withDefined({
        oldestObservedTransactionAt: input.oldestObservedTransactionAt,
        newestObservedTransactionAt: input.newestObservedTransactionAt,
        sourceUpdatedAt: input.sourceUpdatedAt,
      }),
    })
    const now = new Date()
    const options = this.transactionOptions()

    const [, created] = await this.model.findOrCreate({
      where: {
        item_id: draft.getItemId(),
        reference_type: draft.getReferenceType(),
        reference_id: draft.getReferenceId(),
      },
      defaults: toRow(draft, now),
      ...options,
    })

    if (created) {
      return draft
    }

    const versionGuard =
      draft.getSourceUpdatedAt() !== undefined
        ? {
            [Op.or]: [
              { source_updated_at: { [Op.is]: null } },
              { source_updated_at: { [Op.lt]: draft.getSourceUpdatedAt() } },
            ],
          }
        : { [Op.or]: [{ last_completed_scan_at: { [Op.lt]: draft.getLastCompletedScanAt() } }] }

    await this.model.update(toRow(draft, now), {
      where: {
        item_id: draft.getItemId(),
        reference_type: draft.getReferenceType(),
        reference_id: draft.getReferenceId(),
        ...versionGuard,
      },
      ...options,
    })

    const persisted = await this.model.findOne({
      where: { item_id: draft.getItemId(), reference_type: draft.getReferenceType(), reference_id: draft.getReferenceId() },
      ...options,
    })
    return persisted ? toEntity(persisted.get({ plain: true })) : draft
  }

  async findByReference(
    itemId: string,
    referenceType: 'ACCOUNT' | 'INVESTMENT',
    referenceId: string,
  ): Promise<PluggyHistoryCoverage | undefined> {
    const row = await this.model.findOne({
      where: {
        item_id: itemId,
        reference_type: referenceType,
        reference_id: referenceId,
      },
    })
    return row ? toEntity(row.get({ plain: true })) : undefined
  }

  // Transação vigente do escopo, nunca por parâmetro (arquitetura-camadas, regra 2.4).
  private transactionOptions(): { transaction?: NonNullable<ReturnType<GetTransaction>> } {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    return transaction ? { transaction } : {}
  }
}

function toRow(coverage: PluggyHistoryCoverage, now: Date): PluggyHistoryCoverageRow {
  return {
    item_id: coverage.getItemId(),
    reference_id: coverage.getReferenceId(),
    reference_type: coverage.getReferenceType(),
    oldest_observed_transaction_at: coverage.getOldestObservedTransactionAt() ?? null,
    newest_observed_transaction_at: coverage.getNewestObservedTransactionAt() ?? null,
    observed_transaction_count: coverage.getObservedTransactionCount(),
    source_updated_at: coverage.getSourceUpdatedAt() ?? null,
    last_completed_scan_at: coverage.getLastCompletedScanAt(),
    created_at: now,
    updated_at: now,
  } as PluggyHistoryCoverageRow
}

export function toEntity(row: PluggyHistoryCoverageRow): PluggyHistoryCoverage {
  return PluggyHistoryCoverage.reconstitute({
    itemId: row.item_id,
    referenceId: row.reference_id,
    referenceType: row.reference_type as 'ACCOUNT' | 'INVESTMENT',
    observedTransactionCount: row.observed_transaction_count,
    lastCompletedScanAt: row.last_completed_scan_at,
    ...withDefined({
      oldestObservedTransactionAt: row.oldest_observed_transaction_at ?? undefined,
      newestObservedTransactionAt: row.newest_observed_transaction_at ?? undefined,
      sourceUpdatedAt: row.source_updated_at ?? undefined,
    }),
  })
}

function withDefined<T extends object>(fields: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }
}
