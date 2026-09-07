import { ApplicationError } from '../../../shared/application-error.js'
import { ObservedHistoryScan } from '../../../entities/pluggy-history-coverage.js'
import { isEligible, isUsable, toVersionAt } from '../../../adapters/gateways/pluggy-source-state.js'
import type { PluggySource } from '../../../adapters/gateways/pluggy-source-catalog.js'
import type { LeaseGuard } from '../../../shared/lease-guard.js'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  CompletedScan,
  CurrentItemHistoryState,
  HistorySource,
  LoadPluggyHistoryGateway,
  LoadPluggyHistoryInput,
  LoadPluggyHistoryOutput,
} from './load-pluggy-history.types.js'

interface SourceEvaluation {
  eligible: boolean
  usable: boolean
  outdated: boolean
  versionAt: Date | undefined
}

interface GroupResult {
  sourcesScanned: number
  transactionsObserved: number
  refused: PluggySource[]
}

// Carga do histórico de caixa e custódia de um item (tasks.md seção 4). Uma dependência só, o gateway
// do próprio caso de uso (arquitetura-camadas, regra 2).
//
// O portão é por FONTE REAL (design.md D4), nunca por item nem por agrupamento de negócio: `CASH`
// (`ACCOUNTS`/`ACCOUNT_TRANSACTIONS`) e `CUSTODY` (`INVESTMENTS`/`INVESTMENT_TRANSACTIONS`) são só
// agrupamentos de elegibilidade — cada fonte tem sua própria marca d'água (`PluggySyncProgressRep`,
// `consumer = HISTORY_LOAD`), sob o gate de elegibilidade por `itemProducts` (D26) e a dependência de
// D13 (uma fonte de transação só é declarada processada quando ELA e sua fonte de descoberta estão
// utilizáveis na mesma execução).
export class LoadPluggyHistoryInteractor {
  private readonly gateway: LoadPluggyHistoryGateway

  constructor(params: AppContainer) {
    this.gateway = params.loadPluggyHistoryImpl
  }

  async execute(input: LoadPluggyHistoryInput): Promise<LoadPluggyHistoryOutput> {
    const { itemId, leaseGuard } = input
    this.gateway.addContext({
      messageType: 'LOAD_PLUGGY_HISTORY',
      itemId,
      ...(input.origin === 'USER' ? { personId: input.personId } : {}),
    })

    try {
      // Revisão do PR #14 (D16): lease já perdido ANTES de qualquer chamada, inclusive antes de
      // `readCurrentItemState` — que já é, por si só, uma chamada real à Pluggy (`fetchItem`, via
      // `PluggyItemStateResolver`). Sem isto, uma execução que já perdeu a posse ainda dispararia
      // essa chamada antes do primeiro ponto de checagem. Lança (propaga ao `catch` abaixo, que já
      // traduz `ApplicationError` em `{error}`) — mesmo mecanismo do resto do arquivo.
      this.ensureLeaseHeld(itemId, leaseGuard)

      if (input.origin === 'USER') {
        await this.gateway.assertItemAccess(itemId, input.personId)
      }

      const item = await this.gateway.readCurrentItemState(itemId)

      if (item.executionStatus !== 'SUCCESS' && item.executionStatus !== 'PARTIAL_SUCCESS') {
        this.gateway.logInfo('Item não está em estado que permite carga', {
          executionStatus: item.executionStatus,
        })
        return { data: emptyResult() }
      }

      const cash = await this.processGroup(
        itemId,
        item,
        'ACCOUNTS',
        'ACCOUNT_TRANSACTIONS',
        {
          discover: () => this.gateway.readCashSources(itemId, leaseGuard),
          // Commit atômico (revisão do PR #14/D21): reconciliação e avanço da marca d'água juntos,
          // protegidos pela mesma versão — nunca separados, para uma execução velha nunca regredir a
          // fotografia de contas.
          commitDiscovery: (ids, versionAt) => this.gateway.commitAccountsDiscovery(itemId, ids, versionAt),
        },
        leaseGuard,
      )
      const custody = await this.processGroup(
        itemId,
        item,
        'INVESTMENTS',
        'INVESTMENT_TRANSACTIONS',
        {
          discover: () => this.gateway.readCustodySources(itemId, leaseGuard),
          // Reconciliação de `radar_pluggy_positions` pertence só a `SyncPluggyPositionImpl` (que lê
          // `INVESTMENTS` sob o consumidor `POSITION_SYNC`) — a descoberta aqui é só instrumental,
          // para achar quais investimentos escanear em busca de transações de custódia (D4). Sem
          // fotografia própria pra reconciliar aqui, o avanço simples (`advanceSyncProgress`) já
          // basta — nada de destrutivo depende dele.
        },
        leaseGuard,
      )

      const sourcesScanned = cash.sourcesScanned + custody.sourcesScanned
      const transactionsObserved = cash.transactionsObserved + custody.transactionsObserved
      const refused = [...cash.refused, ...custody.refused]

      this.gateway.logInfo('Carga de histórico concluída', { sourcesScanned, transactionsObserved })
      return { data: { loaded: true, sourcesScanned, transactionsObserved, sourcesRefused: refused } }
    } catch (err) {
      this.gateway.logError('Erro inesperado na carga de histórico', { err })
      if (err instanceof ApplicationError) {
        return { error: err }
      }
      return { error: new ApplicationError('PLUGGY_HISTORY_LOAD_FAILED', { itemId }) }
    }
  }

  // Avalia se `source` está habilitada (D26), utilizável nesta execução (D6) e com marca d'água
  // desatualizada (D4) — nessa ordem: elegibilidade por `itemProducts` sempre primeiro.
  private async evaluateSource(itemId: string, item: CurrentItemHistoryState, source: PluggySource): Promise<SourceEvaluation> {
    if (!isEligible(item.itemProducts, source)) {
      return { eligible: false, usable: false, outdated: false, versionAt: undefined }
    }
    if (!isUsable(item, source)) {
      return { eligible: true, usable: false, outdated: false, versionAt: undefined }
    }

    const versionAt = toVersionAt(item, source, itemId)
    const watermark = await this.gateway.readSyncProgress(itemId, source)
    const outdated = versionAt !== undefined && (watermark === undefined || versionAt.getTime() > watermark.getTime())

    return { eligible: true, usable: true, outdated, versionAt }
  }

  // Um agrupamento (`CASH`/`CUSTODY`) é: descobre a fonte-base (contas/investimentos), reconcilia sua
  // fotografia quando ela mesma está desatualizada, e escaneia a fonte de transação correspondente —
  // só quando ELA e a fonte-base estão utilizáveis na mesma execução (D13). A descoberta só acontece
  // uma vez, reaproveitada pelos dois lados.
  private async processGroup(
    itemId: string,
    item: CurrentItemHistoryState,
    discoverySource: PluggySource,
    transactionSource: PluggySource,
    hooks: {
      discover: () => Promise<HistorySource[]>
      // Commit atômico (reconciliação + avanço de versão, juntos) — quando ausente (custódia), a
      // fonte de descoberta não tem fotografia própria a reconciliar, e o avanço simples basta.
      commitDiscovery?: (presentIds: string[], versionAt: Date) => Promise<boolean>
    },
    leaseGuard: LeaseGuard | undefined,
  ): Promise<GroupResult> {
    const discovery = await this.evaluateSource(itemId, item, discoverySource)
    const transactionRaw = await this.evaluateSource(itemId, item, transactionSource)
    // D13: a fonte de transação só é tratada como pronta para avançar quando a fonte-base também
    // está utilizável NESTA execução — sem a listagem atual, pode existir um recurso novo não
    // descoberto. A fonte-base nunca depende da dependente (avança sozinha).
    const transactionOutdated = transactionRaw.outdated && discovery.usable

    const refused: PluggySource[] = []
    if (discovery.eligible && !discovery.usable) refused.push(discoverySource)
    if (transactionRaw.eligible && !transactionRaw.usable) refused.push(transactionSource)

    if (!discovery.outdated && !transactionOutdated) {
      return { sourcesScanned: 0, transactionsObserved: 0, refused }
    }

    this.ensureLeaseHeld(itemId, leaseGuard)
    const sources = await hooks.discover()

    if (discovery.outdated && discovery.versionAt !== undefined) {
      this.ensureLeaseHeld(itemId, leaseGuard)
      if (hooks.commitDiscovery) {
        const committed = await hooks.commitDiscovery(sources.map((source) => source.referenceId), discovery.versionAt)
        if (!committed) {
          this.gateway.logInfo('Versão mais nova já aplicada por outra execução, fotografia de contas não regride', {
            itemId,
            source: discoverySource,
          })
        }
      } else {
        await this.gateway.advanceSyncProgress(itemId, discoverySource, discovery.versionAt)
      }
    }

    let sourcesScanned = 0
    let transactionsObserved = 0

    if (transactionOutdated && transactionRaw.versionAt !== undefined) {
      for (const source of sources) {
        const scan = await this.scanUntilTheEnd(itemId, source, leaseGuard)
        await this.gateway.saveCompletedScan(itemId, scan)
        sourcesScanned++
        transactionsObserved += scan.observedCount
      }
      await this.gateway.advanceSyncProgress(itemId, transactionSource, transactionRaw.versionAt)
    }

    return { sourcesScanned, transactionsObserved, refused }
  }

  // Varre a fonte inteira acumulando só o que foi observado. A conclusão (`CompletedScan`) existe
  // apenas depois da última página: interrupção no meio lança e nunca chega aqui, então a conclusão
  // anterior da fonte permanece intacta — perda de lease no meio da varredura também lança (nunca
  // devolve uma conclusão parcial disfarçada de completa).
  private async scanUntilTheEnd(itemId: string, source: HistorySource, leaseGuard: LeaseGuard | undefined): Promise<CompletedScan> {
    let scan = ObservedHistoryScan.empty()

    for await (const page of this.gateway.scanSource(itemId, source, leaseGuard)) {
      this.ensureLeaseHeld(itemId, leaseGuard)
      scan = scan.observe(page)
    }

    return {
      kind: source.kind,
      referenceId: source.referenceId,
      observedCount: scan.getCount(),
      oldestObservedAt: scan.getOldestAt(),
      newestObservedAt: scan.getNewestAt(),
      sourceUpdatedAt: source.updatedAt,
    }
  }

  // Invariante desta rodada: `renew() === false` no lease de ingestão que protege esta execução
  // (D16) recusa nova página, nova chamada e novo commit destrutivo — nunca aborta trabalho já em
  // voo, só impede o PRÓXIMO passo. Sem `leaseGuard` (chamador não detém lease), nunca recusa.
  private ensureLeaseHeld(itemId: string, leaseGuard: LeaseGuard | undefined): void {
    if (!leaseGuard?.isLost()) {
      return
    }
    this.gateway.logInfo('Lease de ingestão perdido, carga de histórico interrompida antes de novo passo', { itemId })
    throw new ApplicationError('PLUGGY_ITEM_INGESTION_LEASE_LOST', { itemId })
  }
}

function emptyResult() {
  return { loaded: false, sourcesScanned: 0, transactionsObserved: 0, sourcesRefused: [] }
}
