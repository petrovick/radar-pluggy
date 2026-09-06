import type { ApplicationError } from '../../../shared/application-error.js'
import type { DefaultGateway } from '../../default/default-gateway.js'

// Contrato deste caso de uso (arquitetura-camadas, regra 2): entrada, saída e **uma** interface de
// gateway, satisfeita por `adapters/gateways/pluggy-credential/register-pluggy-credential.impl.ts`.
// Este arquivo não importa nada de `adapters/` nem de `infra/`.
//
// `saveCredential` devolve só o id: é o que o passo seguinte e a resposta precisam. Devolver a
// entidade faria o caso de uso conhecer `getClientSecret()` e o webhook provisionado — dado que ele
// não usa e não deve carregar.

export interface RegisterPluggyCredentialGateway extends DefaultGateway {
  checkItemAvailable(itemId: string): Promise<void>
  validateItemAccess(input: { clientId: string; clientSecret: string; itemId: string }): Promise<void>
  saveCredentialWithItemLink(input: { personId: number; clientId: string; clientSecret: string; itemId: string }): Promise<number>
  // Provisionar entra no cadastro (PENDENCIAS.md 3.1, decisão de 2026-09-04): ação explícita do
  // titular ao registrar a credencial, mesmo mecanismo que a reconciliação usa para as já existentes.
  provisionWebhook(credentialId: number): Promise<void>
}

export type RegisterPluggyCredentialInput = {
  personId: number
  clientId: string
  clientSecret: string
  itemId: string
}

export type RegisterPluggyCredentialResult = {
  credentialId: number
}

export type RegisterPluggyCredentialOutput = {
  data?: RegisterPluggyCredentialResult
  error?: ApplicationError
}
