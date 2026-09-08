import type { ApplicationError } from '../../../shared/application-error.js'
import type { DefaultGateway } from '../../default/default-gateway.js'

// Contrato deste caso de uso (arquitetura-camadas, regra 2): entrada, saída e **uma** interface de
// gateway, satisfeita por `adapters/gateways/pluggy-position/read-pluggy-position.impl.ts`.
//
// Leitura pura do que já foi sincronizado (fronteira-pluggy regra 6): nenhum método aqui chama a
// Pluggy. `readItemIdsForPerson` devolve lista vazia para pessoa sem credencial/item — portfolio
// vazio é estado normal (D3, fronteira-pluggy regra 3), nunca recusa.

// Forma exata que `oplab-radar-front` já espera (`src/types/pluggy-portfolio.ts`, `PluggyPosition`):
// contrato fixado do lado do consumidor antes deste endpoint existir. `null`, não `undefined` —
// é o JSON da resposta HTTP, não um tipo de domínio interno.
export interface PluggyPositionMetadataView {
  taxRegime: string | null
  proposalNumber: string | null
  processNumber: string | null
}

// Forma que `oplab-radar-front` consome (`src/types/pluggy-portfolio.ts`, `PluggyPosition`):
// contrato com superset completo de campos normalizados do investimento. `null`, não `undefined` —
// é o JSON da resposta HTTP. `quotaDate` é garantida no domínio e no banco, logo é string não nula.
export interface PluggyPositionView {
  investmentId: string
  type: string
  subtype: string | null
  name: string
  code: string | null
  isin: string | null
  currencyCode: string
  balance: string
  quantity: string | null
  value: string | null
  amountOriginal: string | null
  amount: string | null
  taxes: string | null
  taxes2: string | null
  amountWithdrawal: string | null
  amountProfit: string | null
  status: string | null
  quotaDate: string
  dueDate: string | null
  issueDate: string | null
  purchaseDate: string | null
  issuer: string | null
  issuerCnpj: string | null
  rate: string | null
  rateType: string | null
  fixedAnnualRate: string | null
  lastMonthRate: string | null
  annualRate: string | null
  lastTwelveMonthsRate: string | null
  institutionName: string | null
  institutionNumber: string | null
  sourceInstitutionName: string | null
  number: string | null
  owner: string | null
  metadata: PluggyPositionMetadataView | null
}

export interface ReadPluggyPositionGateway extends DefaultGateway {
  readItemIdsForPerson(personId: number): Promise<string[]>
  readPositionsByItemIds(itemIds: string[]): Promise<PluggyPositionView[]>
}

export type ReadPluggyPositionInput = {
  personId: number
}

export type ReadPluggyPositionOutput = {
  data?: PluggyPositionView[]
  error?: ApplicationError
}
