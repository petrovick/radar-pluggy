import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  CompletedScan,
  CurrentItemHistoryState,
  HistoryProductState,
  HistorySource,
  LoadPluggyHistoryGateway,
  PersistedPage,
  SourceObservation,
} from '../../../interactors/pluggy-history/load/load-pluggy-history.types.js'
import { ApplicationError } from '../../../shared/application-error.js'
import DefaultInteractorGatewayImpl from '../default-gateway.impl.js'
import type { PluggyAccountsGateway } from '../pluggy-accounts.gateway.js'
import type { PluggyAccountTransactionsGateway } from '../pluggy-account-transactions.gateway.js'
import type { PluggyInvestmentsGateway } from '../pluggy-investments.gateway.js'
import type { PluggyInvestmentTransactionsGateway } from '../pluggy-investment-transactions.gateway.js'
import type { PluggyItemsGateway, PluggyProductStatus } from '../pluggy-items.gateway.js'
import type { PluggyItemCredentialResolver } from '../pluggy-item-credential.resolver.js'
import type { PluggyAccountRep } from '../../repositories/pluggy-account.rep.js'
import type { PluggyAccountTransactionRep } from '../../repositories/pluggy-account-transaction.rep.js'
import type { PluggyHistoryCoverageRep } from '../../repositories/pluggy-history-coverage.rep.js'
import type { PluggyHistorySyncStateRep } from '../../repositories/pluggy-history-sync-state.rep.js'
import type { PluggyInvestmentTransactionRep } from '../../repositories/pluggy-investment-transaction.rep.js'

// Códigos de aviso da Pluggy que significam "não consegui coletar este produto porque o limite de
// coletas do plano estourou". Traduzidos aqui, na borda, para o estado de domínio
// `limitedByRateLimit` — o caso de uso decide o que fazer, sem conhecer código de fornecedor (D8).
const RATE_LIMIT_WARNING_CODES = ['RATE_LIMIT', 'RATE_LIMIT_EXCEEDED', 'PRODUCT_RATE_LIMIT_EXCEEDED']

// Gateway do caso de uso `load-pluggy-history`. Tudo que é mecanismo vive aqui: credencial, api key,
// paginação por página e por cursor, transação e a tradução de aviso da Pluggy para estado de
// domínio. Cada página é persistida ANTES de ser devolvida ao caso de uso (tasks.md 6.1).
export default class LoadPluggyHistoryImpl
  extends DefaultInteractorGatewayImpl
  implements LoadPluggyHistoryGateway
{
  private readonly pluggyItemCredentialResolver: PluggyItemCredentialResolver
  private readonly pluggyItemsGateway: PluggyItemsGateway
  private readonly pluggyAccountsGateway: PluggyAccountsGateway
  private readonly pluggyAccountTransactionsGateway: PluggyAccountTransactionsGateway
  private readonly pluggyInvestmentsGateway: PluggyInvestmentsGateway
  private readonly pluggyInvestmentTransactionsGateway: PluggyInvestmentTransactionsGateway
  private readonly pluggyAccountRep: PluggyAccountRep
  private readonly pluggyAccountTransactionRep: PluggyAccountTransactionRep
  private readonly pluggyInvestmentTransactionRep: PluggyInvestmentTransactionRep
  private readonly pluggyHistoryCoverageRep: PluggyHistoryCoverageRep
  private readonly pluggyHistorySyncStateRep: PluggyHistorySyncStateRep

  constructor(params: AppContainer) {
    super(params)
    this.pluggyItemCredentialResolver = params.pluggyItemCredentialResolver
    this.pluggyItemsGateway = params.pluggyItemsGateway
    this.pluggyAccountsGateway = params.pluggyAccountsGateway
    this.pluggyAccountTransactionsGateway = params.pluggyAccountTransactionsGateway
    this.pluggyInvestmentsGateway = params.pluggyInvestmentsGateway
    this.pluggyInvestmentTransactionsGateway = params.pluggyInvestmentTransactionsGateway
    this.pluggyAccountRep = params.pluggyAccountRep
    this.pluggyAccountTransactionRep = params.pluggyAccountTransactionRep
    this.pluggyInvestmentTransactionRep = params.pluggyInvestmentTransactionRep
    this.pluggyHistoryCoverageRep = params.pluggyHistoryCoverageRep
    this.pluggyHistorySyncStateRep = params.pluggyHistorySyncStateRep
  }

  async readCurrentItemState(itemId: string): Promise<CurrentItemHistoryState> {
    const client = await this.pluggyItemCredentialResolver.clientFor(itemId)
    const item = await this.pluggyItemsGateway.fetchItem(itemId, client)

    // Caixa depende de `accounts` + `transactions`; custódia, de `investments` +
    // `investmentsTransactions`. Limite em qualquer metade limita aquela fonte.
    return {
      executionStatus: item.executionStatus,
      lastUpdatedAt: item.lastUpdatedAt,
      cashProduct: toProductState([item.products.accounts, item.products.transactions]),
      custodyProduct: toProductState([item.products.investments, item.products.investmentsTransactions]),
    }
  }

  async readLastSyncedHistoryWatermark(itemId: string): Promise<Date | undefined> {
    const state = await this.pluggyHistorySyncStateRep.findByItemId(itemId)
    return state?.getLastCompletedItemUpdatedAt()
  }

  // Descobre e registra as contas de depósito percorrendo a paginação inteira, persistindo cada
  // página na hora. Cartão de crédito é ignorado sem recusar o item (spec pluggy-account).
  async readCashSources(itemId: string): Promise<HistorySource[]> {
    const client = await this.pluggyItemCredentialResolver.clientFor(itemId)
    const sources: HistorySource[] = []

    for await (const page of this.pluggyAccountsGateway.fetchAccountPages(itemId, client)) {
      for (const account of page.results) {
        if (account.type !== 'BANK') {
          continue
        }
        await this.pluggyAccountRep.save(account)
        sources.push({ kind: 'ACCOUNT', referenceId: account.accountId, updatedAt: account.providerUpdatedAt })
      }
    }

    return sources
  }

  // `updatedAt` vem do próprio investimento (campo opcional do schema `Investment` da Pluggy) e é o
  // que permite o portão incremental de custódia funcionar: sem ele, toda carga varria a custódia
  // inteira de novo, contra o que a spec pluggy-transaction-history exige. Ausente continua
  // `undefined`, o que mantém o fallback de varredura integral.
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

  async readSourceObservation(itemId: string, source: HistorySource): Promise<SourceObservation> {
    const coverage = await this.pluggyHistoryCoverageRep.findByReference(itemId, source.kind, source.referenceId)
    return { sourceUpdatedAt: coverage?.getSourceUpdatedAt() }
  }

  // Uma página persistida por iteração. O caso de uso acumula a observação e só grava a conclusão
  // depois da última — falha no meio interrompe o gerador e a conclusão anterior fica intacta (D5).
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

        await this.pluggyAccountTransactionRep.saveMany(
          page.results.map((transaction) => ({ ...transaction, itemId })),
        )
        yield summarize(page.results.map((transaction) => transaction.date))
      }
      return
    }

    for await (const page of this.pluggyInvestmentTransactionsGateway.fetchTransactionPages(
      source.referenceId,
      client,
    )) {
      await this.pluggyInvestmentTransactionRep.saveMany(
        page.results.map((transaction) => ({ ...transaction, itemId, investmentId: source.referenceId })),
      )
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

  async advanceHistoryWatermark(itemId: string, itemLastUpdatedAt: Date): Promise<void> {
    await this.pluggyHistorySyncStateRep.save({ itemId, lastCompletedItemUpdatedAt: itemLastUpdatedAt })
  }

  async assertItemAccess(itemId: string, personId: number): Promise<void> {
    const credential = await this.pluggyItemCredentialResolver.findCredentialFor(itemId)
    if (!credential || credential.getPersonId() !== personId) {
      throw new ApplicationError('PLUGGY_ITEM_UNAUTHORIZED', { itemId })
    }
  }
}

function toProductState(products: (PluggyProductStatus | undefined)[]): HistoryProductState {
  const warningCodes = products.flatMap((product) => product?.warnings.map((warning) => warning.code) ?? [])
  return {
    limitedByRateLimit: warningCodes.some((code) => RATE_LIMIT_WARNING_CODES.includes(code)),
    warningCodes,
  }
}

function summarize(dates: Date[]): PersistedPage {
  return {
    count: dates.length,
    oldestAt: dates.reduce<Date | undefined>((min, d) => (!min || d < min ? d : min), undefined),
    newestAt: dates.reduce<Date | undefined>((max, d) => (!max || d > max ? d : max), undefined),
  }
}
