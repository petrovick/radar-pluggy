import type { AppContainer } from '../../infra/bootstrap/register.js'
import type { PluggyCredentialItemRep } from '../repositories/pluggy-credential-item.rep.js'
import type { PluggyCredentialRep } from '../repositories/pluggy-credential.rep.js'

// Resolve "quais itens pertencem a esta pessoa" — direção inversa de
// `PluggyItemCredentialResolver` (que resolve item → credencial). Consulta com invariante, não
// caso de uso (arquitetura-camadas, 2.3.1): ninguém de produto pede "resolva os itens da pessoa",
// é insumo de quem lê portfolio/contas por pessoa.
//
// Ausência nunca é erro aqui: pessoa sem credencial ou sem item vinculado devolve lista vazia —
// portfolio/contas vazios é estado normal (D3, fronteira-pluggy regra 3), diferente de
// `CheckPluggyCredentialImpl`, que existe justamente para nomear as duas ausências como recusa.
export class PluggyPersonItemResolver {
  private readonly pluggyCredentialRep: PluggyCredentialRep
  private readonly pluggyCredentialItemRep: PluggyCredentialItemRep

  constructor(params: AppContainer) {
    this.pluggyCredentialRep = params.pluggyCredentialRep
    this.pluggyCredentialItemRep = params.pluggyCredentialItemRep
  }

  async itemIdsFor(personId: number): Promise<string[]> {
    const credentials = await this.pluggyCredentialRep.findByPersonId(personId)
    if (credentials.length === 0) {
      return []
    }

    const credentialIds = credentials.map((credential) => credential.requireId())
    // Item inativo (`item/deleted`, design.md D29) nunca contribui fotografia corrente — mesmo ajuste
    // corrige `GET /portfolio` e `GET /accounts` num só ponto.
    return this.pluggyCredentialItemRep.findActiveItemIdsByCredentialIds(credentialIds)
  }
}
