import type { ApplicationError } from '../../../shared/application-error.js'
import type { DefaultGateway } from '../../default/default-gateway.js'
import type { PluggyProductKey, PluggyProductStatus } from '../../../adapters/gateways/pluggy-items.gateway.js'

// Contrato deste caso de uso (arquitetura-camadas, regra 2): entrada, saída e **uma** interface de
// gateway, satisfeita por `adapters/gateways/pluggy-credential/check-pluggy-credential.impl.ts`.
//
// Dois métodos de leitura, não um `readReadinessOf(personId)`: as duas ausências são recusas
// nomeadas diferentes, e quem decide qual delas vale é o caso de uso. Colapsar em um método levaria
// essa decisão para o adapter.

export interface LinkedItemObservationView {
  status: string | undefined
  executionStatus: string | undefined
  // Mesma forma de `Item.statusDetail` já parseada (design.md D33) — `undefined` em `SUCCESS` (D12)
  // ou quando o item nunca foi observado.
  statusDetail: Partial<Record<PluggyProductKey, PluggyProductStatus>> | undefined
  // `undefined` é `UNKNOWN` (D26) — nunca inferido do connector.
  itemProducts: string[] | undefined
  lastUpdatedAt: string | undefined
  nextAutoSyncAt: string | undefined
}

// Um vínculo credencial↔item, com a identidade do connector (D19) e a última observação aceita
// (D20/D33) — `observation` é `undefined` para um item vinculado que ainda não foi observado nenhuma
// vez (recém-cadastrado, ingestão ainda não rodou).
export interface LinkedItemView {
  itemId: string
  connectorId: number | undefined
  connectorName: string | undefined
  connectorImageUrl: string | undefined
  connectorPrimaryColor: string | undefined
  // Capability da instituição (D19/D26) — nunca confundido com `itemProducts`, dentro de `observation`.
  connectorProducts: string[] | undefined
  // Presente é o vínculo marcado inativo (`item/deleted`, D28/D29) — o item continua na lista,
  // `DISCONNECTED` (spec pluggy-credentials), nunca removido dela.
  inactiveAt: Date | undefined
  observation: LinkedItemObservationView | undefined
}

export interface CheckPluggyCredentialGateway extends DefaultGateway {
  readCredentialIds(personId: number): Promise<number[]>
  readLinkedItems(credentialIds: number[]): Promise<LinkedItemView[]>
}

export type CheckPluggyCredentialInput = {
  personId: number
}

// Vocabulário fechado das cinco fontes (design.md D10/D20/D26) — chaves camelCase do DTO
// (`pluggy-source-catalog.dtoKeyFromSource`), nunca o vocabulário de domínio (`PluggySource`) nem o
// de `statusDetail`.
export interface CredentialStatusSourceView {
  supportedByConnector: boolean
  enabledForItem?: boolean
  isUpdated?: boolean
  lastUpdatedAt?: string
}

export interface CredentialStatusSources {
  accounts: CredentialStatusSourceView
  accountTransactions: CredentialStatusSourceView
  investments: CredentialStatusSourceView
  investmentTransactions: CredentialStatusSourceView
  loans: CredentialStatusSourceView
}

export interface CredentialStatusItem {
  itemId: string
  connectorId: number | undefined
  connectorName: string | undefined
  connectorImageUrl: string | undefined
  connectorPrimaryColor: string | undefined
  connectionStatus: string
  lastUpdatedAt: string | undefined
  nextAutoSyncAt: string | undefined
  sources: CredentialStatusSources
}

// Sucesso carrega os itens já traduzidos (D10) — diferente da versão anterior deste caso de uso
// (`data: {}`), que só respondia "está pronto?". Agora existe um consumidor real do dado
// (`GET /credentials/status.items[]`), então devolvê-lo aqui deixou de ser payload sem propósito.
export type CheckPluggyCredentialResult = {
  items: CredentialStatusItem[]
}

export type CheckPluggyCredentialOutput = {
  data?: CheckPluggyCredentialResult
  error?: ApplicationError
}
