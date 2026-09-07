import { ApplicationError } from '../../shared/application-error.js'
import type { PluggyProductKey, PluggyProductStatus } from './pluggy-items.gateway.js'
import { productTypeFromSource, statusDetailKeyFromSource, type PluggySource } from './pluggy-source-catalog.js'

// Gate de elegibilidade por fonte (design.md D26): `enabledForItem` MUST ser verdadeiro antes de
// qualquer outra checagem — uma fonte que o connector suporta mas que este Item não pediu nunca é
// elegível, mesmo sem marca d'água prévia. `itemProducts` ausente (`UNKNOWN`, D26) nunca vira
// elegibilidade por omissão: `enabledForItem` devolve `undefined` nesse caso, e `isEligible` trata
// `undefined` como não-elegível, igual a `false`.
export function enabledForItem(itemProducts: string[] | undefined, source: PluggySource): boolean | undefined {
  if (itemProducts === undefined) {
    return undefined
  }
  return itemProducts.includes(productTypeFromSource(source))
}

export function isEligible(itemProducts: string[] | undefined, source: PluggySource): boolean {
  return enabledForItem(itemProducts, source) === true
}

// "Fonte utilizável" é decidida por `isUpdated`, nunca por código de `warning` (design.md D6): o
// campo estruturado e suficiente é `ItemProductState.isUpdated`. O nome de domínio é `isUsable` — não
// `limitedByRateLimit` (o warning `423`/rate-limit é só UM motivo possível de `isUpdated === false`;
// nomear a causa contradiz o próprio motivo de usar o booleano em vez do código do fornecedor).
export interface SourceStateInput {
  executionStatus: string
  products: Partial<Record<PluggyProductKey, PluggyProductStatus>>
}

export interface SourceState {
  isUsable: boolean
  lastUpdatedAt: string | undefined
}

export function toSourceState(item: SourceStateInput, source: PluggySource): SourceState {
  if (item.executionStatus === 'SUCCESS') {
    // Em SUCCESS, `statusDetail` é `null` (D12) — toda fonte suportada é utilizável, sem versão
    // própria por fonte (a versão da execução é `Item.lastUpdatedAt`/`updatedAt`, ver `toVersionAt`).
    return { isUsable: true, lastUpdatedAt: undefined }
  }

  if (item.executionStatus === 'PARTIAL_SUCCESS') {
    const product = item.products[statusDetailKeyFromSource(source) as PluggyProductKey]
    const usable = product?.isUpdated === true
    return { isUsable: usable, lastUpdatedAt: usable ? product?.lastUpdatedAt : undefined }
  }

  return { isUsable: false, lastUpdatedAt: undefined }
}

export function isUsable(item: SourceStateInput, source: PluggySource): boolean {
  return toSourceState(item, source).isUsable
}

// "Versão da execução" que `pluggy-sync-progress` grava para (consumidor, fonte) — design.md D12/D27.
// Nunca "o lastUpdatedAt real daquela fonte na Pluggy": em `SUCCESS`, é `Item.lastUpdatedAt` (ou
// `Item.updatedAt`, quando o primeiro é `null` mesmo em sucesso — D27); em `PARTIAL_SUCCESS`, é
// `statusDetail.<fonte>.lastUpdatedAt`, só quando a fonte é utilizável.
//
// Devolve `undefined` quando a fonte não é utilizável nesta execução (nada a gravar — chamador
// decide se tenta de novo). Lança nomeado só quando o próprio contrato documentado pela Pluggy é
// violado (`isUpdated === true` sem `lastUpdatedAt`) — nunca inventa um valor substituto nesse caso.
export function toVersionAt(
  item: SourceStateInput & { lastUpdatedAt: string | undefined; updatedAt: string },
  source: PluggySource,
  itemId: string,
): Date | undefined {
  if (item.executionStatus === 'SUCCESS') {
    return new Date(item.lastUpdatedAt ?? item.updatedAt)
  }

  if (item.executionStatus === 'PARTIAL_SUCCESS') {
    const product = item.products[statusDetailKeyFromSource(source) as PluggyProductKey]
    if (product?.isUpdated !== true) {
      return undefined
    }
    if (product.lastUpdatedAt === undefined) {
      throw new ApplicationError('PLUGGY_ITEM_PRODUCT_UPDATED_WITHOUT_LAST_UPDATED_AT', { itemId, source })
    }
    return new Date(product.lastUpdatedAt)
  }

  return undefined
}
