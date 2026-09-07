import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type { LinkedItemView, CheckPluggyCredentialGateway } from '../../../interactors/pluggy-credential/check/check-pluggy-credential.types.js'
import DefaultInteractorGatewayImpl from '../default-gateway.impl.js'
import type { PluggyCredentialItemRep } from '../../repositories/pluggy-credential-item.rep.js'
import type { PluggyCredentialRep } from '../../repositories/pluggy-credential.rep.js'
import type { PluggyItemObservationRep } from '../../repositories/pluggy-item-observation.rep.js'
import type { PluggyProductKey, PluggyProductStatus } from '../pluggy-items.gateway.js'

// Gateway do caso de uso `check-pluggy-credential`. Compõe os três repositórios (credencial, vínculo
// com connector, observação) — é a única camada onde "quantas peças existem" é conhecimento legítimo
// (arquitetura-camadas, 2.3). A tradução de `sources`/`connectionStatus` fica no interactor (D10/D20):
// aqui só se lê e se junta por `itemId`, nunca se decide vocabulário de negócio.
export default class CheckPluggyCredentialImpl
  extends DefaultInteractorGatewayImpl
  implements CheckPluggyCredentialGateway
{
  private readonly pluggyCredentialRep: PluggyCredentialRep
  private readonly pluggyCredentialItemRep: PluggyCredentialItemRep
  private readonly pluggyItemObservationRep: PluggyItemObservationRep

  constructor(params: AppContainer) {
    super(params)
    this.pluggyCredentialRep = params.pluggyCredentialRep
    this.pluggyCredentialItemRep = params.pluggyCredentialItemRep
    this.pluggyItemObservationRep = params.pluggyItemObservationRep
  }

  // `findByPersonId` só devolve credenciais já persistidas (reconstitute) — nunca um rascunho de
  // create() ainda não salvo. `requireId()` falha alto se essa invariante for quebrada no futuro, em
  // vez de filtrar em silêncio um estado que não deveria existir aqui.
  async readCredentialIds(personId: number): Promise<number[]> {
    const credentials = await this.pluggyCredentialRep.findByPersonId(personId)
    return credentials.map((credential) => credential.requireId())
  }

  // Nunca filtra por `inactive_at` (D20/D29): `/credentials/status` mostra item terminal como
  // `DISCONNECTED`, quem filtra é `PluggyPersonItemResolver` (fotografia corrente).
  async readLinkedItems(credentialIds: number[]): Promise<LinkedItemView[]> {
    const links = await this.pluggyCredentialItemRep.findByCredentialIds(credentialIds)
    if (links.length === 0) {
      return []
    }

    const observations = await this.pluggyItemObservationRep.readMany(links.map((link) => link.itemId))
    const observationByItemId = new Map(observations.map((observation) => [observation.getItemId(), observation]))

    return links.map((link) => {
      const observation = observationByItemId.get(link.itemId)
      return {
        itemId: link.itemId,
        connectorId: link.connectorId,
        connectorName: link.connectorName,
        connectorImageUrl: link.connectorImageUrl,
        connectorPrimaryColor: link.connectorPrimaryColor,
        connectorProducts: link.connectorProducts,
        inactiveAt: link.inactiveAt,
        observation: observation
          ? {
              status: observation.getStatus(),
              executionStatus: observation.getExecutionStatus(),
              statusDetail: observation.getStatusDetail() as Partial<Record<PluggyProductKey, PluggyProductStatus>> | undefined,
              itemProducts: observation.getItemProducts(),
              lastUpdatedAt: observation.getLastUpdatedAt()?.toISOString(),
              nextAutoSyncAt: observation.getNextAutoSyncAt()?.toISOString(),
            }
          : undefined,
      }
    })
  }
}
