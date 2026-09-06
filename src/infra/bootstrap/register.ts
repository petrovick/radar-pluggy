import { asClass, asFunction, asValue, createContainer, InjectionMode, type AwilixContainer } from 'awilix'
import type { Transaction } from 'sequelize'
import { getModels, type DB } from '../db/models.js'
import type { Config } from '../config/config.js'
import { createLogger, type Logger } from '../tools/log/logger.js'
import { PluggyClientGateway } from '../../adapters/gateways/pluggy-client.gateway.js'
import { PluggyItemsGateway } from '../../adapters/gateways/pluggy-items.gateway.js'
import { PluggyInvestmentsGateway } from '../../adapters/gateways/pluggy-investments.gateway.js'
import { PluggyLoansGateway } from '../../adapters/gateways/pluggy-loans.gateway.js'
import { PluggyConsentsGateway } from '../../adapters/gateways/pluggy-consents.gateway.js'
import SyncPluggyPositionImpl from '../../adapters/gateways/pluggy-position/sync-pluggy-position.impl.js'
import LoadPluggyHistoryImpl from '../../adapters/gateways/pluggy-history/load-pluggy-history.impl.js'
import { PluggyItemCredentialResolver } from '../../adapters/gateways/pluggy-item-credential.resolver.js'
import { PluggyWebhookProvisioner } from '../../adapters/gateways/pluggy-webhook.provisioner.js'
import { PluggyAccountsGateway } from '../../adapters/gateways/pluggy-accounts.gateway.js'
import { PluggyAccountTransactionsGateway } from '../../adapters/gateways/pluggy-account-transactions.gateway.js'
import { PluggyInvestmentTransactionsGateway } from '../../adapters/gateways/pluggy-investment-transactions.gateway.js'
import { PluggyAccountRep } from '../../adapters/repositories/pluggy-account.rep.js'
import { PluggyAccountTransactionRep } from '../../adapters/repositories/pluggy-account-transaction.rep.js'
import { PluggyInvestmentTransactionRep } from '../../adapters/repositories/pluggy-investment-transaction.rep.js'
import { PluggyHistoryCoverageRep } from '../../adapters/repositories/pluggy-history-coverage.rep.js'
import { PluggyHistorySyncStateRep } from '../../adapters/repositories/pluggy-history-sync-state.rep.js'
import { PluggyWebhookEventRep } from '../../adapters/repositories/pluggy-webhook-event.rep.js'
import { PluggyWebhooksGateway } from '../../adapters/gateways/pluggy-webhooks.gateway.js'
import AcceptPluggyWebhookImpl from '../../adapters/gateways/pluggy-webhook/accept-pluggy-webhook.impl.js'
import RegisterPluggyCredentialImpl from '../../adapters/gateways/pluggy-credential/register-pluggy-credential.impl.js'
import CheckPluggyCredentialImpl from '../../adapters/gateways/pluggy-credential/check-pluggy-credential.impl.js'
import ReconcilePluggyWebhookImpl from '../../adapters/gateways/pluggy-webhook/reconcile-pluggy-webhook.impl.js'
import { PluggyItemRep } from '../../adapters/repositories/pluggy-item.rep.js'
import { PluggyCredentialRep } from '../../adapters/repositories/pluggy-credential.rep.js'
import { PluggyCredentialItemRep } from '../../adapters/repositories/pluggy-credential-item.rep.js'
import { PersonRep } from '../../adapters/repositories/person.rep.js'
import { PluggyPositionRep } from '../../adapters/repositories/pluggy-position.rep.js'
import { PluggyPositionSnapshotRep } from '../../adapters/repositories/pluggy-position-snapshot.rep.js'
import { PluggyLoanRep } from '../../adapters/repositories/pluggy-loan.rep.js'
import { PluggyLoanSnapshotRep } from '../../adapters/repositories/pluggy-loan-snapshot.rep.js'
import { PluggyConsentRep } from '../../adapters/repositories/pluggy-consent.rep.js'
import { SyncPluggyPositionInteractor } from '../../interactors/pluggy-position/sync/sync-pluggy-position.interactor.js'
import { LoadPluggyHistoryInteractor } from '../../interactors/pluggy-history/load/load-pluggy-history.interactor.js'
import { AcceptPluggyWebhookInteractor } from '../../interactors/pluggy-webhook/accept/accept-pluggy-webhook.interactor.js'
import { ReconcilePluggyWebhookInteractor } from '../../interactors/pluggy-webhook/reconcile/reconcile-pluggy-webhook.interactor.js'
import { RegisterPluggyCredentialInteractor } from '../../interactors/pluggy-credential/register/register-pluggy-credential.interactor.js'
import { CheckPluggyCredentialInteractor } from '../../interactors/pluggy-credential/check/check-pluggy-credential.interactor.js'
import CheckHealthImpl from '../../adapters/gateways/health/check-health.impl.js'
import { CheckHealthInteractor } from '../../interactors/health/check/check-health.interactor.js'

export type GetTransaction = (name: string) => Transaction | null
export type SetTransaction = (name: string, transaction: Transaction | null) => void

// Bag tipada que todo construtor de interactor, impl de gateway e repositório recebe — mesmo contrato
// do `AppContainer` do `oplab-radar-api` (`infra/bootstrap/register.ts`). Nome de chave aqui é o nome
// de registro no container: `params.syncPluggyPositionImpl` resolve o que estiver registrado com essa
// chave abaixo.
export type AppContainer = {
  rootContainer: AppContainerInstance
  db: DB
  logger: Logger
  getTransaction: GetTransaction
  setTransaction: SetTransaction
  requestId: string
  // URL pública HTTPS deste serviço para o webhook (design.md D7). Valor de configuração, não
  // segredo: o segredo é por credencial, cifrado no banco.
  webhookUrl: string
  // Chave que cifra/decifra client_secret/webhook_secret em `pluggy-credential.rep.ts` — já
  // validada por `infra/config/config.ts`, nunca lida de `process.env` no ponto de uso.
  credentialEncryptionKey: string

  /** Interactor */
  syncPluggyPositionInteractor: SyncPluggyPositionInteractor
  loadPluggyHistoryInteractor: LoadPluggyHistoryInteractor
  acceptPluggyWebhookInteractor: AcceptPluggyWebhookInteractor
  reconcilePluggyWebhookInteractor: ReconcilePluggyWebhookInteractor
  registerPluggyCredentialInteractor: RegisterPluggyCredentialInteractor
  checkPluggyCredentialInteractor: CheckPluggyCredentialInteractor
  checkHealthInteractor: CheckHealthInteractor

  /** Gateway de caso de uso (impl) */
  syncPluggyPositionImpl: SyncPluggyPositionImpl
  loadPluggyHistoryImpl: LoadPluggyHistoryImpl
  acceptPluggyWebhookImpl: AcceptPluggyWebhookImpl
  reconcilePluggyWebhookImpl: ReconcilePluggyWebhookImpl
  registerPluggyCredentialImpl: RegisterPluggyCredentialImpl
  checkPluggyCredentialImpl: CheckPluggyCredentialImpl
  checkHealthImpl: CheckHealthImpl

  /** Gateway de borda (Pluggy) */
  pluggyClientGateway: PluggyClientGateway
  pluggyItemsGateway: PluggyItemsGateway
  pluggyInvestmentsGateway: PluggyInvestmentsGateway
  pluggyLoansGateway: PluggyLoansGateway
  pluggyConsentsGateway: PluggyConsentsGateway
  pluggyAccountsGateway: PluggyAccountsGateway
  pluggyAccountTransactionsGateway: PluggyAccountTransactionsGateway
  pluggyInvestmentTransactionsGateway: PluggyInvestmentTransactionsGateway
  pluggyWebhooksGateway: PluggyWebhooksGateway

  /** Colaborador compartilhado entre impls (arquitetura-camadas, 2.3.1) */
  pluggyItemCredentialResolver: PluggyItemCredentialResolver
  pluggyWebhookProvisioner: PluggyWebhookProvisioner

  /** Repositório */
  personRep: PersonRep
  pluggyItemRep: PluggyItemRep
  pluggyCredentialRep: PluggyCredentialRep
  pluggyCredentialItemRep: PluggyCredentialItemRep
  pluggyPositionRep: PluggyPositionRep
  pluggyPositionSnapshotRep: PluggyPositionSnapshotRep
  pluggyLoanRep: PluggyLoanRep
  pluggyLoanSnapshotRep: PluggyLoanSnapshotRep
  pluggyAccountRep: PluggyAccountRep
  pluggyAccountTransactionRep: PluggyAccountTransactionRep
  pluggyInvestmentTransactionRep: PluggyInvestmentTransactionRep
  pluggyHistoryCoverageRep: PluggyHistoryCoverageRep
  pluggyHistorySyncStateRep: PluggyHistorySyncStateRep
  pluggyWebhookEventRep: PluggyWebhookEventRep
  pluggyConsentRep: PluggyConsentRep
}

export type AppContainerInstance = AwilixContainer<AppContainer>

export function setupContainer(config: Config): AppContainerInstance {
  const container = createContainer<AppContainer>({
    injectionMode: InjectionMode.PROXY,
  })

  container.register({
    // Config já validada por `infra/config.ts` — nenhum default aqui, ausência recusou na subida.
    db: asFunction(() => getModels(config.database)).singleton(),
    // `() => createLogger()`, nunca `asFunction(createLogger)` direto: o parâmetro de
    // `createLogger` se chama `writer`, e o `InjectionMode.PROXY` deste container injeta pelo
    // NOME do parâmetro — sem o wrapper, o Awilix passaria o cradle inteiro (um objeto) como
    // `writer`, e o primeiro `logger.info/warn/error` de verdade quebraria com "writer is not
    // a function" (achado em produção: crashava no primeiro log do boot, `index.ts`).
    logger: asFunction(() => createLogger()).scoped(),
    webhookUrl: asValue(config.webhookUrl),
    credentialEncryptionKey: asValue(config.credentialEncryptionKey),

    // Gateways de borda da Pluggy: sem estado e sem configuração própria desde a adoção do
    // `pluggy-sdk` (o transporte é dele), então entram por `asClass`. Recebem o cliente já
    // autenticado por parâmetro, nunca api key.
    // Singleton porque o cache de cliente (e, dentro dele, a api key do SDK) precisa sobreviver
    // ao escopo da unidade de trabalho — ver `pluggy-client.gateway.ts`.
    pluggyClientGateway: asFunction(() => new PluggyClientGateway()).singleton(),
    pluggyItemsGateway: asClass(PluggyItemsGateway).singleton(),
    pluggyInvestmentsGateway: asClass(PluggyInvestmentsGateway).singleton(),
    pluggyLoansGateway: asClass(PluggyLoansGateway).singleton(),
    pluggyConsentsGateway: asClass(PluggyConsentsGateway).singleton(),
    pluggyAccountsGateway: asClass(PluggyAccountsGateway).singleton(),
    pluggyAccountTransactionsGateway: asClass(PluggyAccountTransactionsGateway).singleton(),
    pluggyInvestmentTransactionsGateway: asClass(PluggyInvestmentTransactionsGateway).singleton(),
    pluggyItemCredentialResolver: asClass(PluggyItemCredentialResolver).scoped(),
    pluggyWebhookProvisioner: asClass(PluggyWebhookProvisioner).scoped(),
    pluggyWebhooksGateway: asClass(PluggyWebhooksGateway).singleton(),

    personRep: asClass(PersonRep).scoped(),
    pluggyItemRep: asClass(PluggyItemRep).scoped(),
    pluggyCredentialRep: asClass(PluggyCredentialRep).scoped(),
    pluggyCredentialItemRep: asClass(PluggyCredentialItemRep).scoped(),
    pluggyPositionRep: asClass(PluggyPositionRep).scoped(),
    pluggyPositionSnapshotRep: asClass(PluggyPositionSnapshotRep).scoped(),
    pluggyLoanRep: asClass(PluggyLoanRep).scoped(),
    pluggyLoanSnapshotRep: asClass(PluggyLoanSnapshotRep).scoped(),
    pluggyAccountRep: asClass(PluggyAccountRep).scoped(),
    pluggyAccountTransactionRep: asClass(PluggyAccountTransactionRep).scoped(),
    pluggyInvestmentTransactionRep: asClass(PluggyInvestmentTransactionRep).scoped(),
    pluggyHistoryCoverageRep: asClass(PluggyHistoryCoverageRep).scoped(),
    pluggyHistorySyncStateRep: asClass(PluggyHistorySyncStateRep).scoped(),
    pluggyWebhookEventRep: asClass(PluggyWebhookEventRep).scoped(),
    pluggyConsentRep: asClass(PluggyConsentRep).scoped(),

    syncPluggyPositionImpl: asClass(SyncPluggyPositionImpl).scoped(),
    loadPluggyHistoryImpl: asClass(LoadPluggyHistoryImpl).scoped(),
    acceptPluggyWebhookImpl: asClass(AcceptPluggyWebhookImpl).scoped(),
    reconcilePluggyWebhookImpl: asClass(ReconcilePluggyWebhookImpl).scoped(),
    registerPluggyCredentialImpl: asClass(RegisterPluggyCredentialImpl).scoped(),
    checkPluggyCredentialImpl: asClass(CheckPluggyCredentialImpl).scoped(),
    checkHealthImpl: asClass(CheckHealthImpl).scoped(),

    syncPluggyPositionInteractor: asClass(SyncPluggyPositionInteractor).scoped(),
    loadPluggyHistoryInteractor: asClass(LoadPluggyHistoryInteractor).scoped(),
    acceptPluggyWebhookInteractor: asClass(AcceptPluggyWebhookInteractor).scoped(),
    reconcilePluggyWebhookInteractor: asClass(ReconcilePluggyWebhookInteractor).scoped(),
    registerPluggyCredentialInteractor: asClass(RegisterPluggyCredentialInteractor).scoped(),
    checkPluggyCredentialInteractor: asClass(CheckPluggyCredentialInteractor).scoped(),
    checkHealthInteractor: asClass(CheckHealthInteractor).scoped(),
  })

  container.register({ rootContainer: asValue(container) })

  return container
}
