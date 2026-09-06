import { Op, type Model, type ModelStatic } from 'sequelize'
import { PluggyWebhookEvent } from '../../entities/pluggy-webhook-event.js'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyWebhookEventRow } from '../../infra/db/models/pluggy-webhook-event-model.js'

// Quanto tempo um worker pode segurar um evento antes de outro poder retomá-lo. Curto o bastante para
// crash não deixar trabalho preso por muito tempo, longo o bastante para uma carga histórica inteira
// (varredura de várias fontes) caber dentro dele.
const LEASE_DURATION_MS = 10 * 60 * 1000

export interface EnqueuePluggyWebhookEventInput {
  eventId: string
  itemId: string
  event: string
}

export class PluggyWebhookEventRep {
  private readonly model: ModelStatic<Model<PluggyWebhookEventRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyWebhookEvent
    this.getTransaction = params.getTransaction
  }

  // Idempotência por `event_id`, garantida pela constraint única do banco (fronteira-pluggy, regra
  // 10): a reentrega do mesmo evento — normal, até 9 vezes — encontra a linha existente e não cria
  // uma segunda. `findOrCreate` num passo, nunca "buscar e se não achar criar".
  async enqueue(input: EnqueuePluggyWebhookEventInput): Promise<{ event: PluggyWebhookEvent; alreadyKnown: boolean }> {
    const draft = PluggyWebhookEvent.create(input)
    const now = new Date()

    const [row, created] = await this.model.findOrCreate({
      where: { event_id: draft.getEventId() },
      defaults: {
        event_id: draft.getEventId(),
        item_id: draft.getItemId(),
        event: draft.getEvent(),
        state: draft.getState(),
        lease_until: null,
        attempts: 0,
        last_attempt_at: null,
        error_summary: null,
        created_at: now,
        updated_at: now,
      } as PluggyWebhookEventRow,
      ...this.transactionOptions(),
    })

    return { event: toEntity(row.get()), alreadyKnown: !created }
  }

  // Claim atômico: o `UPDATE ... WHERE state = 'PENDING'` decide o vencedor no banco, então dois
  // workers simultâneos nunca processam o mesmo evento. Devolve `undefined` quando outro já pegou.
  //
  // Serialização por item (tasks.md 7.2): só reivindica se nenhum evento DAQUELE item estiver em
  // `PROCESSING` com lease vivo — dois eventos do mesmo item nunca correm em paralelo, o que evitaria
  // duas cargas concorrentes escrevendo a mesma fotografia.
  //
  // Devolve o `leaseToken` (o `lease_until` gravado neste claim) porque concluir ou devolver o evento
  // exige PROVAR posse: se o lease vencer com o worker ainda vivo e outro reivindicar o mesmo evento,
  // o token muda, e a escrita do worker atrasado não encontra linha para atualizar — em vez de os dois
  // sobrescreverem o estado um do outro em silêncio (achado do engenheiro-pluggy-connector).
  async claimNextPending(now = new Date()): Promise<{ event: PluggyWebhookEvent; leaseToken: Date } | undefined> {
    const busyItems = await this.model.findAll({
      attributes: ['item_id'],
      where: { state: 'PROCESSING', lease_until: { [Op.gt]: now } },
      ...this.transactionOptions(),
    })
    const busyItemIds = busyItems.map((row) => row.get('item_id'))

    const where: Record<string, unknown> = { state: 'PENDING' }
    if (busyItemIds.length > 0) {
      where.item_id = { [Op.notIn]: busyItemIds }
    }

    const candidate = await this.model.findOne({
      where,
      order: [['id', 'ASC']],
      ...this.transactionOptions(),
    })
    if (!candidate) {
      return undefined
    }

    const current = candidate.get()
    const id = current.id
    const leaseToken = new Date(now.getTime() + LEASE_DURATION_MS)
    const [claimed] = await this.model.update(
      {
        state: 'PROCESSING',
        lease_until: leaseToken,
        attempts: current.attempts + 1,
        last_attempt_at: now,
        updated_at: now,
      } as Partial<PluggyWebhookEventRow>,
      { where: { id, state: 'PENDING' }, ...this.transactionOptions() },
    )

    if (claimed === 0) {
      return undefined
    }

    const row = await this.model.findByPk(id, this.transactionOptions())
    return row ? { event: toEntity(row.get()), leaseToken } : undefined
  }

  // `leaseToken` prova posse: escrita de worker que já perdeu o lease não afeta linha nenhuma.
  // Devolve `false` nesse caso, para quem chamou saber que o trabalho dele foi reivindicado por outro.
  async markSucceeded(id: number, leaseToken: Date): Promise<boolean> {
    const now = new Date()
    const [updated] = await this.model.update(
      { state: 'SUCCEEDED', lease_until: null, error_summary: null, updated_at: now } as Partial<PluggyWebhookEventRow>,
      { where: { id, lease_until: leaseToken }, ...this.transactionOptions() },
    )
    return updated > 0
  }

  // Falha devolve a `PENDING`, com o erro resumido: a próxima drenagem tenta de novo. Só a mensagem,
  // nunca payload nem identificador real (design.md, Risks).
  async releaseToPending(id: number, errorSummary: string, leaseToken: Date): Promise<boolean> {
    const now = new Date()
    const [updated] = await this.model.update(
      {
        state: 'PENDING',
        lease_until: null,
        error_summary: errorSummary.slice(0, 500),
        updated_at: now,
      } as Partial<PluggyWebhookEventRow>,
      { where: { id, lease_until: leaseToken }, ...this.transactionOptions() },
    )
    return updated > 0
  }

  // Lease vencido devolve trabalho a `PENDING`: é isso que recupera evento cujo worker morreu depois
  // do claim (tasks.md 7.2). Chamado no boot e em cada drenagem.
  async reclaimExpiredLeases(now = new Date()): Promise<number> {
    const [reclaimed] = await this.model.update(
      { state: 'PENDING', lease_until: null, updated_at: now } as Partial<PluggyWebhookEventRow>,
      { where: { state: 'PROCESSING', lease_until: { [Op.lte]: now } }, ...this.transactionOptions() },
    )
    return reclaimed
  }

  async findByEventId(eventId: string): Promise<PluggyWebhookEvent | undefined> {
    const row = await this.model.findOne({ where: { event_id: eventId }, ...this.transactionOptions() })
    return row ? toEntity(row.get()) : undefined
  }

  async countPending(): Promise<number> {
    return this.model.count({ where: { state: 'PENDING' }, ...this.transactionOptions() })
  }

  // Transação vigente do escopo, nunca por parâmetro (arquitetura-camadas, regra 2.4).
  private transactionOptions(): { transaction?: NonNullable<ReturnType<GetTransaction>> } {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    return transaction ? { transaction } : {}
  }
}

export function toEntity(row: PluggyWebhookEventRow): PluggyWebhookEvent {
  return PluggyWebhookEvent.reconstitute({
    id: row.id,
    eventId: row.event_id,
    itemId: row.item_id,
    event: row.event,
    state: row.state,
    attempts: row.attempts,
    ...(row.error_summary !== null ? { errorSummary: row.error_summary } : {}),
  })
}
