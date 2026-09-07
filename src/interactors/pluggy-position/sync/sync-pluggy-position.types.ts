import type { Decimal } from 'decimal.js'
import type { ApplicationError } from '../../../shared/application-error.js'
import type { DefaultGateway } from '../../default/default-gateway.js'
import type { PluggyPositionMetadata } from '../../../entities/pluggy-position.js'
import type { PluggyProductKey, PluggyProductStatus } from '../../../adapters/gateways/pluggy-items.gateway.js'
import type { PluggySource } from '../../../adapters/gateways/pluggy-source-catalog.js'
import type { LeaseGuard } from '../../../shared/lease-guard.js'

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
  // Campo obrigatório do SDK — fallback de versão quando `lastUpdatedAt` é `null` mesmo em `SUCCESS`
  // (design.md D27).
  updatedAt: string
  // Produtos habilitados NESTE Item (D26) — `undefined` é `UNKNOWN`, nunca `[]`.
  itemProducts: string[] | undefined
  products: Partial<Record<PluggyProductKey, PluggyProductStatus>>
  // Payload bruto do item, capturado junto do registro principal (change
  // pluggy-complete-data-capture, spec pluggy-raw-payload-audit).
  raw: Record<string, unknown>
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
  // Campos capturados na change pluggy-complete-data-capture (spec pluggy-position-sync) — antes
  // descartados no gateway antes de chegar aqui.
  issuerCnpj: string | undefined
  number: string | undefined
  amountWithdrawal: Decimal | undefined
  amountProfit: Decimal | undefined
  dueDate: Date | undefined
  issuer: string | undefined
  issueDate: Date | undefined
  purchaseDate: Date | undefined
  rate: Decimal | undefined
  rateType: string | undefined
  fixedAnnualRate: Decimal | undefined
  lastMonthRate: Decimal | undefined
  annualRate: Decimal | undefined
  lastTwelveMonthsRate: Decimal | undefined
  owner: string | undefined
  metadata: PluggyPositionMetadata | undefined
  raw: Record<string, unknown>
}

export interface PluggyInvestmentsPage {
  results: PluggyInvestmentInput[]
  page: number
  total: number
  totalPages: number
}

// Lado passivo do patrimônio (empréstimo/financiamento) do mesmo item, mesmo portão de marca d'água
// dos investimentos (design.md, sincronização de loans). Captura integral do schema `Loan` (change
// pluggy-complete-data-capture, spec pluggy-loan).
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
  ipocCode: string | undefined
  disbursementDates: Date[] | undefined
  firstInstallmentDueDate: Date | undefined
  cet: Decimal | undefined
  installmentPeriodicity: string | undefined
  installmentPeriodicityAdditionalInfo: string | undefined
  amortizationScheduled: string | undefined
  amortizationScheduledAdditionalInfo: string | undefined
  cnpjConsignee: string | undefined
  interestRates: Record<string, unknown>[] | undefined
  contractedFees: Record<string, unknown>[] | undefined
  contractedFinanceCharges: Record<string, unknown>[] | undefined
  warranties: Record<string, unknown>[] | undefined
  installments: Record<string, unknown> | undefined
  payments: Record<string, unknown> | undefined
  raw: Record<string, unknown>
}

export interface PluggyLoansPage {
  results: PluggyLoanInput[]
  page: number
  total: number
  totalPages: number
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
      // Escopo autorizado (change pluggy-complete-data-capture, spec pluggy-consent).
      products: string[] | undefined
      openFinancePermissionsGranted: string[] | undefined
      raw: Record<string, unknown>
    }

export interface SaveSyncedItemStateInput {
  itemId: string
  status: string
  executionStatus: string | undefined
  lastUpdatedAt: Date | undefined
  raw: Record<string, unknown>
}

export interface SyncPluggyPositionGateway extends DefaultGateway {
  // Sem credencial nem cliente na assinatura: o impl resolve o cliente do SDK por dentro (que
  // autentica e cacheia a api key sozinho) e o dono do item sai da credencial já vinculada, nunca de
  // inferência (design.md D7).
  readCurrentItemState(itemId: string): Promise<CurrentItemState>

  // Marca d'água por (`POSITION_SYNC`, fonte) — design.md D4. `consumer` é fixo neste gateway, nunca
  // exposto ao caso de uso; nunca as mesmas linhas que `HISTORY_LOAD` usa para `INVESTMENTS`.
  readSyncProgress(itemId: string, source: PluggySource): Promise<Date | undefined>
  advanceSyncProgress(itemId: string, source: PluggySource, versionAt: Date): Promise<void>

  // Verificado só quando alguma fonte está desatualizada (fronteira-pluggy regra 6: nenhuma chamada
  // nova sem mudança real). Consentimento revogado/expirado faz `GET /investments` devolver lista
  // vazia — esta checagem nomeia a causa antes de gastar a paginação inteira num resultado que já se
  // sabe vazio.
  readConsentStatus(itemId: string): Promise<PluggyConsentStatus>
  saveConsentStatus(itemId: string, status: PluggyConsentStatus): Promise<void>

  readInvestmentsPage(itemId: string, page: number): Promise<PluggyInvestmentsPage>
  // Fotografia + snapshot histórico numa única unidade atômica (design.md D11), e reconciliação da
  // fotografia atual (D21) — todo investimento local que não veio nesta leitura deixa de pertencer à
  // fotografia. A transação vive dentro do impl: o caso de uso não sabe que ela existe.
  savePositionsWithSnapshots(itemId: string, investments: PluggyInvestmentInput[], syncedAt: Date): Promise<void>

  readLoansPage(itemId: string, page: number): Promise<PluggyLoansPage>
  saveLoansWithSnapshots(itemId: string, loans: PluggyLoanInput[], syncedAt: Date): Promise<void>

  // Preserva, sem reinterpretação, "última ingestão completa e bem-sucedida" (design.md D5) — só
  // chamado pelo caso de uso quando `executionStatus === 'SUCCESS'`.
  saveSyncedItemState(input: SaveSyncedItemStateInput): Promise<void>
}

export type SyncPluggyPositionInput = {
  itemId: string
  // Presente só quando o chamador detém um lease de ingestão com heartbeat (D16) — ausente nunca é
  // tratado como perda: sem guard, o caso de uso roda como sempre rodou (design.md, invariante do
  // PR de observabilidade).
  leaseGuard?: LeaseGuard
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
