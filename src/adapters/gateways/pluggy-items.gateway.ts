import type { PluggyClient } from 'pluggy-sdk'
import { ApplicationError } from '../../shared/application-error.js'
import { pluggySdkError, toIsoStringOrUndefined } from './pluggy-client.gateway.js'

// Aviso de produto do `statusDetail` (schema `StatusDetailProductWarning` da Pluggy): presente quando
// o item vem `PARTIAL_SUCCESS` ou quando um produto tem ressalva — é o que permite distinguir
// "produto limitado" de "fonte sem movimentação" (design.md D8).
export interface PluggyProductWarning {
  code: string
  message: string
}

export interface PluggyProductStatus {
  isUpdated: boolean | undefined
  lastUpdatedAt: string | undefined
  warnings: PluggyProductWarning[]
}

// Chaves do `statusDetail` que este serviço consome. `accounts`/`transactions` cobrem o extrato de
// caixa; `investments`/`investmentsTransactions`, a custódia.
export type PluggyProductKey = 'accounts' | 'transactions' | 'investments' | 'investmentsTransactions'

export interface PluggyItemSnapshot {
  status: string
  executionStatus: string
  lastUpdatedAt: string | undefined
  // Ausente quando a Pluggy manda `statusDetail: null` — item sem ressalva alguma.
  products: Partial<Record<PluggyProductKey, PluggyProductStatus>>
  // Payload bruto, exatamente como recebido, capturado antes desta validação (change
  // pluggy-complete-data-capture, spec pluggy-raw-payload-audit).
  raw: Record<string, unknown>
}

type PluggyItemResponse = {
  status?: unknown
  executionStatus?: unknown
  lastUpdatedAt?: unknown
  statusDetail?: unknown
}

const PRODUCT_KEYS: PluggyProductKey[] = ['accounts', 'transactions', 'investments', 'investmentsTransactions']

// `GET /items/{id}` pelo `pluggy-sdk` (padroes-de-engenharia, 3b): o transporte é do fornecedor, a
// validação e a tradução continuam nossas. Sem retry nosso (regra 3) — o do SDK, só em 429, é a
// exceção nomeada em 3b.1. Devolve o estado fresco do item pra quem decide o portão de sincronização
// (design.md D1, sincronizacao-posicao-pluggy); não decide nada sozinho.
export class PluggyItemsGateway {
  async fetchItem(itemId: string, client: PluggyClient): Promise<PluggyItemSnapshot> {
    let data: PluggyItemResponse
    try {
      // O tipo `Item` do SDK é promessa de compilação, não garantia de runtime: o payload continua
      // vindo da rede, então ele entra aqui como `unknown` e é validado campo a campo abaixo.
      data = (await client.fetchItem(itemId)) as unknown as PluggyItemResponse
    } catch (error) {
      throw pluggySdkError(
        error,
        {
          timeout: 'PLUGGY_ITEMS_TIMEOUT',
          unavailable: 'PLUGGY_ITEMS_UNAVAILABLE',
          upstream: 'PLUGGY_ITEMS_UPSTREAM_ERROR',
          // 404 continua tendo nome próprio, agora derivado do `code` do corpo de erro da Pluggy —
          // o status HTTP não sobrevive à chamada de dado (3b.1).
          byCode: { 404: 'PLUGGY_ITEM_NOT_FOUND' },
        },
        { itemId },
      )
    }

    return this.parseItem(itemId, data)
  }

  private parseItem(itemId: string, data: PluggyItemResponse): PluggyItemSnapshot {
    if (typeof data.status !== 'string' || typeof data.executionStatus !== 'string') {
      throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', { itemId })
    }
    // Ausente/null é o item nunca ter terminado uma sincronização (legítimo); presente e ilegível é
    // resposta mal formada — recusa nomeada, nunca vira undefined em silêncio (achado do
    // engenheiro-pluggy-connector).
    //
    // O SDK entrega este campo como `Date` quando a string tinha milissegundo e como `string` quando
    // não (3b.1), então as duas formas são aceitas e normalizadas para ISO — que é o que o DTO promete.
    let lastUpdatedAt: string | undefined
    if (data.lastUpdatedAt !== undefined && data.lastUpdatedAt !== null) {
      lastUpdatedAt = toIsoStringOrUndefined(data.lastUpdatedAt)
      if (lastUpdatedAt === undefined) {
        throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', { itemId, field: 'lastUpdatedAt' })
      }
    }

    return {
      status: data.status,
      executionStatus: data.executionStatus,
      lastUpdatedAt,
      products: this.parseProducts(itemId, data.statusDetail),
      raw: data as Record<string, unknown>,
    }
  }

  // `statusDetail` ausente ou `null` é o caso normal do item sem ressalva — não é erro. Presente com
  // forma errada é resposta mal formada: recusa nomeada, nunca "sem avisos" em silêncio, porque
  // "produto limitado" e "produto sem aviso" levam a decisões opostas (design.md D8).
  private parseProducts(itemId: string, statusDetail: unknown): PluggyItemSnapshot['products'] {
    if (statusDetail === undefined || statusDetail === null) {
      return {}
    }
    if (typeof statusDetail !== 'object' || Array.isArray(statusDetail)) {
      throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', { itemId, field: 'statusDetail' })
    }

    const detail = statusDetail as Record<string, unknown>
    const products: PluggyItemSnapshot['products'] = {}

    for (const key of PRODUCT_KEYS) {
      const raw = detail[key]
      if (raw === undefined || raw === null) {
        continue
      }
      if (typeof raw !== 'object' || Array.isArray(raw)) {
        throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', { itemId, field: `statusDetail.${key}` })
      }

      const product = raw as Record<string, unknown>
      if (product.isUpdated !== undefined && product.isUpdated !== null && typeof product.isUpdated !== 'boolean') {
        throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', { itemId, field: `statusDetail.${key}.isUpdated` })
      }
      let productLastUpdatedAt: string | undefined
      if (product.lastUpdatedAt !== undefined && product.lastUpdatedAt !== null) {
        productLastUpdatedAt = toIsoStringOrUndefined(product.lastUpdatedAt)
        if (productLastUpdatedAt === undefined) {
          throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', {
            itemId,
            field: `statusDetail.${key}.lastUpdatedAt`,
          })
        }
      }

      products[key] = {
        isUpdated: typeof product.isUpdated === 'boolean' ? product.isUpdated : undefined,
        lastUpdatedAt: productLastUpdatedAt,
        warnings: this.parseWarnings(itemId, key, product.warnings),
      }
    }

    return products
  }

  private parseWarnings(itemId: string, key: PluggyProductKey, warnings: unknown): PluggyProductWarning[] {
    if (warnings === undefined || warnings === null) {
      return []
    }
    if (!Array.isArray(warnings)) {
      throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', { itemId, field: `statusDetail.${key}.warnings` })
    }

    return warnings.map((raw, index) => {
      if (typeof raw !== 'object' || raw === null) {
        throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', {
          itemId,
          field: `statusDetail.${key}.warnings[${index}]`,
        })
      }
      const warning = raw as Record<string, unknown>
      if (typeof warning.code !== 'string' || typeof warning.message !== 'string') {
        throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', {
          itemId,
          field: `statusDetail.${key}.warnings[${index}]`,
        })
      }
      return { code: warning.code, message: warning.message }
    })
  }
}
