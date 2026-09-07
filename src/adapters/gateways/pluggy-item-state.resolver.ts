import type { AppContainer, GetTransaction, SetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES, type DB } from '../../infra/db/models.js'
import type { PluggyItemCredentialResolver } from './pluggy-item-credential.resolver.js'
import type { PluggyItemsGateway, PluggyItemSnapshot } from './pluggy-items.gateway.js'
import type { PluggyItemObservationRep } from '../repositories/pluggy-item-observation.rep.js'
import type { PluggyCredentialItemRep } from '../repositories/pluggy-credential-item.rep.js'

// Elimina a terceira leitura do Item por cache de escopo — não por acoplar os dois interactors
// (design.md D9): `SyncPluggyPositionImpl`/`LoadPluggyHistoryImpl` chamam `read(itemId)` sem saber um
// do outro; a primeira chamada no escopo busca e tenta persistir a observação, qualquer chamada
// seguinte devolve o mesmo snapshot sem nova rede.
//
// Usado só por consumidores que já assumem o vínculo credencial↔item existente. A leitura de
// validação pré-vínculo (`RegisterPluggyCredentialImpl.validateItemAccess`) usa um `freshClient`
// próprio, fora deste resolver — nunca escreve em `radar_pluggy_item_observations` (D9).
export class PluggyItemStateResolver {
  private readonly db: DB
  private readonly getTransaction: GetTransaction
  private readonly setTransaction: SetTransaction
  private readonly pluggyItemCredentialResolver: PluggyItemCredentialResolver
  private readonly pluggyItemsGateway: PluggyItemsGateway
  private readonly pluggyItemObservationRep: PluggyItemObservationRep
  private readonly pluggyCredentialItemRep: PluggyCredentialItemRep
  private readonly cache = new Map<string, Promise<PluggyItemSnapshot>>()

  constructor(params: AppContainer) {
    this.db = params.db
    this.getTransaction = params.getTransaction
    this.setTransaction = params.setTransaction
    this.pluggyItemCredentialResolver = params.pluggyItemCredentialResolver
    this.pluggyItemsGateway = params.pluggyItemsGateway
    this.pluggyItemObservationRep = params.pluggyItemObservationRep
    this.pluggyCredentialItemRep = params.pluggyCredentialItemRep
  }

  read(itemId: string): Promise<PluggyItemSnapshot> {
    const cached = this.cache.get(itemId)
    if (cached) {
      return cached
    }

    const promise = this.fetchAndTryAccept(itemId)
    this.cache.set(itemId, promise)
    return promise
  }

  private async fetchAndTryAccept(itemId: string): Promise<PluggyItemSnapshot> {
    // Capturado ANTES do `fetchItem` — nunca depois (design.md D9.1): é o que resolve a corrida de
    // duas leituras concorrentes terminando fora de ordem.
    const observationStartedAt = new Date()
    const client = await this.pluggyItemCredentialResolver.clientFor(itemId)
    const snapshot = await this.pluggyItemsGateway.fetchItem(itemId, client)

    await this.tryAcceptObservation(itemId, snapshot, observationStartedAt)

    return snapshot
  }

  // Uma única transação: aceitar a observação e atualizar o connector do vínculo são a mesma decisão
  // atômica (design.md D18) — a segunda escrita só roda se a primeira aceitou.
  private async tryAcceptObservation(itemId: string, snapshot: PluggyItemSnapshot, observationStartedAt: Date): Promise<void> {
    const connection = this.db.connections[DB_NAMES.MAIN]
    if (!connection) {
      throw new Error(`conexão "${DB_NAMES.MAIN}" não registrada em db.connections`)
    }

    const transaction = await connection.transaction({
      isolationLevel: this.db.Sequelize.Transaction.ISOLATION_LEVELS.READ_COMMITTED,
    })
    this.setTransaction(DB_NAMES.MAIN, transaction)

    try {
      const accepted = await this.pluggyItemObservationRep.tryAccept({
        itemId,
        status: snapshot.status,
        executionStatus: snapshot.executionStatus,
        statusDetail: Object.keys(snapshot.products).length > 0 ? snapshot.products : undefined,
        itemProducts: snapshot.itemProducts,
        lastUpdatedAt: snapshot.lastUpdatedAt !== undefined ? new Date(snapshot.lastUpdatedAt) : undefined,
        nextAutoSyncAt: snapshot.nextAutoSyncAt !== undefined ? new Date(snapshot.nextAutoSyncAt) : undefined,
        connectorId: snapshot.connector?.connectorId,
        observationStartedAt,
      })

      if (accepted && snapshot.connector !== undefined) {
        await this.pluggyCredentialItemRep.saveConnector(itemId, snapshot.connector)
      }

      await transaction.commit()
    } catch (err) {
      await transaction.rollback()
      throw err
    } finally {
      this.setTransaction(DB_NAMES.MAIN, null)
    }
  }
}
