import { ApplicationError } from '../../shared/application-error.js'
import type { PluggyProductKey, PluggyProductStatus } from './pluggy-items.gateway.js'
import { discoveryProductTypesFor, discoveryStatusDetailKeysFor, type PluggySource } from './pluggy-source-catalog.js'

// Gate de elegibilidade por fonte (design.md D26): `enabledForItem` MUST ser verdadeiro antes de
// qualquer outra checagem — uma fonte que o connector suporta mas que este Item não pediu nunca é
// elegível, mesmo sem marca d'água prévia. `itemProducts` ausente (`UNKNOWN`, D26) nunca vira
// elegibilidade por omissão: `enabledForItem` devolve `undefined` nesse caso, e `isEligible` trata
// `undefined` como não-elegível, igual a `false`. `ACCOUNTS` é elegível se QUALQUER um dos dois
// produtos de origem (`ACCOUNTS` ou `CREDIT_CARDS`) estiver habilitado (revisão do PR #14) — as
// outras fontes continuam com um produto só, comportamento inalterado.
export function enabledForItem(itemProducts: string[] | undefined, source: PluggySource): boolean | undefined {
  if (itemProducts === undefined) {
    return undefined
  }
  return discoveryProductTypesFor(source).some((productType) => itemProducts.includes(productType))
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

// Entradas de `statusDetail` de fato presentes para esta fonte nesta execução — a Pluggy só relata
// um produto no `statusDetail` quando ele foi de fato pedido/habilitado para o Item (nunca reporta
// produto não solicitado), então "presente" já significa "habilitado neste Item" sem precisar
// conhecer `itemProducts` aqui (mantém a separação de D26: elegibilidade é decisão de
// `enabledForItem`, não desta função). Para `ACCOUNTS`, pode haver até duas (`accounts`/
// `creditCards`); para as demais fontes, no máximo uma.
function presentProductsFor(item: SourceStateInput, source: PluggySource): PluggyProductStatus[] {
  return discoveryStatusDetailKeysFor(source)
    .map((key) => item.products[key as PluggyProductKey])
    .filter((product): product is PluggyProductStatus => product !== undefined)
}

// Maior `lastUpdatedAt` entre os produtos informados — quando `ACCOUNTS` tem os dois produtos de
// origem habilitados (`ACCOUNTS` e `CREDIT_CARDS`), a versão da execução é a mais recente das duas,
// nunca a mais antiga (não faria sentido reconhecer como "processada" uma versão anterior à que
// alguma das duas fontes de fato confirmou).
function maxLastUpdatedAt(products: PluggyProductStatus[]): string | undefined {
  return products.reduce<string | undefined>((max, product) => {
    if (product.lastUpdatedAt === undefined) return max
    return max === undefined || product.lastUpdatedAt > max ? product.lastUpdatedAt : max
  }, undefined)
}

export function toSourceState(item: SourceStateInput, source: PluggySource): SourceState {
  if (item.executionStatus === 'SUCCESS') {
    // Em SUCCESS, `statusDetail` é `null` (D12) — toda fonte suportada é utilizável, sem versão
    // própria por fonte (a versão da execução é `Item.lastUpdatedAt`/`updatedAt`, ver `toVersionAt`).
    return { isUsable: true, lastUpdatedAt: undefined }
  }

  if (item.executionStatus === 'PARTIAL_SUCCESS') {
    const present = presentProductsFor(item, source)
    if (present.length === 0) {
      return { isUsable: false, lastUpdatedAt: undefined }
    }
    // Todos os produtos de origem presentes precisam estar atualizados — para `ACCOUNTS` com os dois
    // habilitados, um cartão de crédito ainda pendente nunca deixa a fonte utilizável só porque a
    // conta bancária já processou (revisão do PR #14).
    const usable = present.every((product) => product.isUpdated === true)
    return { isUsable: usable, lastUpdatedAt: usable ? maxLastUpdatedAt(present) : undefined }
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
    const present = presentProductsFor(item, source)
    if (present.length === 0 || !present.every((product) => product.isUpdated === true)) {
      return undefined
    }
    if (present.some((product) => product.lastUpdatedAt === undefined)) {
      throw new ApplicationError('PLUGGY_ITEM_PRODUCT_UPDATED_WITHOUT_LAST_UPDATED_AT', { itemId, source })
    }
    // Não-nulo: já garantido pela checagem acima.
    return new Date(maxLastUpdatedAt(present)!)
  }

  return undefined
}
