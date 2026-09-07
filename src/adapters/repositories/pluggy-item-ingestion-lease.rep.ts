import { literal, Op, type Model, type ModelStatic } from 'sequelize'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyItemIngestionLeaseRow } from '../../infra/db/models/pluggy-item-ingestion-lease-model.js'

// Lease de ingestão por Item (design.md D16): no máximo uma ingestão (Position+History) por Item
// executando por vez, qualquer que seja o trigger. Mesmo idioma de claim atômico já usado por
// `PluggyWebhookEventRep` (`UPDATE ... WHERE` decide o vencedor no banco, linhas afetadas prova
// posse) — `fencing_token`, nunca `acquired_at`, é a prova de posse: um contador que só incrementa
// nunca colide, mesmo quando duas aquisições acontecem no mesmo milissegundo.
export class PluggyItemIngestionLeaseRep {
  private readonly model: ModelStatic<Model<PluggyItemIngestionLeaseRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyItemIngestionLease
    this.getTransaction = params.getTransaction
  }

  // `findOrCreate` garante a linha "livre" (`lease_until` no epoch, `fencing_token = 0`) na primeira
  // vez que o item é visto. O `UPDATE ... WHERE lease_until <= :now` decide o vencedor: só quem
  // afeta a linha incrementou de fato o `fencing_token` — devolve esse valor pós-incremento, ou
  // `undefined` se outro trigger já detém o lease.
  async tryAcquire(itemId: string, trigger: string, ttlMs: number): Promise<number | undefined> {
    const now = new Date()
    const options = this.transactionOptions()

    await this.model.findOrCreate({
      where: { item_id: itemId },
      defaults: {
        item_id: itemId,
        trigger,
        lease_until: new Date(0),
        fencing_token: 0,
        acquired_at: now,
        created_at: now,
        updated_at: now,
      } as PluggyItemIngestionLeaseRow,
      ...options,
    })

    const [claimed] = await this.model.update(
      {
        trigger,
        lease_until: new Date(now.getTime() + ttlMs),
        // `fencing_token + 1` no banco — nunca lido e reincrementado em memória, que reabriria a
        // janela de corrida que este contador existe pra fechar.
        fencing_token: literal('fencing_token + 1'),
        acquired_at: now,
        updated_at: now,
      } as unknown as Partial<PluggyItemIngestionLeaseRow>,
      { where: { item_id: itemId, lease_until: { [Op.lte]: now } }, ...options },
    )

    if (claimed === 0) {
      return undefined
    }

    // A própria escrita acima já tornou `lease_until` futuro — nenhuma outra aquisição concorrente
    // pode ter mudado `fencing_token` entre o `UPDATE` e esta leitura.
    const row = await this.model.findOne({ where: { item_id: itemId }, ...options })
    const token = row?.get('fencing_token')
    return token === undefined ? undefined : Number(token)
  }

  // Só aceita quando `fencingToken` ainda é o vigente — nunca muda o token. Chamado em heartbeat
  // enquanto o trabalho estiver em andamento (design.md D16).
  async renew(itemId: string, fencingToken: number, ttlMs: number): Promise<boolean> {
    const now = new Date()
    const [updated] = await this.model.update(
      { lease_until: new Date(now.getTime() + ttlMs), updated_at: now } as Partial<PluggyItemIngestionLeaseRow>,
      { where: { item_id: itemId, fencing_token: fencingToken }, ...this.transactionOptions() },
    )
    return updated > 0
  }

  // Libera adiantando `lease_until` para agora — só quando `fencingToken` ainda é o vigente. Um lease
  // vencido e reivindicado por outro (com `fencing_token` maior) nunca é liberado pelo dono antigo
  // por engano, porque o `WHERE` não casa mais.
  async release(itemId: string, fencingToken: number): Promise<boolean> {
    const now = new Date()
    const [updated] = await this.model.update(
      { lease_until: now, updated_at: now } as Partial<PluggyItemIngestionLeaseRow>,
      { where: { item_id: itemId, fencing_token: fencingToken }, ...this.transactionOptions() },
    )
    return updated > 0
  }

  private transactionOptions(): { transaction?: NonNullable<ReturnType<GetTransaction>> } {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    return transaction ? { transaction } : {}
  }
}
