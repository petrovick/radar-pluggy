import type { ApplicationError } from '../../../shared/application-error.js'
import type { DefaultGateway } from '../../default/default-gateway.js'

// Contrato deste caso de uso (arquitetura-camadas, regra 2): entrada, saída e **uma** interface de
// gateway, satisfeita por `adapters/gateways/pluggy-account/read-pluggy-account.impl.ts`.
//
// Leitura pura do que já foi sincronizado (fronteira-pluggy regra 6): nenhum método aqui chama a
// Pluggy. Consumidor conhecido: `PluggyCardStatementApi` (oplab-radar-front) chama `GET /accounts`
// pra achar a primeira conta `type === 'CREDIT'` antes de pedir o extrato dela — por isso a forma
// aqui é o mínimo que esse consumidor precisa, não o espelho completo da entidade.
export interface PluggyAccountView {
  accountId: string
  type: string
  subtype: string | null
  name: string
}

export interface ReadPluggyAccountGateway extends DefaultGateway {
  readItemIdsForPerson(personId: number): Promise<string[]>
  readAccountsByItemIds(itemIds: string[]): Promise<PluggyAccountView[]>
}

export type ReadPluggyAccountInput = {
  personId: number
}

export type ReadPluggyAccountOutput = {
  data?: PluggyAccountView[]
  error?: ApplicationError
}
