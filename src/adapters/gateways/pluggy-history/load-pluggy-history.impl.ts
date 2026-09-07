import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  CompletedScan,
  CurrentItemHistoryState,
  HistorySource,
  LoadPluggyHistoryGateway,
  PersistedPage,
} from '../../../interactors/pluggy-history/load/load-pluggy-history.types.js'
import { ApplicationError } from '../../../shared/application-error.js'
import DefaultInteractorGatewayImpl from '../default-gateway.impl.js'
import type { PluggyAccountsGateway } from '../pluggy-accounts.gateway.js'
import type { PluggyAccountTransactionsGateway } from '../pluggy-account-transactions.gateway.js'
import type { PluggyInvestmentsGateway } from '../pluggy-investments.gateway.js'
import type { PluggyInvestmentTransactionsGateway } from '../pluggy-investment-transactions.gateway.js'
import type { PluggyItemStateResolver } from '../pluggy-item-state.resolver.js'
import type { PluggyItemCredentialResolver } from '../pluggy-item-credential.resolver.js'
import type { PluggySource } from '../pluggy-source-catalog.js'
import type { PluggyAccountRep } from '../../repositories/pluggy-account.rep.js'
import type { PluggyAccountTransactionRep } from '../../repositories/pluggy-account-transaction.rep.js'
import type { PluggyHistoryCoverageRep } from '../../repositories/pluggy-history-coverage.rep.js'
import type { PluggySyncProgressRep } from '../../repositories/pluggy-sync-progress.rep.js'
import type { PluggyInvestmentTransactionRep } from '../../repositories/pluggy-investment-transaction.rep.js'
import type { PluggyAccountRawRep } from '../../repositories/pluggy-account-raw.rep.js'
import type { PluggyAccountTransactionRawRep } from '../../repositories/pluggy-account-transaction-raw.rep.js'
import type { PluggyInvestmentTransactionRawRep } from '../../repositories/pluggy-investment-transaction-raw.rep.js'

// Gateway do caso de uso `load-pluggy-history`. Tudo que é mecanismo vive aqui: credencial, api key,
// paginação por página e por cursor, transação. Cada página é persistida ANTES de ser devolvida ao
// caso de uso (tasks.md 6.1). A decisão de negócio (elegibilidade por fonte, D4/D6/D13/D26) mora só
// no interactor — este impl só traduz para o vocabulário de `PluggySyncProgressRep` (consumer fixo
// `HISTORY_LOAD`) e para os gateways de borda.
export default class LoadPluggyHistoryImpl extends DefaultInteractorGatewayImpl implements LoadPluggyHistoryGateway {
  private readonly pluggyItemCredentialResolver: PluggyItemCredentialResolver
  private readonly pluggyItemStateResolver: PluggyItemStateResolver
  private readonly pluggyAccountsGateway: PluggyAccountsGateway
  private readonly pluggyAccountTransactionsGateway: PluggyAccountTransactionsGateway
  private readonly pluggyInvestmentsGateway: PluggyInvestmentsGateway
  private readonly pluggyInvestmentTransactionsGateway: PluggyInvestmentTransactionsGateway
  private readonly pluggyAccountRep: PluggyAccountRep
  private readonly pluggyAccountTransactionRep: PluggyAccountTransactionRep
  private readonly pluggyInvestmentTransactionRep: PluggyInvestmentTransactionRep
  private readonly pluggyHistoryCoverageRep: PluggyHistoryCoverageRep
  private readonly pluggySyncProgressRep: PluggySyncProgressRep
  private readonly pluggyAccountRawRep: PluggyAccountRawRep
  private readonly pluggyAccountTransactionRawRep: PluggyAccountTransactionRawRep
  private readonly pluggyInvestmentTransactionRawRep: PluggyInvestmentTransactionRawRep

  constructor(params: AppContainer) {
    super(params)
    this.pluggyItemCredentialResolver = params.pluggyItemCredentialResolver
    this.pluggyItemStateResolver = params.pluggyItemStateResolver
    this.pluggyAccountsGateway = params.pluggyAccountsGateway
    this.pluggyAccountTransactionsGateway = params.pluggyAccountTransactionsGateway
    this.pluggyInvestmentsGateway = params.pluggyInvestmentsGateway
    this.pluggyInvestmentTransactionsGateway = params.pluggyInvestmentTransactionsGateway
    this.pluggyAccountRep = params.pluggyAccountRep
    this.pluggyAccountTransactionRep = params.pluggyAccountTransactionRep
    this.pluggyInvestmentTransactionRep = params.pluggyInvestmentTransactionRep
    this.pluggyHistoryCoverageRep = params.pluggyHistoryCoverageRep
    this.pluggySyncProgressRep = params.pluggySyncProgressRep
    this.pluggyAccountRawRep = params.pluggyAccountRawRep
    this.pluggyAccountTransactionRawRep = params.pluggyAccountTransactionRawRep
    this.pluggyInvestmentTransactionRawRep = params.pluggyInvestmentTransactionRawRep
  }

  async readCurrentItemState(itemId: string): Promise<CurrentItemHistoryState> {
    const item = await this.pluggyItemStateResolver.read(itemId)

    return {
      executionStatus: item.executionStatus,
      lastUpdatedAt: item.lastUpdatedAt,
      updatedAt: item.updatedAt,
      itemProducts: item.itemProducts,
      products: item.products,
    }
  }

  readSyncProgress(itemId: string, source: PluggySource): Promise<Date | undefined> {
    return this.pluggySyncProgressRep.read(itemId, 'HISTORY_LOAD', source)
  }

  advanceSyncProgress(itemId: string, source: PluggySource, versionAt: Date): Promise<void> {
    return this.pluggySyncProgressRep.advance(itemId, 'HISTORY_LOAD', source, versionAt)
  }

  // Descobre e registra as contas de depósito e de cartão de crédito percorrendo a paginação
  // inteira, persistindo cada página na hora (change pluggy-complete-data-capture, spec
  // pluggy-account: `CREDIT` deixou de ser ignorado — a fatura já é capturada pelo gateway de
  // contas, só faltava não descartar a conta antes de registrá-la).
  async readCashSources(itemId: string): Promise<HistorySource[]> {
    const client = await this.pluggyItemCredentialResolver.clientFor(itemId)
    const sources: HistorySource[] = []

    for await (const page of this.pluggyAccountsGateway.fetchAccountPages(itemId, client)) {
      for (const account of page.results) {
        if (account.type !== 'BANK' && account.type !== 'CREDIT') {
          continue
        }
        // Log bruto inserido junto do registro principal, na mesma transação (change
        // pluggy-complete-data-capture, spec pluggy-raw-payload-audit).
        await this.startProcess()
        try {
          await this.pluggyAccountRep.save(account)
          await this.pluggyAccountRawRep.save({
            itemId,
            accountId: account.accountId,
            rawPayload: account.raw,
            capturedAt: new Date(),
          })
          await this.terminateProcess()
        } catch (err) {
          await this.cancelProcess()
          throw err
        }
        sources.push({ kind: 'ACCOUNT', referenceId: account.accountId, updatedAt: account.providerUpdatedAt })
      }
    }

    return sources
  }

  async readCustodySources(itemId: string): Promise<HistorySource[]> {
    const client = await this.pluggyItemCredentialResolver.clientFor(itemId)
    const sources: HistorySource[] = []

    for await (const page of this.pluggyInvestmentsGateway.fetchInvestmentPages(itemId, client)) {
      for (const investment of page.results) {
        sources.push({
          kind: 'INVESTMENT',
          referenceId: investment.investmentId,
          updatedAt: investment.updatedAt,
        })
      }
    }

    return sources
  }

  // Leitura autoritativa de contas reconcilia a fotografia atual (design.md D21) — todo registro
  // local daquele Item cujo `accountId` não veio na leitura atual deixa de pertencer à fotografia.
  async reconcileAccounts(itemId: string, presentAccountIds: string[]): Promise<void> {
    await this.startProcess()
    try {
      await this.pluggyAccountRep.reconcile(itemId, presentAccountIds)
      await this.terminateProcess()
    } catch (err) {
      await this.cancelProcess()
      throw err
    }
  }

  // Uma página persistida por iteração. O caso de uso acumula a observação e só grava a conclusão
  // depois da última — falha no meio interrompe o gerador e a conclusão anterior fica intacta.
  async *scanSource(itemId: string, source: HistorySource): AsyncGenerator<PersistedPage> {
    const client = await this.pluggyItemCredentialResolver.clientFor(itemId)

    if (source.kind === 'ACCOUNT') {
      for await (const page of this.pluggyAccountTransactionsGateway.fetchTransactionPages(
        source.referenceId,
        client,
      )) {
        for (const transaction of page.results) {
          // A Pluggy devolve `accountId` em cada lançamento: divergir da conta consultada é resposta
          // trocada, recusa nomeada em vez de gravar lançamento na conta errada (tasks.md 6.2).
          if (transaction.accountId !== source.referenceId) {
            throw new ApplicationError('PLUGGY_TRANSACTION_ACCOUNT_MISMATCH', {
              itemId,
              expectedAccountId: source.referenceId,
              receivedAccountId: transaction.accountId,
            })
          }
        }

        // Log bruto inserido junto do registro principal, na mesma transação, por transação (change
        // pluggy-complete-data-capture, spec pluggy-raw-payload-audit) — não muda a semântica
        // existente de "cada página persistida antes do yield", só garante que a linha principal e
        // sua bruta nascem ou morrem juntas.
        for (const transaction of page.results) {
          await this.startProcess()
          try {
            await this.pluggyAccountTransactionRep.save({ ...transaction, itemId })
            await this.pluggyAccountTransactionRawRep.save({
              itemId,
              accountId: transaction.accountId,
              transactionId: transaction.transactionId,
              rawPayload: transaction.raw,
              capturedAt: new Date(),
            })
            await this.terminateProcess()
          } catch (err) {
            await this.cancelProcess()
            throw err
          }
        }
        yield summarize(page.results.map((transaction) => transaction.date))
      }
      return
    }

    for await (const page of this.pluggyInvestmentTransactionsGateway.fetchTransactionPages(
      source.referenceId,
      client,
    )) {
      for (const transaction of page.results) {
        await this.startProcess()
        try {
          await this.pluggyInvestmentTransactionRep.save({
            ...transaction,
            itemId,
            investmentId: source.referenceId,
          })
          await this.pluggyInvestmentTransactionRawRep.save({
            itemId,
            investmentId: source.referenceId,
            transactionId: transaction.transactionId,
            rawPayload: transaction.raw,
            capturedAt: new Date(),
          })
          await this.terminateProcess()
        } catch (err) {
          await this.cancelProcess()
          throw err
        }
      }
      yield summarize(page.results.map((transaction) => transaction.date))
    }
  }

  async saveCompletedScan(itemId: string, scan: CompletedScan): Promise<void> {
    await this.pluggyHistoryCoverageRep.save({
      itemId,
      referenceType: scan.kind,
      referenceId: scan.referenceId,
      observedTransactionCount: scan.observedCount,
      oldestObservedTransactionAt: scan.oldestObservedAt,
      newestObservedTransactionAt: scan.newestObservedAt,
      sourceUpdatedAt: scan.sourceUpdatedAt,
      lastCompletedScanAt: new Date(),
    })
  }

  async assertItemAccess(itemId: string, personId: number): Promise<void> {
    const credential = await this.pluggyItemCredentialResolver.findCredentialFor(itemId)
    if (!credential || credential.getPersonId() !== personId) {
      throw new ApplicationError('PLUGGY_ITEM_UNAUTHORIZED', { itemId })
    }
  }
}

function summarize(dates: Date[]): PersistedPage {
  return {
    count: dates.length,
    oldestAt: dates.reduce<Date | undefined>((min, d) => (!min || d < min ? d : min), undefined),
    newestAt: dates.reduce<Date | undefined>((max, d) => (!max || d > max ? d : max), undefined),
  }
}
