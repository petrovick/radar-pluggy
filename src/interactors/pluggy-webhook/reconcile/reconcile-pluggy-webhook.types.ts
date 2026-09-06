import type { ApplicationError } from '../../../shared/application-error.js'
import type { DefaultGateway } from '../../default/default-gateway.js'

// Provisiona ou corrige o webhook das credenciais já cadastradas (tasks.md 7.4). Existe porque o
// deploy não pode deixar conta cadastrada antes do webhook sem gatilho diário — e porque isso é
// decisão explícita e autenticada do titular, nunca cron (fronteira-pluggy, regra 7).

export interface CredentialWebhookState {
  credentialId: number
  provisioned: boolean
}

export interface ReconcilePluggyWebhookGateway extends DefaultGateway {
  listCredentialWebhookStates(personId: number): Promise<CredentialWebhookState[]>
  // Idempotente: credencial sem webhook é inscrita; credencial já inscrita tem a inscrição
  // atualizada, nunca duplicada. Gerar o segredo e cifrá-lo é mecanismo, fica no impl.
  provisionWebhook(credentialId: number): Promise<void>
}

export type ReconcilePluggyWebhookInput = {
  personId: number
}

export type ReconcilePluggyWebhookResult = {
  provisioned: number
  updated: number
  failed: number
}

export type ReconcilePluggyWebhookOutput = {
  data?: ReconcilePluggyWebhookResult
  error?: ApplicationError
}
