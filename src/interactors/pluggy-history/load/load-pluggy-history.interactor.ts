import { ApplicationError } from '../../../shared/application-error.js'
import { ObservedHistoryScan } from '../../../entities/pluggy-history-coverage.js'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  CompletedScan,
  HistoryProductState,
  HistorySource,
  LoadPluggyHistoryGateway,
  LoadPluggyHistoryInput,
  LoadPluggyHistoryOutput,
} from './load-pluggy-history.types.js'

// Carga do histórico de caixa e custódia de um item (tasks.md seção 6). Uma dependência só, o gateway
// do próprio caso de uso (arquitetura-camadas, regra 2).
//
// O que é decisão de negócio e por isso mora aqui:
// - o portão do item: sem marca d'água nova, nenhuma chamada de transação acontece (D6, fronteira-pluggy 6);
// - os três estados de produto: sucesso, parcial utilizável, parcial limitado (D8);
// - elegibilidade por fonte: `updatedAt` do recurso contra a observação anterior, e "sem timestamp
//   varre inteiro" como fallback seguro;
// - o que conta como cobertura: só o que uma varredura CONCLUÍDA observou, contagem zero e datas
//   nulas incluídas (D5) — varredura interrompida não grava conclusão;
// - a marca d'água avança só depois de todas as fontes elegíveis terminarem.
export class LoadPluggyHistoryInteractor {
  private readonly gateway: LoadPluggyHistoryGateway

  constructor(params: AppContainer) {
    this.gateway = params.loadPluggyHistoryImpl
  }

  async execute(input: LoadPluggyHistoryInput): Promise<LoadPluggyHistoryOutput> {
    const { itemId } = input
    this.gateway.addContext({
      messageType: 'LOAD_PLUGGY_HISTORY',
      itemId,
      ...(input.origin === 'USER' ? { personId: input.personId } : {}),
    })

    try {
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
      if (item.lastUpdatedAt === undefined) {
        this.gateway.logError('Item sem lastUpdatedAt não permite decidir o portão')
        return { error: new ApplicationError('PLUGGY_ITEM_SUCCESS_WITHOUT_LAST_UPDATED_AT', { itemId }) }
      }

      const itemLastUpdatedAt = new Date(item.lastUpdatedAt)
      const watermark = await this.gateway.readLastSyncedHistoryWatermark(itemId)
      const firstLoad = watermark === undefined

      if (!firstLoad && itemLastUpdatedAt.getTime() <= watermark.getTime()) {
        this.gateway.logInfo('Portão de marca d’água fechado, nenhuma chamada de transação')
        return { data: emptyResult() }
      }

      const refused: string[] = []
      const sources: HistorySource[] = []

      // Caixa e custódia são recusados de forma independente: produto limitado por rate limit não
      // pode ser lido como "fonte vazia", e limitar um não impede o outro (D8).
      if (this.productUsable(item.cashProduct, 'caixa', refused)) {
        sources.push(...(await this.gateway.readCashSources(itemId)))
      }
      if (this.productUsable(item.custodyProduct, 'custódia', refused)) {
        sources.push(...(await this.gateway.readCustodySources(itemId)))
      }

      let sourcesScanned = 0
      let transactionsObserved = 0

      for (const source of sources) {
        const observation = await this.gateway.readSourceObservation(itemId, source)

        if (!firstLoad && !this.sourceChanged(source, observation.sourceUpdatedAt)) {
          continue
        }

        const scan = await this.scanUntilTheEnd(itemId, source)
        await this.gateway.saveCompletedScan(itemId, scan)

        sourcesScanned++
        transactionsObserved += scan.observedCount
      }

      // Só aqui, e só se nenhuma fonte elegível falhou (falha sai pelo catch, sem avançar nada).
      await this.gateway.advanceHistoryWatermark(itemId, itemLastUpdatedAt)

      this.gateway.logInfo('Carga de histórico concluída', { sourcesScanned, transactionsObserved })
      return {
        data: { loaded: true, sourcesScanned, transactionsObserved, sourcesRefused: refused },
      }
    } catch (err) {
      this.gateway.logError('Erro inesperado na carga de histórico', { err })
      if (err instanceof ApplicationError) {
        return { error: err }
      }
      return { error: new ApplicationError('PLUGGY_HISTORY_LOAD_FAILED', { itemId }) }
    }
  }

  // Varre a fonte inteira acumulando só o que foi observado. A conclusão (`CompletedScan`) existe
  // apenas depois da última página: interrupção no meio lança e nunca chega aqui, então a conclusão
  // anterior da fonte permanece intacta (D5).
  private async scanUntilTheEnd(itemId: string, source: HistorySource): Promise<CompletedScan> {
    let scan = ObservedHistoryScan.empty()

    for await (const page of this.gateway.scanSource(itemId, source)) {
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

  // Parcial utilizável segue; parcial limitado recusa aquela fonte nomeando o produto, sem derrubar o
  // item inteiro nem marcar conclusão (D8).
  private productUsable(product: HistoryProductState, nome: string, refused: string[]): boolean {
    if (product.limitedByRateLimit) {
      this.gateway.logWarn('Produto limitado por rate limit, fonte recusada', {
        produto: nome,
        warnings: product.warningCodes,
      })
      refused.push(nome)
      return false
    }
    return true
  }

  // Sem `updatedAt` do recurso, ou sem observação anterior, varre inteiro — fallback seguro, nunca
  // "presume que não mudou" (tasks.md 6.2).
  private sourceChanged(source: HistorySource, sourceUpdatedAt: Date | undefined): boolean {
    if (source.updatedAt === undefined || sourceUpdatedAt === undefined) {
      return true
    }
    return source.updatedAt.getTime() > sourceUpdatedAt.getTime()
  }
}

function emptyResult() {
  return { loaded: false, sourcesScanned: 0, transactionsObserved: 0, sourcesRefused: [] }
}
