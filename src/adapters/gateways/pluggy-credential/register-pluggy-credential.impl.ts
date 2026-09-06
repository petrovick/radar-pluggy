import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type { RegisterPluggyCredentialGateway } from '../../../interactors/pluggy-credential/register/register-pluggy-credential.types.js'
import { ApplicationError } from '../../../shared/application-error.js'
import DefaultInteractorGatewayImpl from '../default-gateway.impl.js'
import type { PluggyClientGateway } from '../pluggy-client.gateway.js'
import type { PluggyItemsGateway } from '../pluggy-items.gateway.js'
import type { PluggyCredentialItemRep } from '../../repositories/pluggy-credential-item.rep.js'
import type { PluggyCredentialRep } from '../../repositories/pluggy-credential.rep.js'
import type { PluggyWebhookProvisioner } from '../pluggy-webhook.provisioner.js'

// Gateway do caso de uso `register-pluggy-credential`. Compõe os dois repositórios de credencial —
// é a única camada onde "quantas peças existem" é conhecimento legítimo (arquitetura-camadas, 2.3) —,
// os gateways de cliente e itens para validação prévia remota fora do cache e o `PluggyWebhookProvisioner`,
// colaborador compartilhado com `ReconcilePluggyWebhookImpl` (arquitetura-camadas, 2.3.1; PENDENCIAS.md 3.1).
export default class RegisterPluggyCredentialImpl
  extends DefaultInteractorGatewayImpl
  implements RegisterPluggyCredentialGateway
{
  private readonly pluggyCredentialRep: PluggyCredentialRep
  private readonly pluggyCredentialItemRep: PluggyCredentialItemRep
  private readonly pluggyClientGateway: PluggyClientGateway
  private readonly pluggyItemsGateway: PluggyItemsGateway
  private readonly pluggyWebhookProvisioner: PluggyWebhookProvisioner

  constructor(params: AppContainer) {
    super(params)
    this.pluggyCredentialRep = params.pluggyCredentialRep
    this.pluggyCredentialItemRep = params.pluggyCredentialItemRep
    this.pluggyClientGateway = params.pluggyClientGateway
    this.pluggyItemsGateway = params.pluggyItemsGateway
    this.pluggyWebhookProvisioner = params.pluggyWebhookProvisioner
  }

  async checkItemAvailable(itemId: string): Promise<void> {
    const existing = await this.pluggyCredentialItemRep.findCredentialIdByItemId(itemId)
    if (existing !== undefined) {
      throw new ApplicationError('PLUGGY_CREDENTIAL_ITEM_ALREADY_LINKED', { itemId })
    }
  }

  async validateItemAccess(input: { clientId: string; clientSecret: string; itemId: string }): Promise<void> {
    const freshClient = this.pluggyClientGateway.createFreshClient(input.clientId, input.clientSecret)
    await this.pluggyItemsGateway.fetchItem(input.itemId, freshClient)
  }

  async saveCredentialWithItemLink(input: {
    personId: number
    clientId: string
    clientSecret: string
    itemId: string
  }): Promise<number> {
    await this.startProcess()
    try {
      const credential = await this.pluggyCredentialRep.create({
        personId: input.personId,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      })
      const credentialId = credential.requireId()
      await this.pluggyCredentialItemRep.linkItem(credentialId, input.itemId)
      await this.terminateProcess()
      return credentialId
    } catch (err) {
      await this.cancelProcess()
      throw err
    }
  }

  async provisionWebhook(credentialId: number): Promise<void> {
    await this.pluggyWebhookProvisioner.provisionFor(credentialId)
  }
}
