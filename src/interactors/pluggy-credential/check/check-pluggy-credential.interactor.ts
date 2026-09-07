import { ApplicationError } from '../../../shared/application-error.js'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import { toConnectionStatus } from '../../../adapters/gateways/pluggy-connection-status.js'
import { enabledForItem, toSourceState } from '../../../adapters/gateways/pluggy-source-state.js'
import { productTypeFromSource, type PluggySource } from '../../../adapters/gateways/pluggy-source-catalog.js'
import type {
  CheckPluggyCredentialGateway,
  CheckPluggyCredentialInput,
  CheckPluggyCredentialOutput,
  CredentialStatusItem,
  CredentialStatusSources,
  CredentialStatusSourceView,
  LinkedItemView,
} from './check-pluggy-credential.types.js'

// Implementa o requisito "Credencial ou itemId ausente é recusa nomeada" do spec pluggy-credentials:
// nomeia a pessoa e o que exatamente falta — nunca segue sem autenticação, nunca com valor default.
// Checa se a pessoa tem credencial com ao menos um itemId vinculado, e traduz cada item para o
// contrato de `GET /credentials/status` (design.md D10/D19/D20/D26): `connectionStatus`
// (`pluggy-connection-observability`) e o estado por fonte (`supportedByConnector`/`enabledForItem`/
// `isUpdated`/`lastUpdatedAt`), lido do estado observado — nunca de uma chamada nova à Pluggy (D20).
//
// Consumido por `GET /credentials/status` — o handler traduz os dois erros nomeados abaixo em
// `hasCredential:false` (200), nunca repassa como erro HTTP. As recusas do
// `PluggyItemCredentialResolver` NÃO substituem este interactor: elas nomeiam `itemId`
// (`PLUGGY_CREDENTIAL_ITEM_NOT_LINKED`), que é a resolução item→credencial, um caminho diferente.
//
// Item inativo (`item/deleted`) continua na lista, `DISCONNECTED` — nunca conta como "sem item" para
// a recusa `PLUGGY_CREDENTIAL_ITEM_ID_NOT_FOUND_FOR_PERSON`: essa recusa é só para credencial que
// nunca teve NENHUM item vinculado.
export class CheckPluggyCredentialInteractor {
  private readonly gateway: CheckPluggyCredentialGateway

  constructor(params: AppContainer) {
    this.gateway = params.checkPluggyCredentialImpl
  }

  async execute(input: CheckPluggyCredentialInput): Promise<CheckPluggyCredentialOutput> {
    const { personId } = input
    this.gateway.addContext({ messageType: 'CHECK_PLUGGY_CREDENTIAL', personId })

    try {
      const credentialIds = await this.gateway.readCredentialIds(personId)
      if (credentialIds.length === 0) {
        return { error: new ApplicationError('PLUGGY_CREDENTIAL_NOT_FOUND_FOR_PERSON', { personId }) }
      }

      const links = await this.gateway.readLinkedItems(credentialIds)
      if (links.length === 0) {
        return { error: new ApplicationError('PLUGGY_CREDENTIAL_ITEM_ID_NOT_FOUND_FOR_PERSON', { personId }) }
      }

      return { data: { items: links.map(translateItem) } }
    } catch (err) {
      this.gateway.logError('Erro inesperado na checagem de credencial', { err })
      if (err instanceof ApplicationError) {
        return { error: err }
      }
      return { error: new ApplicationError('PLUGGY_CREDENTIAL_CHECK_FAILED', { personId }) }
    }
  }
}

function translateItem(item: LinkedItemView): CredentialStatusItem {
  return {
    itemId: item.itemId,
    connectorId: item.connectorId,
    connectorName: item.connectorName,
    connectorImageUrl: item.connectorImageUrl,
    connectorPrimaryColor: item.connectorPrimaryColor,
    connectionStatus: toConnectionStatus({
      inactiveAt: item.inactiveAt,
      status: item.observation?.status,
      executionStatus: item.observation?.executionStatus,
    }),
    lastUpdatedAt: item.observation?.lastUpdatedAt,
    nextAutoSyncAt: item.observation?.nextAutoSyncAt,
    sources: {
      accounts: translateSource(item, 'ACCOUNTS'),
      accountTransactions: translateSource(item, 'ACCOUNT_TRANSACTIONS'),
      investments: translateSource(item, 'INVESTMENTS'),
      investmentTransactions: translateSource(item, 'INVESTMENT_TRANSACTIONS'),
      loans: translateSource(item, 'LOANS'),
    } satisfies CredentialStatusSources,
  }
}

// `supportedByConnector` primeiro, sempre presente (D20): fonte não suportada nunca carrega
// `enabledForItem`/`isUpdated`/`lastUpdatedAt` — não haveria o que significar. `enabledForItem`
// omitido é `UNKNOWN` (D26, `itemProducts` nunca observado ou não determinado) — nunca inferido de
// `supportedByConnector`. `isUpdated`/`lastUpdatedAt` só aparecem quando `enabledForItem === true`.
function translateSource(item: LinkedItemView, source: PluggySource): CredentialStatusSourceView {
  const supportedByConnector = item.connectorProducts?.includes(productTypeFromSource(source)) ?? false
  if (!supportedByConnector) {
    return { supportedByConnector: false }
  }

  const enabled = enabledForItem(item.observation?.itemProducts, source)
  if (enabled !== true) {
    return { supportedByConnector: true, ...(enabled === false ? { enabledForItem: false } : {}) }
  }

  const executionStatus = item.observation?.executionStatus
  if (executionStatus === 'SUCCESS') {
    // D12/D20: em SUCCESS, `statusDetail` é sempre nulo — toda fonte habilitada está atualizada, com
    // o `lastUpdatedAt` do Item, sem exigir `statusDetail` para responder isso.
    return {
      supportedByConnector: true,
      enabledForItem: true,
      isUpdated: true,
      ...(item.observation?.lastUpdatedAt !== undefined ? { lastUpdatedAt: item.observation.lastUpdatedAt } : {}),
    }
  }

  const state = toSourceState({ executionStatus: executionStatus ?? '', products: item.observation?.statusDetail ?? {} }, source)
  return {
    supportedByConnector: true,
    enabledForItem: true,
    isUpdated: state.isUsable,
    ...(state.lastUpdatedAt !== undefined ? { lastUpdatedAt: state.lastUpdatedAt } : {}),
  }
}
