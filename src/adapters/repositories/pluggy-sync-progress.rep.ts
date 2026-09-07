import { Op, type Model, type ModelStatic } from 'sequelize'
import { PluggySyncProgress, type PluggySyncConsumer } from '../../entities/pluggy-sync-progress.js'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggySyncProgressRow } from '../../infra/db/models/pluggy-sync-progress-model.js'
import type { PluggySource } from '../gateways/pluggy-source-catalog.js'

// Marca d'água por (`itemId`, `consumer`, `source`) — design.md D4/D12. `read` devolve `undefined`
// quando a combinação nunca foi observada (sempre elegível — spec `pluggy-sync-progress`, "Combinação
// nunca observada é sempre elegível"). `advance` é escrita condicional no banco (D17): nunca "ler,
// decidir em memória, escrever" — uma versão mais antiga nunca sobrescreve uma mais nova, mesmo que a
// escrita da mais antiga chegue depois.
export class PluggySyncProgressRep {
  private readonly model: ModelStatic<Model<PluggySyncProgressRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggySyncProgress
    this.getTransaction = params.getTransaction
  }

  async read(itemId: string, consumer: PluggySyncConsumer, source: PluggySource): Promise<Date | undefined> {
    const row = await this.model.findOne({
      where: { item_id: itemId, consumer, source },
      ...this.transactionOptions(),
    })
    return row?.get().last_completed_version_at
  }

  // Devolve se ESTA escrita venceu a corrida de versão (linha criada, ou `UPDATE` afetou alguma
  // linha) — quem reconcilia fotografia junto do avanço (ver `*Impl.commit*`) usa esse booleano para
  // decidir se o upsert/reconciliação também deve rodar, na MESMA transação que este `advance`: uma
  // execução mais antiga que perdeu a corrida nunca chega a tocar a fotografia.
  async advance(itemId: string, consumer: PluggySyncConsumer, source: PluggySource, versionAt: Date): Promise<boolean> {
    // Valida o vocabulário fechado (consumer/source) antes de tocar o banco — recusa nomeada, nunca
    // linha com valor fora do domínio.
    PluggySyncProgress.create({ itemId, consumer, source, lastCompletedVersionAt: versionAt })

    const now = new Date()
    const options = this.transactionOptions()

    const [, created] = await this.model.findOrCreate({
      where: { item_id: itemId, consumer, source },
      defaults: {
        item_id: itemId,
        consumer,
        source,
        last_completed_version_at: versionAt,
        created_at: now,
        updated_at: now,
      } as PluggySyncProgressRow,
      ...options,
    })

    if (created) {
      return true
    }

    const [updated] = await this.model.update(
      { last_completed_version_at: versionAt, updated_at: now } as Partial<PluggySyncProgressRow>,
      {
        where: {
          item_id: itemId,
          consumer,
          source,
          [Op.or]: [{ last_completed_version_at: { [Op.lt]: versionAt } }],
        },
        ...options,
      },
    )
    return updated > 0
  }

  private transactionOptions(): { transaction?: NonNullable<ReturnType<GetTransaction>> } {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    return transaction ? { transaction } : {}
  }
}
