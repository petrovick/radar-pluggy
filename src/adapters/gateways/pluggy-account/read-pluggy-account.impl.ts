import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  PluggyAccountView,
  ReadPluggyAccountGateway,
} from '../../../interactors/pluggy-account/read/read-pluggy-account.types.js'
import type { PluggyAccount } from '../../../entities/pluggy-account.js'
import DefaultInteractorGatewayImpl from '../default-gateway.impl.js'
import type { PluggyPersonItemResolver } from '../pluggy-person-item.resolver.js'
import type { PluggyAccountRep } from '../../repositories/pluggy-account.rep.js'

// Gateway do caso de uso `read-pluggy-account`. Compõe o resolver pessoa→itens e o repositório de
// conta, e traduz a entidade para o formato de resposta HTTP.
export default class ReadPluggyAccountImpl
  extends DefaultInteractorGatewayImpl
  implements ReadPluggyAccountGateway
{
  private readonly pluggyPersonItemResolver: PluggyPersonItemResolver
  private readonly pluggyAccountRep: PluggyAccountRep

  constructor(params: AppContainer) {
    super(params)
    this.pluggyPersonItemResolver = params.pluggyPersonItemResolver
    this.pluggyAccountRep = params.pluggyAccountRep
  }

  async readItemIdsForPerson(personId: number): Promise<string[]> {
    return this.pluggyPersonItemResolver.itemIdsFor(personId)
  }

  async readAccountsByItemIds(itemIds: string[]): Promise<PluggyAccountView[]> {
    const accounts = await this.pluggyAccountRep.findByItemIds(itemIds)
    return accounts.map(toView)
  }
}

function toView(account: PluggyAccount): PluggyAccountView {
  return {
    accountId: account.getAccountId(),
    type: account.getType(),
    subtype: account.getSubtype() ?? null,
    name: account.getName(),
  }
}
