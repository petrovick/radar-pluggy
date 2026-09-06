import { Decimal } from 'decimal.js'
import type { Model, ModelStatic } from 'sequelize'
import { PluggyLoanSnapshot } from '../../entities/pluggy-loan-snapshot.js'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyLoanSnapshotRow } from '../../infra/db/models/pluggy-loan-snapshot-model.js'

export interface SavePluggyLoanSnapshotInput {
  itemId: string
  loanId: string
  outstandingBalance: Decimal | undefined
  totalInstallments: number | undefined
  paidInstallments: number | undefined
  dueInstallments: number | undefined
  pastDueInstallments: number | undefined
  currencyCode: string
  syncedAt: Date
}

// Mesmo formato de PluggyPositionSnapshotRep: model vem da bag do container, transação vigente lida
// do escopo.
export class PluggyLoanSnapshotRep {
  private readonly model: ModelStatic<Model<PluggyLoanSnapshotRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyLoanSnapshot
    this.getTransaction = params.getTransaction
  }

  // Upsert por (item_id, loan_id, synced_at) sobre a constraint
  // uq_pluggy_connector_loan_snapshots_item_loan_synced — uma linha por sincronização (não existe
  // data de cotação do provedor para agrupar por dia como em posição).
  async save(input: SavePluggyLoanSnapshotInput): Promise<PluggyLoanSnapshot> {
    const draft = PluggyLoanSnapshot.create({
      itemId: input.itemId,
      loanId: input.loanId,
      currencyCode: input.currencyCode,
      syncedAt: input.syncedAt,
      ...withDefined({
        outstandingBalance: input.outstandingBalance,
        totalInstallments: input.totalInstallments,
        paidInstallments: input.paidInstallments,
        dueInstallments: input.dueInstallments,
        pastDueInstallments: input.pastDueInstallments,
      }),
    })
    const now = new Date()
    const transaction = this.getTransaction(DB_NAMES.MAIN)

    const [row, created] = await this.model.findOrCreate({
      where: {
        item_id: draft.getItemId(),
        loan_id: draft.getLoanId(),
        synced_at: draft.getSyncedAt(),
      },
      defaults: toRow(draft, now),
      ...(transaction ? { transaction } : {}),
    })

    if (!created) {
      await row.update(toRow(draft, now), transaction ? { transaction } : {})
    }

    return draft
  }
}

function toRow(snapshot: PluggyLoanSnapshot, now: Date): PluggyLoanSnapshotRow {
  return {
    loan_id: snapshot.getLoanId(),
    item_id: snapshot.getItemId(),
    outstanding_balance: snapshot.getOutstandingBalance()?.toFixed(2) ?? null,
    total_installments: snapshot.getTotalInstallments() ?? null,
    paid_installments: snapshot.getPaidInstallments() ?? null,
    due_installments: snapshot.getDueInstallments() ?? null,
    past_due_installments: snapshot.getPastDueInstallments() ?? null,
    currency_code: snapshot.getCurrencyCode(),
    synced_at: snapshot.getSyncedAt(),
    created_at: now,
  } as PluggyLoanSnapshotRow
}

export function toEntity(row: PluggyLoanSnapshotRow): PluggyLoanSnapshot {
  return PluggyLoanSnapshot.reconstitute({
    itemId: row.item_id,
    loanId: row.loan_id,
    currencyCode: row.currency_code,
    syncedAt: row.synced_at,
    ...withDefined({
      outstandingBalance: row.outstanding_balance !== null ? new Decimal(row.outstanding_balance) : undefined,
      totalInstallments: row.total_installments ?? undefined,
      paidInstallments: row.paid_installments ?? undefined,
      dueInstallments: row.due_installments ?? undefined,
      pastDueInstallments: row.past_due_installments ?? undefined,
    }),
  })
}

function withDefined<T extends object>(fields: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }
}
