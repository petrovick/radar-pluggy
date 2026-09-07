import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  RegisterPluggyCredentialGateway,
  ValidatedConnectorInfo,
} from '../../../interactors/pluggy-credential/register/register-pluggy-credential.types.js'
import { ApplicationError } from '../../../shared/application-error.js'
import DefaultInteractorGatewayImpl from '../default-gateway.impl.js'
import type { PluggyClientGateway } from '../pluggy-client.gateway.js'
import type { PluggyItemsGateway } from '../pluggy-items.gateway.js'
import type { PluggyCredentialItemRep } from '../../repositories/pluggy-credential-item.rep.js'
import type { PluggyCredentialRep } from '../../repositories/pluggy-credential.rep.js'
import type { PluggyWebhookProvisioner } from '../pluggy-webhook.provisioner.js'
import type { PluggyCallRecorder } from '../pluggy-call-recorder.js'
import { instrumentPluggyClient } from '../pluggy-call-instrumentation.js'
import { runWithCallContext } from '../../../infra/tools/call-context.js'

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
  private readonly pluggyCallRecorder: PluggyCallRecorder

  constructor(params: AppContainer) {
    super(params)
    this.pluggyCredentialRep = params.pluggyCredentialRep
    this.pluggyCredentialItemRep = params.pluggyCredentialItemRep
    this.pluggyClientGateway = params.pluggyClientGateway
    this.pluggyItemsGateway = params.pluggyItemsGateway
    this.pluggyWebhookProvisioner = params.pluggyWebhookProvisioner
    this.pluggyCallRecorder = params.pluggyCallRecorder
  }

  async checkItemAvailable(itemId: string): Promise<void> {
    const existing = await this.pluggyCredentialItemRep.findCredentialIdByItemId(itemId)
    if (existing !== undefined) {
      throw new ApplicationError('PLUGGY_CREDENTIAL_ITEM_ALREADY_LINKED', { itemId })
    }
  }

  // `freshClient`, nunca o cacheado: garante que o `clientSecret` recém-fornecido é de fato testado
  // no `POST /auth` (D3/D9). Nunca escreve em `radar_pluggy_item_observations` — não existe vínculo
  // ainda para associar a observação (design.md D9).
  async validateItemAccess(input: {
    clientId: string
    clientSecret: string
    itemId: string
  }): Promise<{ connector: ValidatedConnectorInfo | undefined }> {
    // `runWithCallContext` (design.md D2/D23, tasks.md 8.8): `trigger=CREDENTIAL_REGISTRATION_VALIDATION`
    // identifica esta chamada em `radar_pluggy_calls`, distinta do provisionamento de webhook abaixo.
    return runWithCallContext({ trigger: 'CREDENTIAL_REGISTRATION_VALIDATION' }, async () => {
      const freshClient = this.pluggyClientGateway.createFreshClient(input.clientId, input.clientSecret)
      // `connectorId: undefined` — o connector é o que esta própria chamada está prestes a descobrir,
      // nunca conhecido antes dela (design.md D3).
      const instrumented = instrumentPluggyClient(freshClient, { itemId: input.itemId, connectorId: undefined }, this.pluggyCallRecorder)
      const item = await this.pluggyItemsGateway.fetchItem(input.itemId, instrumented)
      return { connector: item.connector }
    })
  }

  async saveCredentialWithItemLink(input: {
    personId: number
    clientId: string
    clientSecret: string
    itemId: string
    connector: ValidatedConnectorInfo | undefined
  }): Promise<number> {
    await this.startProcess()
    try {
      const credential = await this.pluggyCredentialRep.create({
        personId: input.personId,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      })
      const credentialId = credential.requireId()
      await this.pluggyCredentialItemRep.linkItem(credentialId, input.itemId, input.connector)
      await this.terminateProcess()
      return credentialId
    } catch (err) {
      await this.cancelProcess()
      throw err
    }
  }

  async provisionWebhook(credentialId: number): Promise<void> {
    // `trigger=CREDENTIAL_REGISTRATION_PROVISIONING` — distinto de `CREDENTIAL_REGISTRATION_VALIDATION`
    // acima, mesmo cadastro (design.md D23, tasks.md 8.8).
    await runWithCallContext({ trigger: 'CREDENTIAL_REGISTRATION_PROVISIONING' }, () =>
      this.pluggyWebhookProvisioner.provisionFor(credentialId),
    )
  }
}
