import { ApplicationError } from '../../../shared/application-error.js'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  ReadPluggyAccountStatementGateway,
  ReadPluggyAccountStatementInput,
  ReadPluggyAccountStatementOutput,
} from './read-pluggy-account-statement.types.js'

const BILL_MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/

// Extrato de cartão de uma conta, filtrado por fatura prevista (`GET
// /accounts/:accountId/transactions?billMonth=`) — leitura pura do que a sincronização já
// persistiu, nenhuma chamada à Pluggy aqui (fronteira-pluggy regra 6). Uma dependência só, o
// gateway do próprio caso de uso (arquitetura-camadas, regra 2).
export class ReadPluggyAccountStatementInteractor {
  private readonly gateway: ReadPluggyAccountStatementGateway

  constructor(params: AppContainer) {
    this.gateway = params.readPluggyAccountStatementImpl
  }

  async execute(input: ReadPluggyAccountStatementInput): Promise<ReadPluggyAccountStatementOutput> {
    const { personId, accountId, billMonth } = input
    this.gateway.addContext({ messageType: 'READ_PLUGGY_ACCOUNT_STATEMENT', personId, accountId, billMonth })

    if (!BILL_MONTH_FORMAT.test(billMonth)) {
      return { error: new ApplicationError('PLUGGY_ACCOUNT_STATEMENT_BILL_MONTH_INVALID', { billMonth }) }
    }

    try {
      // `accountId` vem da URL: nunca confiar nele sem provar que pertence à pessoa autenticada
      // (D7 — dono nunca por inferência). Nenhuma leitura de dado acontece antes desta linha.
      await this.gateway.assertAccountBelongsToPerson(accountId, personId)

      const bill = await this.gateway.readBillSummary(accountId)
      const transactions = await this.gateway.readTransactionsByBillMonth(accountId, billMonth)

      return { data: { bill, transactions } }
    } catch (err) {
      this.gateway.logError('Erro inesperado na leitura do extrato de cartão', { err })
      if (err instanceof ApplicationError) {
        return { error: err }
      }
      return { error: new ApplicationError('PLUGGY_ACCOUNT_STATEMENT_READ_FAILED', { accountId }) }
    }
  }
}
