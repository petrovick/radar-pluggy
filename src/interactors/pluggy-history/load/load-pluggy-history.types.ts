import type { ApplicationError } from '../../../shared/application-error.js'
import type { DefaultGateway } from '../../default/default-gateway.js'
import type { PluggyProductKey, PluggyProductStatus } from '../../../adapters/gateways/pluggy-items.gateway.js'
import type { PluggySource } from '../../../adapters/gateways/pluggy-source-catalog.js'
import type { LeaseGuard } from '../../../shared/lease-guard.js'

// Contrato deste caso de uso (arquitetura-camadas, regra 2): entrada, saída e **uma** interface de
// gateway, satisfeita por `adapters/gateways/pluggy-history/load-pluggy-history.impl.ts`.
//
// Credencial, `POST /auth`, api key, cursor de extrato, número de página e transação são mecanismo e
// ficam inteiros no impl. O que sobra aqui é a decisão de negócio: elegibilidade por fonte real
// (design.md D4/D6/D13/D26), o que conta como cobertura, e quando cada marca d'água pode avançar.

export interface CurrentItemHistoryState {
  executionStatus: string
  lastUpdatedAt: string | undefined
  updatedAt: string
  // Produtos habilitados NESTE Item (D26) — `undefined` é `UNKNOWN`, nunca `[]`.
  itemProducts: string[] | undefined
  products: Partial<Record<PluggyProductKey, PluggyProductStatus>>
}

// Fonte de histórico: uma conta de depósito (caixa) ou um investimento (custódia). `updatedAt`, se
// disponível, é só observabilidade (D14) — nunca decide se a fonte é varrida.
export type HistorySourceKind = 'ACCOUNT' | 'INVESTMENT'

export interface HistorySource {
  kind: HistorySourceKind
  referenceId: string
  updatedAt: Date | undefined
}

// Resultado de persistir UMA página de uma fonte. O impl grava a página antes de devolver isto — é o
// que faz "persiste cada página imediatamente" (tasks.md 6.1) ser verdade.
export interface PersistedPage {
  count: number
  oldestAt: Date | undefined
  newestAt: Date | undefined
}

export interface CompletedScan {
  kind: HistorySourceKind
  referenceId: string
  observedCount: number
  oldestObservedAt: Date | undefined
  newestObservedAt: Date | undefined
  sourceUpdatedAt: Date | undefined
}

export interface LoadPluggyHistoryGateway extends DefaultGateway {
  readCurrentItemState(itemId: string): Promise<CurrentItemHistoryState>

  // Marca d'água por (`HISTORY_LOAD`, fonte) — design.md D4. `consumer` é fixo neste gateway, nunca
  // exposto ao caso de uso.
  readSyncProgress(itemId: string, source: PluggySource): Promise<Date | undefined>
  advanceSyncProgress(itemId: string, source: PluggySource, versionAt: Date): Promise<void>

  // Descobre TODAS as contas de depósito/investimentos atuais — sem filtrar por `updatedAt` do
  // recurso (D14). Cada página é persistida (fotografia de conta) antes de devolvida.
  readCashSources(itemId: string): Promise<HistorySource[]>
  readCustodySources(itemId: string): Promise<HistorySource[]>

  // Leitura autoritativa de contas reconcilia a fotografia atual (design.md D21) — só chamado quando
  // `ACCOUNTS` é `isUsable` nesta execução.
  reconcileAccounts(itemId: string, presentAccountIds: string[]): Promise<void>

  // Varre uma fonte inteira, devolvendo cada página **depois** de persistida. Quem itera é o caso de
  // uso, que assim conclui a observação só após a última página.
  scanSource(itemId: string, source: HistorySource): AsyncGenerator<PersistedPage>

  saveCompletedScan(itemId: string, scan: CompletedScan): Promise<void>
  assertItemAccess(itemId: string, personId: number): Promise<void>
}

export type LoadPluggyHistoryInput =
  | { origin: 'USER'; personId: number; itemId: string; leaseGuard?: LeaseGuard }
  | { origin: 'INTERNAL_DRAINER'; itemId: string; leaseGuard?: LeaseGuard }

export type LoadPluggyHistoryResult = {
  loaded: boolean
  sourcesScanned: number
  transactionsObserved: number
  // Fontes elegíveis (D26) mas recusadas nesta execução por não serem `isUsable` (D6) — vocabulário
  // de domínio (`ACCOUNTS`, `ACCOUNT_TRANSACTIONS`, `INVESTMENTS`, `INVESTMENT_TRANSACTIONS`), nunca
  // rótulo agrupado ("caixa"/"custódia" eram só agrupamento de elegibilidade, D4).
  sourcesRefused: string[]
}

export type LoadPluggyHistoryOutput = {
  data?: LoadPluggyHistoryResult
  error?: ApplicationError
}
