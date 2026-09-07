import type { Decimal } from 'decimal.js'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  PluggyPositionView,
  ReadPluggyPositionGateway,
} from '../../../interactors/pluggy-position/read/read-pluggy-position.types.js'
import type { PluggyPosition } from '../../../entities/pluggy-position.js'
import DefaultInteractorGatewayImpl from '../default-gateway.impl.js'
import type { PluggyPersonItemResolver } from '../pluggy-person-item.resolver.js'
import type { PluggyPositionRep } from '../../repositories/pluggy-position.rep.js'

// Gateway do caso de uso `read-pluggy-position`. Compõe o resolver pessoa→itens e o repositório de
// posição, e traduz a entidade para o formato de resposta HTTP que o `oplab-radar-front` já espera.
export default class ReadPluggyPositionImpl
  extends DefaultInteractorGatewayImpl
  implements ReadPluggyPositionGateway
{
  private readonly pluggyPersonItemResolver: PluggyPersonItemResolver
  private readonly pluggyPositionRep: PluggyPositionRep

  constructor(params: AppContainer) {
    super(params)
    this.pluggyPersonItemResolver = params.pluggyPersonItemResolver
    this.pluggyPositionRep = params.pluggyPositionRep
  }

  async readItemIdsForPerson(personId: number): Promise<string[]> {
    return this.pluggyPersonItemResolver.itemIdsFor(personId)
  }

  async readPositionsByItemIds(itemIds: string[]): Promise<PluggyPositionView[]> {
    const positions = await this.pluggyPositionRep.findByItemIds(itemIds)
    return positions.map(toView)
  }
}

// Mesma escala usada na escrita (`pluggy-position.rep.ts`, `toRow`): 2 casas para saldo, 8 para
// quantidade/preço/taxa. `Decimal.toString()` suprimiria zero à direita ("1500.50" -> "1500.5"),
// divergindo do que está gravado.
function toDecimalString(value: Decimal | undefined, decimalPlaces: number): string | null {
  return value === undefined ? null : value.toFixed(decimalPlaces)
}

function toDateString(value: Date | undefined): string | null {
  return value === undefined ? null : value.toISOString()
}

function toView(position: PluggyPosition): PluggyPositionView {
  return {
    investmentId: position.getInvestmentId(),
    type: position.getType(),
    subtype: position.getSubtype() ?? null,
    name: position.getName(),
    balance: position.getBalance().toFixed(2),
    quantity: toDecimalString(position.getQuantity(), 8),
    value: toDecimalString(position.getValue(), 8),
    dueDate: toDateString(position.getDueDate()),
    rate: toDecimalString(position.getRate(), 8),
    rateType: position.getRateType() ?? null,
    annualRate: toDecimalString(position.getAnnualRate(), 8),
    lastTwelveMonthsRate: toDecimalString(position.getLastTwelveMonthsRate(), 8),
    institutionName: position.getInstitutionName() ?? null,
    issuer: position.getIssuer() ?? null,
    issueDate: toDateString(position.getIssueDate()),
    purchaseDate: toDateString(position.getPurchaseDate()),
  }
}
