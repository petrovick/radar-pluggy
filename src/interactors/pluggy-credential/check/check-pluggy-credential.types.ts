import type { ApplicationError } from '../../../shared/application-error.js'
import type { DefaultGateway } from '../../default/default-gateway.js'

// Contrato deste caso de uso (arquitetura-camadas, regra 2): entrada, saída e **uma** interface de
// gateway, satisfeita por `adapters/gateways/pluggy-credential/check-pluggy-credential.impl.ts`.
//
// Dois métodos de leitura, não um `readReadinessOf(personId)`: as duas ausências são recusas
// nomeadas diferentes, e quem decide qual delas vale é o caso de uso. Colapsar em um método levaria
// essa decisão para o adapter.

export interface CheckPluggyCredentialGateway extends DefaultGateway {
  readCredentialIds(personId: number): Promise<number[]>
  readLinkedItemIds(credentialIds: number[]): Promise<string[]>
}

export type CheckPluggyCredentialInput = {
  personId: number
}

// Sucesso não carrega dado: este caso de uso só responde "está pronta para sincronizar?", e a
// não-prontidão é `error`. Devolver aqui os itemIds que a checagem leu seria inventar payload sem
// consumidor — a forma nasce do primeiro consumidor real, não da conveniência de já ter o dado em
// mãos (achado do engenheiro-pluggy-connector).
export type CheckPluggyCredentialResult = Record<string, never>

export type CheckPluggyCredentialOutput = {
  data?: CheckPluggyCredentialResult
  error?: ApplicationError
}
