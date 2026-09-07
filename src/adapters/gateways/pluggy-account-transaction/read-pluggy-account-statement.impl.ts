import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  PluggyCardBillSummaryView,
  PluggyCardTransactionView,
  ReadPluggyAccountStatementGateway,
} from '../../../interactors/pluggy-account-transaction/read/read-pluggy-account-statement.types.js'
import type { PluggyAccount } from '../../../entities/pluggy-account.js'
import type { PluggyAccountTransaction } from '../../../entities/pluggy-account-transaction.js'
import { ApplicationError } from '../../../shared/application-error.js'
import DefaultInteractorGatewayImpl from '../default-gateway.impl.js'
import type { PluggyItemCredentialResolver } from '../pluggy-item-credential.resolver.js'
import type { PluggyAccountRep } from '../../repositories/pluggy-account.rep.js'
import type { PluggyAccountTransactionRep } from '../../repositories/pluggy-account-transaction.rep.js'

// Gateway do caso de uso `read-pluggy-account-statement`. Compõe o repositório de conta, o de
// transação e o resolver item→credencial (para provar dono, D7). `findAccount` memoiza a conta por
// `accountId` na unidade de trabalho — a checagem de dono e a leitura da fatura leem a mesma linha,
// e o request só toca um `accountId` por vez.
export default class ReadPluggyAccountStatementImpl
  extends DefaultInteractorGatewayImpl
  implements ReadPluggyAccountStatementGateway
{
  private readonly pluggyAccountRep: PluggyAccountRep
  private readonly pluggyAccountTransactionRep: PluggyAccountTransactionRep
  private readonly pluggyItemCredentialResolver: PluggyItemCredentialResolver
  private cachedAccountId: string | undefined
  private cachedAccount: PluggyAccount | undefined

  constructor(params: AppContainer) {
    super(params)
    this.pluggyAccountRep = params.pluggyAccountRep
    this.pluggyAccountTransactionRep = params.pluggyAccountTransactionRep
    this.pluggyItemCredentialResolver = params.pluggyItemCredentialResolver
  }

  async assertAccountBelongsToPerson(accountId: string, personId: number): Promise<void> {
    const account = await this.findAccount(accountId)
    const credential = await this.pluggyItemCredentialResolver.findCredentialFor(account.getItemId())
    if (credential === undefined || credential.getPersonId() !== personId) {
      throw new ApplicationError('PLUGGY_ACCOUNT_UNAUTHORIZED', { accountId })
    }
  }

  async readBillSummary(accountId: string): Promise<PluggyCardBillSummaryView> {
    const account = await this.findAccount(accountId)
    return {
      availableCreditLimit: toDecimalString(account.getAvailableCreditLimit()),
      creditLimit: toDecimalString(account.getCreditLimit()),
      minimumPayment: toDecimalString(account.getMinimumPayment()),
      dueDate: toDateString(account.getBalanceDueDate()),
    }
  }

  async readTransactionsByBillMonth(accountId: string, billMonth: string): Promise<PluggyCardTransactionView[]> {
    const transactions = await this.pluggyAccountTransactionRep.findByAccountId(accountId)
    const views: PluggyCardTransactionView[] = []

    for (const transaction of transactions) {
      const view = toTransactionView(transaction)
      // Transação sem fatura atribuída (metadado de cartão ausente/ilegível) não pertence a
      // nenhum `billMonth` — excluída, nunca gravada como default (fronteira-pluggy regra 1).
      if (view !== undefined && view.billForecastMonth === billMonth) {
        views.push(view)
      }
    }

    return views
  }

  private async findAccount(accountId: string): Promise<PluggyAccount> {
    if (this.cachedAccountId === accountId && this.cachedAccount !== undefined) {
      return this.cachedAccount
    }

    const account = await this.pluggyAccountRep.findByAccountId(accountId)
    if (account === undefined) {
      throw new ApplicationError('PLUGGY_ACCOUNT_NOT_FOUND', { accountId })
    }

    this.cachedAccountId = accountId
    this.cachedAccount = account
    return account
  }
}

function toDecimalString(value: { toFixed: (n: number) => string } | undefined): string | null {
  return value === undefined ? null : value.toFixed(2)
}

function toDateString(value: Date | undefined): string | null {
  return value === undefined ? null : value.toISOString()
}

function extractString(record: Record<string, unknown> | undefined, field: string): string | undefined {
  const value = record?.[field]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function extractNumber(record: Record<string, unknown> | undefined, field: string): number | undefined {
  const value = record?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toTransactionView(transaction: PluggyAccountTransaction): PluggyCardTransactionView | undefined {
  const metadata = transaction.getCreditCardMetadata()
  const billForecastMonth = extractString(metadata, 'billForecastDate')
  if (billForecastMonth === undefined) {
    return undefined
  }

  const installmentNumber = extractNumber(metadata, 'installmentNumber')
  const totalInstallments = extractNumber(metadata, 'totalInstallments')

  return {
    transactionId: transaction.getTransactionId(),
    description: transaction.getDescription(),
    amount: transaction.getAmount().toFixed(2),
    date: transaction.getDate().toISOString(),
    category: transaction.getCategory() ?? null,
    merchantName: extractString(transaction.getMerchant(), 'name') ?? null,
    billForecastMonth,
    installment:
      installmentNumber !== undefined && totalInstallments !== undefined
        ? { number: installmentNumber, total: totalInstallments }
        : null,
  }
}
