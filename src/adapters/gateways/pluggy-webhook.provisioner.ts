import { randomBytes } from 'node:crypto'
import type { AppContainer } from '../../infra/bootstrap/register.js'
import { ApplicationError } from '../../shared/application-error.js'
import type { PluggyClientGateway, PluggyConnectorClient } from './pluggy-client.gateway.js'
import type { PluggyWebhooksGateway } from './pluggy-webhooks.gateway.js'
import type { PluggyCredentialRep } from '../repositories/pluggy-credential.rep.js'
import type { PluggyCallRecorder } from './pluggy-call-recorder.js'
import { instrumentPluggyClient } from './pluggy-call-instrumentation.js'

// Nome do header que carrega o segredo de entrada. Fixo no serviço: é o que este serviço configura na
// Pluggy e o que ele lê na notificação — os dois lados vêm daqui.
export const WEBHOOK_SECRET_HEADER = 'x-pluggy-connector-secret'

const SECRET_BYTES = 32

// Colaborador compartilhado entre impls (arquitetura-camadas, 2.3.1) — ação com efeito colateral
// (gera segredo, chama a Pluggy, grava no banco), nunca consulta: por isso `.provisioner.ts`, papel
// distinto de `.resolver.ts` (reservado para "consulta com invariante").
//
// Nasceu extraído, não antecipado: viveu só dentro de `ReconcilePluggyWebhookImpl` até
// `RegisterPluggyCredentialImpl` precisar do mesmo provisionamento no cadastro (PENDENCIAS.md 3.1).
export class PluggyWebhookProvisioner {
  private readonly pluggyCredentialRep: PluggyCredentialRep
  private readonly pluggyClientGateway: PluggyClientGateway
  private readonly pluggyWebhooksGateway: PluggyWebhooksGateway
  private readonly webhookUrl: string
  private readonly pluggyCallRecorder: PluggyCallRecorder

  constructor(params: AppContainer) {
    this.pluggyCredentialRep = params.pluggyCredentialRep
    this.pluggyClientGateway = params.pluggyClientGateway
    this.pluggyWebhooksGateway = params.pluggyWebhooksGateway
    this.webhookUrl = params.webhookUrl
    this.pluggyCallRecorder = params.pluggyCallRecorder
  }

  // Segredo novo a cada provisionamento: provisionar é também rotacionar. Quem já estava inscrito
  // tem a inscrição ATUALIZADA (`PATCH`), nunca duplicada — o `webhook_id` guardado é o que permite
  // isso (tasks.md 7.1).
  async provisionFor(credentialId: number): Promise<void> {
    if (this.webhookUrl.trim().length === 0) {
      throw new ApplicationError('PLUGGY_WEBHOOK_URL_MISSING')
    }

    const credential = await this.pluggyCredentialRep.findById(credentialId)
    if (!credential) {
      throw new ApplicationError('PLUGGY_CREDENTIAL_NOT_FOUND', { credentialId })
    }

    // `PluggyClientGateway.clientFor` direto, nunca `PluggyItemCredentialResolver` (design.md D23):
    // configuração de plataforma é por credencial, não por item. `itemId`/`connectorId` nulos —
    // `call_scope = PLATFORM_CONFIG` (D22).
    const rawClient = this.pluggyClientGateway.clientFor(credential.getClientId(), credential.getClientSecret())
    const client = instrumentPluggyClient(rawClient, { itemId: undefined, connectorId: undefined }, this.pluggyCallRecorder)
    const secret = randomBytes(SECRET_BYTES).toString('base64url')
    const existing = credential.getWebhook()
    const confirmedExisting = existing && (await this.confirmStillExists(existing.webhookId, client))

    const provisioned = confirmedExisting
      ? await this.pluggyWebhooksGateway.updateWebhook(
          confirmedExisting,
          this.webhookUrl,
          WEBHOOK_SECRET_HEADER,
          secret,
          client,
        )
      : await this.pluggyWebhooksGateway.createWebhook(this.webhookUrl, WEBHOOK_SECRET_HEADER, secret, client)

    // Grava o que foi EFETIVAMENTE provisionado (url e evento devolvidos pela Pluggy), não o que
    // pedimos — e só depois de a Pluggy confirmar, para nunca ficar com segredo local que o
    // remetente não conhece.
    await this.pluggyCredentialRep.saveWebhook(credentialId, {
      secret,
      webhookId: provisioned.webhookId,
      url: provisioned.url,
      event: provisioned.event,
    })
  }

  // O banco local só sabe o que ele mesmo gravou da última vez — não que o webhook ainda existe do
  // lado da Pluggy. Confirma com `fetchWebhook` antes de rotacionar: se a Pluggy confirmar
  // `PLUGGY_WEBHOOK_NOT_FOUND`, o webhook sumiu de lá (apagado no dashboard ou qualquer outro motivo
  // do lado deles) e o caminho certo é recriar, nunca tentar `updateWebhook` num recurso inexistente.
  // Qualquer outro erro (rede, timeout, upstream) sobe sem ser engolido.
  private async confirmStillExists(webhookId: string, client: PluggyConnectorClient): Promise<string | undefined> {
    try {
      const webhook = await this.pluggyWebhooksGateway.fetchWebhook(webhookId, client)
      return webhook.webhookId
    } catch (error) {
      if (error instanceof ApplicationError && error.errorType === 'PLUGGY_WEBHOOK_NOT_FOUND') {
        return undefined
      }
      throw error
    }
  }
}
