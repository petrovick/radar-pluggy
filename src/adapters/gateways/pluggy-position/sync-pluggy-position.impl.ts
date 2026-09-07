import type { AppContainer } from '../../../infra/bootstrap/register.js'
import { ApplicationError } from '../../../shared/application-error.js'
import type {
  CurrentItemState,
  PluggyConsentStatus,
  PluggyInvestmentInput,
  PluggyInvestmentsPage,
  PluggyLoanInput,
  PluggyLoansPage,
  SaveSyncedItemStateInput,
  SyncPluggyPositionGateway,
} from '../../../interactors/pluggy-position/sync/sync-pluggy-position.types.js'
import DefaultInteractorGatewayImpl from '../default-gateway.impl.js'
import { PluggyConsent, mostRecentConsent } from '../../../entities/pluggy-consent.js'
import type { PluggyInvestmentsGateway } from '../pluggy-investments.gateway.js'
import type { PluggyLoansGateway } from '../pluggy-loans.gateway.js'
import type { PluggyConsentsGateway } from '../pluggy-consents.gateway.js'
import type { PluggySource } from '../pluggy-source-catalog.js'
import type { PluggyItemRep } from '../../repositories/pluggy-item.rep.js'
import type { PluggyPositionRep } from '../../repositories/pluggy-position.rep.js'
import type { PluggyPositionSnapshotRep } from '../../repositories/pluggy-position-snapshot.rep.js'
import type { PluggyLoanRep } from '../../repositories/pluggy-loan.rep.js'
import type { PluggyLoanSnapshotRep } from '../../repositories/pluggy-loan-snapshot.rep.js'
import type { PluggyConsentRep } from '../../repositories/pluggy-consent.rep.js'
import type { PluggySyncProgressRep } from '../../repositories/pluggy-sync-progress.rep.js'
import type { PluggyItemStateResolver } from '../pluggy-item-state.resolver.js'
import type { PluggyItemCredentialResolver } from '../pluggy-item-credential.resolver.js'
import type { PluggyItemRawRep } from '../../repositories/pluggy-item-raw.rep.js'
import type { PluggyConsentRawRep } from '../../repositories/pluggy-consent-raw.rep.js'
import type { PluggyPositionRawRep } from '../../repositories/pluggy-position-raw.rep.js'
import type { PluggyLoanRawRep } from '../../repositories/pluggy-loan-raw.rep.js'

// Gateway do caso de uso `sync-pluggy-position` — mesma forma de `create-car.impl.ts` no
// `oplab-radar-api`: herda log + ciclo de transação de `DefaultInteractorGatewayImpl` e compõe os
// colaboradores concretos (gateways de borda da Pluggy, repositórios, interactor de credencial).
//
// É aqui, e só aqui, que a atomicidade de D11 existe: `commitInvestments`/`commitLoans` abrem a
// transação, tentam avançar a marca d'água condicionalmente à versão, e só gravam fotografia +
// snapshot de cada item e reconciliam (D21) quando essa tentativa venceu a corrida — e só então
// comitam (revisão do PR #14: commit de fotografia protegido pela mesma versão do avanço, nunca
// separado dele). Os repositórios leem a transação vigente do escopo (`getTransaction`), sem
// recebê-la por parâmetro — não há como um repositório "esquecer" de entrar na transação.
export default class SyncPluggyPositionImpl
  extends DefaultInteractorGatewayImpl
  implements SyncPluggyPositionGateway
{
  private readonly pluggyItemCredentialResolver: PluggyItemCredentialResolver
  private readonly pluggyItemStateResolver: PluggyItemStateResolver
  private readonly pluggyInvestmentsGateway: PluggyInvestmentsGateway
  private readonly pluggyLoansGateway: PluggyLoansGateway
  private readonly pluggyConsentsGateway: PluggyConsentsGateway
  private readonly pluggyItemRep: PluggyItemRep
  private readonly pluggyPositionRep: PluggyPositionRep
  private readonly pluggyPositionSnapshotRep: PluggyPositionSnapshotRep
  private readonly pluggyLoanRep: PluggyLoanRep
  private readonly pluggyLoanSnapshotRep: PluggyLoanSnapshotRep
  private readonly pluggyConsentRep: PluggyConsentRep
  private readonly pluggySyncProgressRep: PluggySyncProgressRep
  private readonly pluggyItemRawRep: PluggyItemRawRep
  private readonly pluggyConsentRawRep: PluggyConsentRawRep
  private readonly pluggyPositionRawRep: PluggyPositionRawRep
  private readonly pluggyLoanRawRep: PluggyLoanRawRep

  constructor(params: AppContainer) {
    super(params)
    this.pluggyItemCredentialResolver = params.pluggyItemCredentialResolver
    this.pluggyItemStateResolver = params.pluggyItemStateResolver
    this.pluggyInvestmentsGateway = params.pluggyInvestmentsGateway
    this.pluggyLoansGateway = params.pluggyLoansGateway
    this.pluggyConsentsGateway = params.pluggyConsentsGateway
    this.pluggyItemRep = params.pluggyItemRep
    this.pluggyPositionRep = params.pluggyPositionRep
    this.pluggyPositionSnapshotRep = params.pluggyPositionSnapshotRep
    this.pluggyLoanRep = params.pluggyLoanRep
    this.pluggyLoanSnapshotRep = params.pluggyLoanSnapshotRep
    this.pluggyConsentRep = params.pluggyConsentRep
    this.pluggySyncProgressRep = params.pluggySyncProgressRep
    this.pluggyItemRawRep = params.pluggyItemRawRep
    this.pluggyConsentRawRep = params.pluggyConsentRawRep
    this.pluggyPositionRawRep = params.pluggyPositionRawRep
    this.pluggyLoanRawRep = params.pluggyLoanRawRep
  }

  async readCurrentItemState(itemId: string): Promise<CurrentItemState> {
    const item = await this.pluggyItemStateResolver.read(itemId)

    return {
      status: item.status,
      executionStatus: item.executionStatus,
      lastUpdatedAt: item.lastUpdatedAt,
      updatedAt: item.updatedAt,
      itemProducts: item.itemProducts,
      products: item.products,
      raw: item.raw,
    }
  }

  readSyncProgress(itemId: string, source: PluggySource): Promise<Date | undefined> {
    return this.pluggySyncProgressRep.read(itemId, 'POSITION_SYNC', source)
  }

  // O mais recentemente concedido é o vigente (entities/pluggy-consent.ts) — a Pluggy devolve o
  // histórico inteiro, e uma renovação gera um registro novo sem apagar o anterior.
  async readConsentStatus(itemId: string): Promise<PluggyConsentStatus> {
    const client = await this.pluggyItemCredentialResolver.clientFor(itemId)
    const consents = await this.pluggyConsentsGateway.fetchConsents(itemId, client)
    const latest = mostRecentConsent(consents.map((dto) => PluggyConsent.create(dto)))
    if (latest === undefined) {
      return { kind: 'NOT_FOUND' }
    }
    // O payload bruto não é campo de negócio da entity (fronteira-pluggy regra 1 é sobre dinheiro,
    // não sobre auditoria) — vem direto do DTO vencedor, não de `latest`.
    const winningDto = consents.find((dto) => dto.consentId === latest.getConsentId())
    if (winningDto === undefined) {
      throw new ApplicationError('PLUGGY_CONSENT_RAW_PAYLOAD_MISSING', { itemId, consentId: latest.getConsentId() })
    }

    return {
      kind: latest.statusAt(new Date()),
      consentId: latest.getConsentId(),
      grantedAt: latest.getGrantedAt(),
      expiresAt: latest.getExpiresAt(),
      revokedAt: latest.getRevokedAt(),
      products: latest.getProducts(),
      openFinancePermissionsGranted: latest.getOpenFinancePermissionsGranted(),
      raw: winningDto.raw,
    }
  }

  // Log bruto inserido junto do registro principal, na mesma transação (change
  // pluggy-complete-data-capture, spec pluggy-raw-payload-audit): falha em qualquer um dos dois
  // desfaz os dois.
  async saveConsentStatus(itemId: string, status: PluggyConsentStatus): Promise<void> {
    if (status.kind === 'NOT_FOUND') {
      return
    }
    await this.startProcess()
    try {
      await this.pluggyConsentRep.save({
        itemId,
        consentId: status.consentId,
        grantedAt: status.grantedAt,
        expiresAt: status.expiresAt,
        revokedAt: status.revokedAt,
        products: status.products,
        openFinancePermissionsGranted: status.openFinancePermissionsGranted,
      })
      await this.pluggyConsentRawRep.save({
        itemId,
        consentId: status.consentId,
        rawPayload: status.raw,
        capturedAt: new Date(),
      })
      await this.terminateProcess()
    } catch (err) {
      await this.cancelProcess()
      throw err
    }
  }

  async readInvestmentsPage(itemId: string, page: number): Promise<PluggyInvestmentsPage> {
    return this.pluggyInvestmentsGateway.fetchInvestmentsPage(itemId, await this.pluggyItemCredentialResolver.clientFor(itemId), page)
  }

  // Commit atômico (revisão do PR #14): dentro de UMA transação, primeiro tenta avançar
  // `pluggy_sync_progress` condicionalmente à versão — só quando essa tentativa vence a corrida
  // (`versionAt` estritamente maior que a versão completada) é que a fotografia é tocada: upsert de
  // cada investimento presente, snapshot histórico (design.md D11), e reconciliação (D21) — todo
  // registro local cujo `investmentId` não veio nesta leitura deixa de pertencer à fotografia,
  // inclusive quando `investments` vem vazio (portfólio zerado é estado legítimo). Uma execução
  // velha cujo `advance` perde a corrida nunca chega a tocar a fotografia (nem upsert nem
  // reconciliação) — o commit inteiro é um no-op, e a transação é encerrada sem nenhuma escrita
  // destrutiva. Snapshot/raw nunca são reconciliados.
  async commitInvestments(itemId: string, investments: PluggyInvestmentInput[], syncedAt: Date, versionAt: Date): Promise<boolean> {
    await this.startProcess()

    try {
      const won = await this.pluggySyncProgressRep.advance(itemId, 'POSITION_SYNC', 'INVESTMENTS', versionAt)
      if (!won) {
        await this.terminateProcess()
        return false
      }

      for (const investment of investments) {
        await this.pluggyPositionRep.save(investment)
        await this.pluggyPositionRawRep.save({
          itemId: investment.itemId,
          investmentId: investment.investmentId,
          rawPayload: investment.raw,
          capturedAt: syncedAt,
        })
        await this.pluggyPositionSnapshotRep.save({
          itemId: investment.itemId,
          investmentId: investment.investmentId,
          quotaDate: investment.quotaDate,
          balance: investment.balance,
          quantity: investment.quantity,
          amountOriginal: investment.amountOriginal,
          ...(investment.value !== undefined ? { value: investment.value } : {}),
          ...(investment.amount !== undefined ? { amount: investment.amount } : {}),
          ...(investment.taxes !== undefined ? { taxes: investment.taxes } : {}),
          ...(investment.taxes2 !== undefined ? { taxes2: investment.taxes2 } : {}),
          currencyCode: investment.currencyCode,
          syncedAt,
        })
      }

      await this.pluggyPositionRep.reconcile(itemId, investments.map((investment) => investment.investmentId))

      await this.terminateProcess()
      return true
    } catch (err) {
      await this.cancelProcess()
      throw err
    }
  }

  async readLoansPage(itemId: string, page: number): Promise<PluggyLoansPage> {
    return this.pluggyLoansGateway.fetchLoansPage(itemId, await this.pluggyItemCredentialResolver.clientFor(itemId), page)
  }

  // Mesma forma de `commitInvestments`, para `LOANS`.
  async commitLoans(itemId: string, loans: PluggyLoanInput[], syncedAt: Date, versionAt: Date): Promise<boolean> {
    await this.startProcess()

    try {
      const won = await this.pluggySyncProgressRep.advance(itemId, 'POSITION_SYNC', 'LOANS', versionAt)
      if (!won) {
        await this.terminateProcess()
        return false
      }

      for (const loan of loans) {
        await this.pluggyLoanRep.save(loan)
        await this.pluggyLoanRawRep.save({
          itemId: loan.itemId,
          loanId: loan.loanId,
          rawPayload: loan.raw,
          capturedAt: syncedAt,
        })
        await this.pluggyLoanSnapshotRep.save({
          itemId: loan.itemId,
          loanId: loan.loanId,
          outstandingBalance: loan.outstandingBalance,
          totalInstallments: loan.totalInstallments,
          paidInstallments: loan.paidInstallments,
          dueInstallments: loan.dueInstallments,
          pastDueInstallments: loan.pastDueInstallments,
          currencyCode: loan.currencyCode,
          syncedAt,
        })
      }

      await this.pluggyLoanRep.reconcile(itemId, loans.map((loan) => loan.loanId))

      await this.terminateProcess()
      return true
    } catch (err) {
      await this.cancelProcess()
      throw err
    }
  }

  // O dono do item sai da credencial vinculada, não do caso de uso: quem sincroniza não precisa
  // carregar `personId` só para persistir. Log bruto inserido junto, na mesma transação (change
  // pluggy-complete-data-capture, spec pluggy-raw-payload-audit).
  async saveSyncedItemState(input: SaveSyncedItemStateInput): Promise<void> {
    const credential = await this.pluggyItemCredentialResolver.credentialFor(input.itemId)
    await this.startProcess()
    try {
      await this.pluggyItemRep.save({ ...input, personId: credential.getPersonId() })
      await this.pluggyItemRawRep.save({
        itemId: input.itemId,
        rawPayload: input.raw,
        capturedAt: new Date(),
      })
      await this.terminateProcess()
    } catch (err) {
      await this.cancelProcess()
      throw err
    }
  }
}
