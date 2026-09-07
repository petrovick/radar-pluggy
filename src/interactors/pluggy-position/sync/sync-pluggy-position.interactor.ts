import { ApplicationError } from '../../../shared/application-error.js'
import { isEligible, isUsable, toVersionAt } from '../../../adapters/gateways/pluggy-source-state.js'
import type { PluggySource } from '../../../adapters/gateways/pluggy-source-catalog.js'
import type { LeaseGuard } from '../../../shared/lease-guard.js'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  CurrentItemState,
  SyncPluggyPositionGateway,
  SyncPluggyPositionInput,
  SyncPluggyPositionOutput,
} from './sync-pluggy-position.types.js'

interface SourceEvaluation {
  outdated: boolean
  versionAt: Date | undefined
}

// Orquestra a sincronização da posição financeira de um item (design.md D4/D6/D13/D21/D26): lê o
// estado atual do item e processa `INVESTMENTS`/`LOANS` de forma INDEPENDENTE, cada um sob seu
// próprio portão de marca d'água (`PluggySyncProgressRep`, `consumer = POSITION_SYNC` — linhas
// próprias deste consumidor, nunca as de `HISTORY_LOAD` para `INVESTMENTS`, D4). Aceita
// `executionStatus` `SUCCESS` ou `PARTIAL_SUCCESS` — uma fonte recusada (`isUsable === false`) nunca
// impede a outra.
//
// `radar_pluggy_items` (D5) preserva seu significado estrito de "última ingestão completa e
// bem-sucedida": só é atualizado quando `executionStatus === 'SUCCESS'`.
//
// Uma única dependência, o gateway do próprio caso de uso (arquitetura-camadas, regra 2).
export class SyncPluggyPositionInteractor {
  private readonly gateway: SyncPluggyPositionGateway

  constructor(params: AppContainer) {
    this.gateway = params.syncPluggyPositionImpl
  }

  async execute(input: SyncPluggyPositionInput): Promise<SyncPluggyPositionOutput> {
    const { itemId, leaseGuard } = input
    this.gateway.addContext({ messageType: 'SYNC_PLUGGY_POSITION', itemId })

    try {
      // Mesma correção de `LoadPluggyHistoryInteractor` (revisão do PR #14, D16): lease já perdido
      // ANTES de qualquer chamada, inclusive antes de `readCurrentItemState` (que já dispara
      // `fetchItem` real via `PluggyItemStateResolver`).
      const leaseLostUpfront = this.refuseIfLeaseLost(itemId, leaseGuard)
      if (leaseLostUpfront) {
        return { error: leaseLostUpfront }
      }

      const item = await this.gateway.readCurrentItemState(itemId)

      if (item.executionStatus !== 'SUCCESS' && item.executionStatus !== 'PARTIAL_SUCCESS') {
        this.gateway.logInfo('Item não está em SUCCESS/PARTIAL_SUCCESS, sincronização não ocorre', {
          executionStatus: item.executionStatus,
        })
        return { data: notSynced() }
      }

      const investmentsEval = await this.evaluateSource(itemId, item, 'INVESTMENTS')
      const loansEval = await this.evaluateSource(itemId, item, 'LOANS')

      if (!investmentsEval.outdated && !loansEval.outdated) {
        this.gateway.logInfo('Nenhuma fonte desatualizada, sincronização não ocorre')
        return { data: notSynced() }
      }

      const leaseLost = this.refuseIfLeaseLost(itemId, leaseGuard)
      if (leaseLost) {
        return { error: leaseLost }
      }

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

      const syncedAt = new Date()

      let positionsSynced = 0
      if (investmentsEval.outdated && investmentsEval.versionAt !== undefined) {
        const investmentsResult = await this.readAllPages(
          (page) => this.gateway.readInvestmentsPage(itemId, page),
          { pageMismatch: 'PLUGGY_INVESTMENTS_PAGE_MISMATCH', totalPagesChanged: 'PLUGGY_INVESTMENTS_TOTAL_PAGES_CHANGED' },
          itemId,
          leaseGuard,
        )
        if ('error' in investmentsResult) {
          return { error: investmentsResult.error }
        }

        const leaseLostBeforeSave = this.refuseIfLeaseLost(itemId, leaseGuard)
        if (leaseLostBeforeSave) {
          return { error: leaseLostBeforeSave }
        }

        this.gateway.logInfo('Persistindo fotografia e snapshot histórico', { positions: investmentsResult.items.length })
        const committed = await this.gateway.commitInvestments(
          itemId,
          investmentsResult.items,
          syncedAt,
          investmentsEval.versionAt,
        )
        if (committed) {
          positionsSynced = investmentsResult.items.length
        } else {
          this.gateway.logInfo('Versão mais nova já aplicada por outra execução, fotografia de investimentos não regride', {
            itemId,
          })
        }
      }

      let loansSynced = 0
      if (loansEval.outdated && loansEval.versionAt !== undefined) {
        const loansResult = await this.readAllPages(
          (page) => this.gateway.readLoansPage(itemId, page),
          { pageMismatch: 'PLUGGY_LOANS_PAGE_MISMATCH', totalPagesChanged: 'PLUGGY_LOANS_TOTAL_PAGES_CHANGED' },
          itemId,
          leaseGuard,
        )
        if ('error' in loansResult) {
          return { error: loansResult.error }
        }

        const leaseLostBeforeSave = this.refuseIfLeaseLost(itemId, leaseGuard)
        if (leaseLostBeforeSave) {
          return { error: leaseLostBeforeSave }
        }

        this.gateway.logInfo('Persistindo empréstimos e snapshot histórico', { loans: loansResult.items.length })
        const committed = await this.gateway.commitLoans(itemId, loansResult.items, syncedAt, loansEval.versionAt)
        if (committed) {
          loansSynced = loansResult.items.length
        } else {
          this.gateway.logInfo('Versão mais nova já aplicada por outra execução, fotografia de empréstimos não regride', {
            itemId,
          })
        }
      }

      // D5: preserva, sem reinterpretação, "última ingestão completa e bem-sucedida" — nunca em
      // PARTIAL_SUCCESS, mesmo com uma ou mais fontes processadas nesta execução.
      if (item.executionStatus === 'SUCCESS') {
        await this.gateway.saveSyncedItemState({
          itemId,
          status: item.status,
          executionStatus: item.executionStatus,
          lastUpdatedAt: new Date(item.lastUpdatedAt ?? item.updatedAt),
          raw: item.raw,
        })
      }

      this.gateway.logInfo('Sincronização de posição concluída', { positionsSynced, loansSynced })
      return { data: { synced: true, positionsSynced, loansSynced } }
    } catch (err) {
      this.gateway.logError('Erro inesperado na sincronização de posição', { err })
      if (err instanceof ApplicationError) {
        return { error: err }
      }
      return { error: new ApplicationError('PLUGGY_POSITION_SYNC_FAILED', { itemId }) }
    }
  }

  // Avalia se `source` está habilitada (D26), utilizável nesta execução (D6) e com marca d'água
  // desatualizada (D4) — nessa ordem: elegibilidade por `itemProducts` sempre primeiro. Nunca chama
  // a Pluggy: só lê a marca d'água local.
  private async evaluateSource(itemId: string, item: CurrentItemState, source: PluggySource): Promise<SourceEvaluation> {
    if (!isEligible(item.itemProducts, source) || !isUsable(item, source)) {
      return { outdated: false, versionAt: undefined }
    }

    const versionAt = toVersionAt(item, source, itemId)
    if (versionAt === undefined) {
      return { outdated: false, versionAt: undefined }
    }

    const watermark = await this.gateway.readSyncProgress(itemId, source)
    const outdated = watermark === undefined || versionAt.getTime() > watermark.getTime()
    return { outdated, versionAt }
  }

  // Investimento e empréstimo são páginados exatamente da mesma forma (mesma disciplina de recusa
  // nomeada em página divergente/totalPages mutante) — este helper concentra o laço uma vez só, em
  // vez de repeti-lo por recurso. Devolve o erro como valor, nunca lança: quem chama decide se é
  // recusa de negócio (`{error}` direto) ou deixa o `catch` de `execute` tratar o resto.
  private async readAllPages<T>(
    readPage: (page: number) => Promise<{ results: T[]; page: number; totalPages: number }>,
    errorTypes: { pageMismatch: string; totalPagesChanged: string },
    itemId: string,
    leaseGuard: LeaseGuard | undefined,
  ): Promise<{ items: T[] } | { error: ApplicationError }> {
    let page = 1
    let totalPages = 1
    const items: T[] = []

    do {
      const leaseLost = this.refuseIfLeaseLost(itemId, leaseGuard)
      if (leaseLost) {
        return { error: leaseLost }
      }

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

  // Invariante desta rodada: `renew() === false` no lease de ingestão que protege esta execução
  // (D16) recusa nova página, nova chamada e novo commit destrutivo — nunca aborta trabalho já em
  // voo, só impede o PRÓXIMO passo. Sem `leaseGuard` (chamador não detém lease), nunca recusa.
  private refuseIfLeaseLost(itemId: string, leaseGuard: LeaseGuard | undefined): ApplicationError | undefined {
    if (!leaseGuard?.isLost()) {
      return undefined
    }
    this.gateway.logInfo('Lease de ingestão perdido, sincronização interrompida antes de novo passo', { itemId })
    return new ApplicationError('PLUGGY_ITEM_INGESTION_LEASE_LOST', { itemId })
  }
}

function notSynced() {
  return { synced: false, positionsSynced: 0, loansSynced: 0 }
}
