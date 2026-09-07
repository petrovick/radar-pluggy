import type { ApplicationError } from '../../../shared/application-error.js'
import type { DefaultGateway } from '../../default/default-gateway.js'

// Contrato deste caso de uso (arquitetura-camadas, regra 2): entrada, saída e **uma** interface de
// gateway, satisfeita por
// `adapters/gateways/pluggy-account-transaction/read-pluggy-account-statement.impl.ts`.
//
// Leitura pura do que já foi sincronizado (fronteira-pluggy regra 6): nenhum método aqui chama a
// Pluggy. Filtro é por fatura (`billMonth`, formato `AAAA-MM`), nunca por mês civil calculado —
// forma exata que `oplab-radar-front` já espera (`src/types/pluggy-card-statement.ts`).

export interface PluggyCardBillSummaryView {
  availableCreditLimit: string | null
  creditLimit: string | null
  minimumPayment: string | null
  dueDate: string | null
}

export interface PluggyCardTransactionInstallmentView {
  number: number
  total: number
}

export interface PluggyCardTransactionView {
  transactionId: string
  description: string
  amount: string
  date: string
  category: string | null
  merchantName: string | null
  billForecastMonth: string
  installment: PluggyCardTransactionInstallmentView | null
}

export interface PluggyCardStatementView {
  bill: PluggyCardBillSummaryView
  transactions: PluggyCardTransactionView[]
}

export interface ReadPluggyAccountStatementGateway extends DefaultGateway {
  // Recusa nomeada e distinta para "conta não existe" e "conta não é desta pessoa" — mesmo
  // idioma de `assertItemAccess` (`load-pluggy-history.types.ts`). Nenhum dos dois métodos abaixo
  // roda antes desta checagem passar (arquitetura-camadas, D7: dono nunca por inferência).
  assertAccountBelongsToPerson(accountId: string, personId: number): Promise<void>
  readBillSummary(accountId: string): Promise<PluggyCardBillSummaryView>
  readTransactionsByBillMonth(accountId: string, billMonth: string): Promise<PluggyCardTransactionView[]>
}

export type ReadPluggyAccountStatementInput = {
  personId: number
  accountId: string
  billMonth: string
}

export type ReadPluggyAccountStatementOutput = {
  data?: PluggyCardStatementView
  error?: ApplicationError
}
