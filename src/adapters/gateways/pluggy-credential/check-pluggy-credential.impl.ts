import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type { CheckPluggyCredentialGateway } from '../../../interactors/pluggy-credential/check/check-pluggy-credential.types.js'
import DefaultInteractorGatewayImpl from '../default-gateway.impl.js'
import type { PluggyCredentialItemRep } from '../../repositories/pluggy-credential-item.rep.js'
import type { PluggyCredentialRep } from '../../repositories/pluggy-credential.rep.js'

// Gateway do caso de uso `check-pluggy-credential`. Compõe os dois repositórios de credencial.
export default class CheckPluggyCredentialImpl
  extends DefaultInteractorGatewayImpl
  implements CheckPluggyCredentialGateway
{
  private readonly pluggyCredentialRep: PluggyCredentialRep
  private readonly pluggyCredentialItemRep: PluggyCredentialItemRep

  constructor(params: AppContainer) {
    super(params)
    this.pluggyCredentialRep = params.pluggyCredentialRep
    this.pluggyCredentialItemRep = params.pluggyCredentialItemRep
  }

  // `findByPersonId` só devolve credenciais já persistidas (reconstitute) — nunca um rascunho de
  // create() ainda não salvo. `requireId()` falha alto se essa invariante for quebrada no futuro, em
  // vez de filtrar em silêncio um estado que não deveria existir aqui.
  async readCredentialIds(personId: number): Promise<number[]> {
    const credentials = await this.pluggyCredentialRep.findByPersonId(personId)
    return credentials.map((credential) => credential.requireId())
  }

  async readLinkedItemIds(credentialIds: number[]): Promise<string[]> {
    return this.pluggyCredentialItemRep.findItemIdsByCredentialIds(credentialIds)
  }
}
