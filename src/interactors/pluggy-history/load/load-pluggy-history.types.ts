import type { ApplicationError } from '../../../shared/application-error.js'
import type { DefaultGateway } from '../../default/default-gateway.js'

// Contrato deste caso de uso (arquitetura-camadas, regra 2): entrada, saída e **uma** interface de
// gateway, satisfeita por `adapters/gateways/pluggy-history/load-pluggy-history.impl.ts`.
//
// Credencial, `POST /auth`, api key, cursor de extrato, número de página e transação são mecanismo e
// ficam inteiros no impl. O que sobra aqui é a decisão de negócio: quais fontes estão elegíveis, o que
// conta como cobertura observada, e quando a marca d'água pode avançar.

// Estado do item na Pluggy agora, com as ressalvas por produto que distinguem "produto limitado" de
// "fonte sem movimentação" (design.md D8).
export interface HistoryProductState {
  limitedByRateLimit: boolean
  warningCodes: string[]
}

export interface CurrentItemHistoryState {
  executionStatus: string
  lastUpdatedAt: string | undefined
  cashProduct: HistoryProductState
  custodyProduct: HistoryProductState
}

// Fonte de histórico: uma conta de depósito (caixa) ou um investimento (custódia). `updatedAt` é o
// que a Pluggy reporta para o recurso; ausente significa "não sei se mudou" e força varredura
// integral (tasks.md 6.2).
export type HistorySourceKind = 'ACCOUNT' | 'INVESTMENT'

export interface HistorySource {
  kind: HistorySourceKind
  referenceId: string
  updatedAt: Date | undefined
}

// Observação de uma varredura já concluída daquela fonte (design.md D5): `undefined` é fonte nunca
// varrida com sucesso.
export interface SourceObservation {
  sourceUpdatedAt: Date | undefined
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
  readLastSyncedHistoryWatermark(itemId: string): Promise<Date | undefined>

  // As fontes de cada produto: caixa são as contas de depósito (`BANK`), custódia são os
  // investimentos. Cartão de crédito fica fora (pluggy-account spec). Descobrir no provedor, percorrer
  // a paginação e registrar o que precisa ser registrado é mecanismo, e fica no impl — o caso de uso
  // só pergunta quais fontes existem.
  readCashSources(itemId: string): Promise<HistorySource[]>
  readCustodySources(itemId: string): Promise<HistorySource[]>

  readSourceObservation(itemId: string, source: HistorySource): Promise<SourceObservation>

  // Varre uma fonte inteira, devolvendo cada página **depois** de persistida. Quem itera é o caso de
  // uso, que assim conclui a observação só após a última página (design.md D6).
  scanSource(itemId: string, source: HistorySource): AsyncGenerator<PersistedPage>

  saveCompletedScan(itemId: string, scan: CompletedScan): Promise<void>
  advanceHistoryWatermark(itemId: string, itemLastUpdatedAt: Date): Promise<void>
  assertItemAccess(itemId: string, personId: number): Promise<void>
}

export type LoadPluggyHistoryInput =
  | { origin: 'USER'; personId: number; itemId: string }
  | { origin: 'INTERNAL_DRAINER'; itemId: string }

export type LoadPluggyHistoryResult = {
  loaded: boolean
  sourcesScanned: number
  transactionsObserved: number
  sourcesRefused: string[]
}

export type LoadPluggyHistoryOutput = {
  data?: LoadPluggyHistoryResult
  error?: ApplicationError
}
