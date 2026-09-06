import type { Transaction } from 'sequelize'
import { DB_NAMES, type DB } from '../../infra/db/models.js'
import type { AppContainer, GetTransaction, SetTransaction } from '../../infra/bootstrap/register.js'
import type { DefaultInteractorGateway } from '../../interactors/default/default-interactor.types.js'
import type { Logger } from '../../infra/tools/log/logger.js'

// Base de todo gateway de caso de uso — mesma classe do `oplab-radar-api`
// (`adapters/gateways/default-gateway.impl.ts`). Duas responsabilidades, as duas do lado de fora do
// interactor:
//
// 1. Ciclo de transação. `startProcess` abre a transação e a publica no escopo do container
//    (`setTransaction`); os repositórios a leem de lá (`getTransaction`), nunca por parâmetro. Por
//    isso o interactor não recebe nem repassa `tx`: atomicidade é decisão do impl.
// 2. Log. O interactor loga através do gateway (`DefaultGateway`), sem conhecer o logger.
export default class DefaultInteractorGatewayImpl implements DefaultInteractorGateway {
  protected db: DB
  protected mainTransaction: Transaction | null
  protected getTransaction: GetTransaction
  protected setTransaction: SetTransaction
  protected logger: Logger

  constructor(params: AppContainer) {
    this.db = params.db
    this.mainTransaction = null
    this.getTransaction = params.getTransaction
    this.setTransaction = params.setTransaction
    this.logger = params.logger
  }

  async startProcess(): Promise<void> {
    const main = this.db.connections[DB_NAMES.MAIN]
    if (!main) {
      throw new Error(`conexão "${DB_NAMES.MAIN}" não registrada em db.connections`)
    }

    this.mainTransaction = await main.transaction({
      isolationLevel: this.db.Sequelize.Transaction.ISOLATION_LEVELS.READ_COMMITTED,
    })

    this.setTransaction(DB_NAMES.MAIN, this.mainTransaction)
  }

  async terminateProcess(): Promise<void> {
    if (this.mainTransaction) {
      await this.mainTransaction.commit()
    }

    this.mainTransaction = null
    this.setTransaction(DB_NAMES.MAIN, null)
  }

  async cancelProcess(): Promise<void> {
    if (this.mainTransaction) {
      await this.mainTransaction.rollback()
    }

    this.mainTransaction = null
    this.setTransaction(DB_NAMES.MAIN, null)
  }

  async storeProcess(): Promise<void> {
    await this.terminateProcess()
    await this.startProcess()
  }

  logInfo(message: string, extra?: unknown): void {
    this.logger.info(message, extra)
  }

  logWarn(message: string, extra?: unknown): void {
    this.logger.warn(message, extra)
  }

  logError(message: string, extra?: unknown): void {
    this.logger.error(message, extra)
  }

  addContext(context: Record<string, unknown>): void {
    this.logger.addContext(context)
  }
}
