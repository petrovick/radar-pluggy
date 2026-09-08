import type { Decimal } from 'decimal.js'
import type { AppContainer } from '../../../infra/bootstrap/register.js'
import type {
  PluggyPositionMetadataView,
  PluggyPositionView,
  ReadPluggyPositionGateway,
} from '../../../interactors/pluggy-position/read/read-pluggy-position.types.js'
import type { PluggyPosition, PluggyPositionMetadata } from '../../../entities/pluggy-position.js'
import DefaultInteractorGatewayImpl from '../default-gateway.impl.js'
import type { PluggyPersonItemResolver } from '../pluggy-person-item.resolver.js'
import type { PluggyPositionRep } from '../../repositories/pluggy-position.rep.js'
import type { PluggyCredentialItemRep } from '../../repositories/pluggy-credential-item.rep.js'

// Gateway do caso de uso `read-pluggy-position`. Compõe o resolver pessoa→itens, o repositório de
// posição e o repositório de vínculos para resolução em lote de `sourceInstitutionName` (sem N+1).
// Traduz a entidade para o formato completo de resposta HTTP.
export default class ReadPluggyPositionImpl
  extends DefaultInteractorGatewayImpl
  implements ReadPluggyPositionGateway
{
  private readonly pluggyPersonItemResolver: PluggyPersonItemResolver
  private readonly pluggyPositionRep: PluggyPositionRep
  private readonly pluggyCredentialItemRep: PluggyCredentialItemRep

  constructor(params: AppContainer) {
    super(params)
    this.pluggyPersonItemResolver = params.pluggyPersonItemResolver
    this.pluggyPositionRep = params.pluggyPositionRep
    this.pluggyCredentialItemRep = params.pluggyCredentialItemRep
  }

  async readItemIdsForPerson(personId: number): Promise<string[]> {
    return this.pluggyPersonItemResolver.itemIdsFor(personId)
  }

  async readPositionsByItemIds(itemIds: string[]): Promise<PluggyPositionView[]> {
    const [positions, connectorNamesMap] = await Promise.all([
      this.pluggyPositionRep.findByItemIds(itemIds),
      this.pluggyCredentialItemRep.findConnectorNamesByItemIds(itemIds),
    ])
    return positions.map((position) =>
      toView(position, connectorNamesMap.get(position.getItemId())),
    )
  }
}

// Mesma escala usada na escrita (`pluggy-position.rep.ts`, `toRow`): 2 casas para saldo/monetário,
// 8 para quantidade/preço/taxa. `Decimal.toString()` suprimiria zero à direita ("1500.50" -> "1500.5"),
// divergindo do que está gravado.
function toDecimalString(value: Decimal | undefined, decimalPlaces: number): string | null {
  return value === undefined ? null : value.toFixed(decimalPlaces)
}

function toDateString(value: Date | undefined): string | null {
  return value === undefined ? null : value.toISOString()
}

function toMetadataView(metadata: PluggyPositionMetadata | undefined): PluggyPositionMetadataView | null {
  if (!metadata) {
    return null
  }
  return {
    taxRegime: metadata.taxRegime ?? null,
    proposalNumber: metadata.proposalNumber ?? null,
    processNumber: metadata.processNumber ?? null,
  }
}

function toView(position: PluggyPosition, sourceInstitutionName?: string): PluggyPositionView {
  return {
    investmentId: position.getInvestmentId(),
    type: position.getType(),
    subtype: position.getSubtype() ?? null,
    name: position.getName(),
    code: position.getCode() ?? null,
    isin: position.getIsin() ?? null,
    currencyCode: position.getCurrencyCode(),
    balance: position.getBalance().toFixed(2),
    quantity: toDecimalString(position.getQuantity(), 8),
    value: toDecimalString(position.getValue(), 8),
    amountOriginal: toDecimalString(position.getAmountOriginal(), 2),
    amount: toDecimalString(position.getAmount(), 2),
    taxes: toDecimalString(position.getTaxes(), 2),
    taxes2: toDecimalString(position.getTaxes2(), 2),
    amountWithdrawal: toDecimalString(position.getAmountWithdrawal(), 2),
    amountProfit: toDecimalString(position.getAmountProfit(), 2),
    status: position.getStatus() ?? null,
    quotaDate: position.getQuotaDate().toISOString(),
    dueDate: toDateString(position.getDueDate()),
    issueDate: toDateString(position.getIssueDate()),
    purchaseDate: toDateString(position.getPurchaseDate()),
    issuer: position.getIssuer() ?? null,
    issuerCnpj: position.getIssuerCnpj() ?? null,
    rate: toDecimalString(position.getRate(), 8),
    rateType: position.getRateType() ?? null,
    fixedAnnualRate: toDecimalString(position.getFixedAnnualRate(), 8),
    lastMonthRate: toDecimalString(position.getLastMonthRate(), 8),
    annualRate: toDecimalString(position.getAnnualRate(), 8),
    lastTwelveMonthsRate: toDecimalString(position.getLastTwelveMonthsRate(), 8),
    institutionName: position.getInstitutionName() ?? null,
    institutionNumber: position.getInstitutionNumber() ?? null,
    sourceInstitutionName: sourceInstitutionName ?? null,
    number: position.getNumber() ?? null,
    owner: position.getOwner() ?? null,
    metadata: toMetadataView(position.getMetadata()),
  }
}

