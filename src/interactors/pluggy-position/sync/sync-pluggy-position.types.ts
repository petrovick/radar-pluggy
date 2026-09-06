import type { Decimal } from 'decimal.js'
import type { ApplicationError } from '../../../shared/application-error.js'
import type { DefaultGateway } from '../../default/default-gateway.js'

// Contrato deste caso de uso (arquitetura-camadas, regra 2): entrada, saída e **uma** interface de
// gateway, satisfeita por `adapters/gateways/pluggy-position/sync-pluggy-position.impl.ts`. Este
// arquivo não importa nada de `adapters/` nem de `infra/`.
//
// Os métodos falam a língua do produto, não a do fornecedor: "busca o estado do item", "grava a
// posição". Credencial, `POST /auth`, api key, cache de token e transação são **mecanismo** e ficam
// inteiros dentro do impl — o caso de uso pede o dado de forma autenticada sem saber o que é
// autenticar.

export interface CurrentItemState {
  status: string
  executionStatus: string
  lastUpdatedAt: string | undefined
}

export interface PluggyInvestmentInput {
  investmentId: string
  itemId: string
  type: string
  subtype: string | undefined
  name: string
  code: string | undefined
  isin: string | undefined
  currencyCode: string
  balance: Decimal
  quantity: Decimal | undefined
  amountOriginal: Decimal | undefined
  // Opcionais no schema `Investment` da Pluggy: presentes em ~100% (`value`/`amount`) e ~25%
  // (`taxes`/`taxes2`) do dump real, nunca garantidos (design.md D11).
  value?: Decimal | undefined
  amount?: Decimal | undefined
  taxes?: Decimal | undefined
  taxes2?: Decimal | undefined
  status: string | undefined
  institutionName: string | undefined
  institutionNumber: string | undefined
  quotaDate: Date
}

export interface PluggyInvestmentsPage {
  results: PluggyInvestmentInput[]
  page: number
  total: number
  totalPages: number
}

// Lado passivo do patrimônio (empréstimo/financiamento) do mesmo item, mesmo portão de marca d'água
// dos investimentos (design.md, sincronização de loans). Subconjunto deliberado do schema `Loan` —
// o corte completo está documentado em `adapters/gateways/pluggy-loans.gateway.ts`.
export interface PluggyLoanInput {
  loanId: string
  itemId: string
  contractNumber: string | undefined
  productName: string
  type: string | undefined
  kind: string
  collectedAt: Date | undefined
  contractDate: Date | undefined
  settlementDate: Date | undefined
  contractAmount: Decimal | undefined
  currencyCode: string
  dueDate: Date | undefined
  totalInstallments: number | undefined
  paidInstallments: number | undefined
  dueInstallments: number | undefined
  pastDueInstallments: number | undefined
  outstandingBalance: Decimal | undefined
}

export interface PluggyLoansPage {
  results: PluggyLoanInput[]
  page: number
  total: number
  totalPages: number
}

export interface LastSyncedItemState {
  getLastUpdatedAt(): Date | undefined
}

// Estado do consentimento Open Finance por trás do item, no momento em que o portão de marca d'água
// abriu. `NOT_FOUND` é a Pluggy nunca ter registrado consentimento algum para este item — distinto de
// `REVOKED`/`EXPIRED`, que tiveram consentimento e o perderam.
export type PluggyConsentStatus =
  | { kind: 'NOT_FOUND' }
  | {
      kind: 'ACTIVE' | 'EXPIRED' | 'REVOKED'
      consentId: string
      grantedAt: Date
      expiresAt: Date | undefined
      revokedAt: Date | undefined
    }

export interface SaveSyncedItemStateInput {
  itemId: string
  status: string
  executionStatus: string | undefined
  lastUpdatedAt: Date | undefined
}

export interface SyncPluggyPositionGateway extends DefaultGateway {
  // Sem credencial nem cliente na assinatura: o impl resolve o cliente do SDK por dentro (que
  // autentica e cacheia a api key sozinho) e o dono do item sai da credencial já vinculada, nunca de
  // inferência (design.md D7).
  readCurrentItemState(itemId: string): Promise<CurrentItemState>
  readInvestmentsPage(itemId: string, page: number): Promise<PluggyInvestmentsPage>
  readLastSyncedItemState(itemId: string): Promise<LastSyncedItemState | undefined>
  // Verificado só quando o portão de marca d'água abre (fronteira-pluggy regra 6: nenhuma chamada
  // nova sem mudança real). Consentimento revogado/expirado faz `GET /investments` devolver lista
  // vazia (regra 3) — esta checagem nomeia a causa antes de gastar a paginação inteira num resultado
  // que já se sabe vazio.
  readConsentStatus(itemId: string): Promise<PluggyConsentStatus>
  saveConsentStatus(itemId: string, status: PluggyConsentStatus): Promise<void>
  // Fotografia + snapshot histórico numa única unidade atômica (design.md D11). A transação vive
  // dentro do impl: o caso de uso não sabe que ela existe, e por isso não há como "esquecer" de
  // repassá-la — se qualquer linha falhar, nenhuma é gravada.
  savePositionsWithSnapshots(investments: PluggyInvestmentInput[], syncedAt: Date): Promise<void>
  // Lado passivo (empréstimo), mesmo portão e mesmo consentimento já verificados para investimentos —
  // sem chamada própria de `fetchItem`/consentimento (design.md, sincronização de loans).
  readLoansPage(itemId: string, page: number): Promise<PluggyLoansPage>
  saveLoansWithSnapshots(loans: PluggyLoanInput[], syncedAt: Date): Promise<void>
  saveSyncedItemState(input: SaveSyncedItemStateInput): Promise<void>
}

export type SyncPluggyPositionInput = {
  itemId: string
}

export type SyncPluggyPositionResult = {
  synced: boolean
  positionsSynced: number
  loansSynced: number
}

export type SyncPluggyPositionOutput = {
  data?: SyncPluggyPositionResult
  error?: ApplicationError
}
