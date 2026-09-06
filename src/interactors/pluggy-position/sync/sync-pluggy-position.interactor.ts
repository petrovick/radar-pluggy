import { ApplicationError } from '../../../shared/application-error.js'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  LastSyncedItemState,
  SyncPluggyPositionGateway,
  SyncPluggyPositionInput,
  SyncPluggyPositionOutput,
} from './sync-pluggy-position.types.js'

// Orquestra a sincronização da posição financeira de um item (design.md, sincronizacao-posicao-pluggy):
// lê o estado atual do item, aplica o portão de marca d’água (D1 — só no nível do item,
// fronteira-pluggy regra 6) e, se abrir, percorre todas as páginas de investimentos (ativo) e de
// empréstimos (passivo) e manda persistir. Mesmo item, mesmo consentimento, mesma chamada de
// `fetchItem` para os dois produtos — uma segunda leitura do item custaria cota à toa.
//
// Uma única dependência, o gateway do próprio caso de uso (arquitetura-camadas, regra 2). O caso de
// uso não conhece repositório, model, Sequelize nem transação: atomicidade de cada fotografia com o
// seu snapshot histórico (D11) é decisão interna de `savePositionsWithSnapshots`/`saveLoansWithSnapshots`.
export class SyncPluggyPositionInteractor {
  private readonly gateway: SyncPluggyPositionGateway

  constructor(params: AppContainer) {
    this.gateway = params.syncPluggyPositionImpl
  }

  async execute(input: SyncPluggyPositionInput): Promise<SyncPluggyPositionOutput> {
    const { itemId } = input
    this.gateway.addContext({ messageType: 'SYNC_PLUGGY_POSITION', itemId })

    try {
      const freshItem = await this.gateway.readCurrentItemState(itemId)
      if (freshItem.executionStatus !== 'SUCCESS') {
        this.gateway.logInfo('Item não está em SUCCESS, sincronização não ocorre', {
          executionStatus: freshItem.executionStatus,
        })
        return { data: { synced: false, positionsSynced: 0, loansSynced: 0 } }
      }
      if (freshItem.lastUpdatedAt === undefined) {
        // SUCCESS sem lastUpdatedAt não é "sem mudança" — é a Pluggy documentar o campo como presente
        // quando a sincronização termina, e ele não vir. Recusa nomeada em vez de portão fechado em
        // silêncio (achado do engenheiro-pluggy-connector).
        this.gateway.logError('Item em SUCCESS sem lastUpdatedAt')
        return { error: new ApplicationError('PLUGGY_ITEM_SUCCESS_WITHOUT_LAST_UPDATED_AT', { itemId }) }
      }

      const storedItem = await this.gateway.readLastSyncedItemState(itemId)
      if (!this.gateOpen(freshItem.lastUpdatedAt, storedItem)) {
        this.gateway.logInfo('Portão de marca d’água fechado, nenhuma chamada de investimentos nem de empréstimos')
        return { data: { synced: false, positionsSynced: 0, loansSynced: 0 } }
      }

      const freshLastUpdatedAt = new Date(freshItem.lastUpdatedAt)

      const consentStatus = await this.gateway.readConsentStatus(itemId)
      await this.gateway.saveConsentStatus(itemId, consentStatus)
      if (consentStatus.kind !== 'ACTIVE') {
        this.gateway.logInfo('Consentimento não está ativo, sincronização não ocorre', { kind: consentStatus.kind })
        return {
          error: new ApplicationError(
            consentStatus.kind === 'NOT_FOUND'
              ? 'PLUGGY_CONSENT_NOT_FOUND'
              : consentStatus.kind === 'EXPIRED'
                ? 'PLUGGY_CONSENT_EXPIRED'
                : 'PLUGGY_CONSENT_REVOKED',
            { itemId },
          ),
        }
      }

      const investmentsResult = await this.readAllPages(
        (page) => this.gateway.readInvestmentsPage(itemId, page),
        { pageMismatch: 'PLUGGY_INVESTMENTS_PAGE_MISMATCH', totalPagesChanged: 'PLUGGY_INVESTMENTS_TOTAL_PAGES_CHANGED' },
        itemId,
      )
      if ('error' in investmentsResult) {
        return { error: investmentsResult.error }
      }
      const allInvestments = investmentsResult.items

      if (allInvestments.length === 0) {
        // Portão aberto mas lista vazia: consentimento revogado/expirado devolve vazio, nunca zero
        // posições (D4, fronteira-pluggy regra 3).
        this.gateway.logError('Lista de investimentos vazia com portão aberto')
        return { error: new ApplicationError('PLUGGY_INVESTMENTS_EMPTY_WITH_SUCCESS_STATUS', { itemId }) }
      }

      // Lado passivo (empréstimo), mesmo portão e mesmo consentimento já confirmados acima — mesma
      // disciplina de varredura completa antes de persistir qualquer coisa (nem investimento, nem
      // empréstimo fica pela metade se a paginação de loan divergir).
      const loansResult = await this.readAllPages(
        (page) => this.gateway.readLoansPage(itemId, page),
        { pageMismatch: 'PLUGGY_LOANS_PAGE_MISMATCH', totalPagesChanged: 'PLUGGY_LOANS_TOTAL_PAGES_CHANGED' },
        itemId,
      )
      if ('error' in loansResult) {
        return { error: loansResult.error }
      }
      const allLoans = loansResult.items

      // Lista de empréstimos vazia é legítima aqui (nem todo item tem dívida) — diferente de
      // investimentos, o consentimento já foi confirmado ativo pela lista não vazia acima, então
      // vazio não é sinal de revogação (fronteira-pluggy regra 3).

      const syncedAt = new Date()

      this.gateway.logInfo('Persistindo fotografia e snapshot histórico', { positions: allInvestments.length })
      await this.gateway.savePositionsWithSnapshots(allInvestments, syncedAt)

      this.gateway.logInfo('Persistindo empréstimos e snapshot histórico', { loans: allLoans.length })
      await this.gateway.saveLoansWithSnapshots(allLoans, syncedAt)

      // Só depois de tudo persistido a marca d'água avança — falha acima deixa o item elegível na
      // próxima tentativa.
      await this.gateway.saveSyncedItemState({
        itemId,
        status: freshItem.status,
        executionStatus: freshItem.executionStatus,
        lastUpdatedAt: freshLastUpdatedAt,
        raw: freshItem.raw,
      })

      this.gateway.logInfo('Sincronização de posição concluída')
      return { data: { synced: true, positionsSynced: allInvestments.length, loansSynced: allLoans.length } }
    } catch (err) {
      this.gateway.logError('Erro inesperado na sincronização de posição', { err })
      if (err instanceof ApplicationError) {
        return { error: err }
      }
      return { error: new ApplicationError('PLUGGY_POSITION_SYNC_FAILED', { itemId }) }
    }
  }

  private gateOpen(freshLastUpdatedAt: string, storedItem: LastSyncedItemState | undefined): boolean {
    const storedLastUpdatedAt = storedItem?.getLastUpdatedAt()
    if (storedLastUpdatedAt === undefined) {
      return true
    }

    return new Date(freshLastUpdatedAt).getTime() > storedLastUpdatedAt.getTime()
  }

  // Investimento e empréstimo são páginados exatamente da mesma forma (mesma disciplina de recusa
  // nomeada em página divergente/totalPages mutante) — este helper concentra o laço uma vez só, em
  // vez de repeti-lo por recurso. Devolve o erro como valor, nunca lança: quem chama decide se é
  // recusa de negócio (`{error}` direto) ou deixa o `catch` de `execute` tratar o resto.
  private async readAllPages<T>(
    readPage: (page: number) => Promise<{ results: T[]; page: number; totalPages: number }>,
    errorTypes: { pageMismatch: string; totalPagesChanged: string },
    itemId: string,
  ): Promise<{ items: T[] } | { error: ApplicationError }> {
    let page = 1
    let totalPages = 1
    const items: T[] = []

    do {
      const pageData = await readPage(page)
      if (pageData.page !== page) {
        this.gateway.logError('Página devolvida diferente da requisitada', { errorType: errorTypes.pageMismatch })
        return {
          error: new ApplicationError(errorTypes.pageMismatch, { itemId, requestedPage: page, receivedPage: pageData.page }),
        }
      }
      if (page === 1) {
        totalPages = pageData.totalPages
      } else if (pageData.totalPages !== totalPages) {
        this.gateway.logError('totalPages mudou durante a varredura', { errorType: errorTypes.totalPagesChanged })
        return {
          error: new ApplicationError(errorTypes.totalPagesChanged, {
            itemId,
            expectedTotalPages: totalPages,
            receivedTotalPages: pageData.totalPages,
          }),
        }
      }
      items.push(...pageData.results)
      page++
    } while (page <= totalPages)

    return { items }
  }
}
