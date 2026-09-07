import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  CredentialWebhookState,
  ReconcilePluggyWebhookGateway,
} from '../../../interactors/pluggy-webhook/reconcile/reconcile-pluggy-webhook.types.js'
import DefaultInteractorGatewayImpl from '../default-gateway.impl.js'
import type { PluggyCredentialRep } from '../../repositories/pluggy-credential.rep.js'
import type { PluggyWebhookProvisioner } from '../pluggy-webhook.provisioner.js'
import { runWithCallContext } from '../../../infra/tools/call-context.js'

// Gateway do caso de uso `reconcile-pluggy-webhook`. O mecanismo de provisionar (gerar segredo, criar
// ou rotacionar na Pluggy, gravar) mora em `PluggyWebhookProvisioner` — colaborador compartilhado com
// `RegisterPluggyCredentialImpl` (arquitetura-camadas, 2.3.1; PENDENCIAS.md 3.1).
export default class ReconcilePluggyWebhookImpl
  extends DefaultInteractorGatewayImpl
  implements ReconcilePluggyWebhookGateway
{
  private readonly pluggyCredentialRep: PluggyCredentialRep
  private readonly pluggyWebhookProvisioner: PluggyWebhookProvisioner

  constructor(params: AppContainer) {
    super(params)
    this.pluggyCredentialRep = params.pluggyCredentialRep
    this.pluggyWebhookProvisioner = params.pluggyWebhookProvisioner
  }

  async listCredentialWebhookStates(personId: number): Promise<CredentialWebhookState[]> {
    const credentials = await this.pluggyCredentialRep.findByPersonId(personId)
    return credentials.map((credential) => ({
      credentialId: credential.requireId(),
      provisioned: credential.getWebhook() !== undefined,
    }))
  }

  async provisionWebhook(credentialId: number): Promise<void> {
    // `trigger=WEBHOOK_RECONCILIATION` (design.md D23, tasks.md 8.8) — mesmo provisionador de
    // `RegisterPluggyCredentialImpl`, trigger distinto porque o fluxo que o disparou é outro.
    await runWithCallContext({ trigger: 'WEBHOOK_RECONCILIATION' }, () => this.pluggyWebhookProvisioner.provisionFor(credentialId))
  }
}
