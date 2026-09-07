import type { PluggyClient } from 'pluggy-sdk'
import { ApplicationError } from '../../shared/application-error.js'
import { pluggySdkError, toIsoStringOrUndefined } from './pluggy-client.gateway.js'
import { PLUGGY_SOURCES, statusDetailKeyFromSource } from './pluggy-source-catalog.js'

// Aviso de produto do `statusDetail` (schema `StatusDetailProductWarning` da Pluggy): presente quando
// o item vem `PARTIAL_SUCCESS` ou quando um produto tem ressalva — é o que permite distinguir
// "produto limitado" de "fonte sem movimentação" (design.md D6).
export interface PluggyProductWarning {
  code: string
  message: string
}

export interface PluggyProductStatus {
  isUpdated: boolean | undefined
  lastUpdatedAt: string | undefined
  warnings: PluggyProductWarning[]
}

// Chaves do `statusDetail` que este serviço consome — as cinco fontes do catálogo (D32), pela chave
// que a Pluggy usa nesse payload especificamente (D7: `investmentTransactions`, singular em
// Investment, é a chave real; `investmentsTransactions` — o código antigo — nunca batia).
export type PluggyProductKey = 'accounts' | 'transactions' | 'investments' | 'investmentTransactions' | 'loans'

const PRODUCT_KEYS = PLUGGY_SOURCES.map((source) => statusDetailKeyFromSource(source)) as PluggyProductKey[]

// Identidade da instituição, embutida em todo `GET /items/{id}` (design.md D8) — inclui os produtos
// que ELA suporta (`connectorProducts`, D19), distintos dos habilitados neste Item (`itemProducts`,
// D26).
export interface PluggyConnectorSnapshot {
  connectorId: number
  name: string
  imageUrl: string | undefined
  primaryColor: string | undefined
  products: string[]
}

export interface PluggyItemSnapshot {
  status: string
  executionStatus: string
  lastUpdatedAt: string | undefined
  // Campo obrigatório do SDK (`updatedAt: Date`, não-nullable) — fallback de versão quando
  // `lastUpdatedAt` é `null` mesmo em `SUCCESS` (design.md D27).
  updatedAt: string
  nextAutoSyncAt: string | undefined
  // Ausente quando a Pluggy manda `statusDetail: null` — item sem ressalva alguma.
  products: Partial<Record<PluggyProductKey, PluggyProductStatus>>
  // Produtos HABILITADOS neste Item (`data.products`, não tipado no `.d.ts` do SDK instalado, mas
  // confirmado no OpenAPI/documentação — design.md D26). `undefined` é estado `UNKNOWN` explícito —
  // nunca `[]`, e nunca inferido de `connector.products`.
  itemProducts: string[] | undefined
  connector: PluggyConnectorSnapshot | undefined
  // Payload bruto, exatamente como recebido, capturado antes desta validação (change
  // pluggy-complete-data-capture, spec pluggy-raw-payload-audit).
  raw: Record<string, unknown>
}

type PluggyItemResponse = {
  status?: unknown
  executionStatus?: unknown
  lastUpdatedAt?: unknown
  updatedAt?: unknown
  nextAutoSyncAt?: unknown
  statusDetail?: unknown
  products?: unknown
  connector?: unknown
}

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
    const lastUpdatedAt = this.parseOptionalDate(itemId, data.lastUpdatedAt, 'lastUpdatedAt')
    const nextAutoSyncAt = this.parseOptionalDate(itemId, data.nextAutoSyncAt, 'nextAutoSyncAt')

    // `updatedAt` é obrigatório e não-nullable no SDK (design.md D27) — recusa nomeada se ausente ou
    // malformado, mesmo padrão defensivo dos demais campos.
    if (data.updatedAt === undefined || data.updatedAt === null) {
      throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', { itemId, field: 'updatedAt' })
    }
    const updatedAt = toIsoStringOrUndefined(data.updatedAt)
    if (updatedAt === undefined) {
      throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', { itemId, field: 'updatedAt' })
    }

    return {
      status: data.status,
      executionStatus: data.executionStatus,
      lastUpdatedAt,
      updatedAt,
      nextAutoSyncAt,
      products: this.parseProducts(itemId, data.statusDetail),
      itemProducts: this.parseItemProducts(data.products),
      connector: this.parseConnector(itemId, data.connector),
      raw: data as Record<string, unknown>,
    }
  }

  private parseOptionalDate(itemId: string, value: unknown, field: string): string | undefined {
    if (value === undefined || value === null) {
      return undefined
    }
    const parsed = toIsoStringOrUndefined(value)
    if (parsed === undefined) {
      throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', { itemId, field })
    }
    return parsed
  }

  // `data.products` (produtos HABILITADOS neste Item) não é tipado no `.d.ts` do SDK instalado —
  // parseado do payload bruto, mesmo padrão defensivo dos demais campos (design.md D26). Ausente ou
  // não reconhecível (não é array de strings) vira `undefined` (`UNKNOWN`) — nunca lança: um formato
  // inesperado aqui é sinal de incerteza, não de payload corrompido. Um array vazio `[]` de verdade
  // (a Pluggy afirmando "nenhum produto habilitado") é distinto de `undefined` ("não sabemos") — os
  // dois nunca se confundem (D26).
  private parseItemProducts(products: unknown): string[] | undefined {
    if (!Array.isArray(products)) {
      return undefined
    }
    if (!products.every((entry) => typeof entry === 'string')) {
      return undefined
    }
    return products as string[]
  }

  // `statusDetail` ausente ou `null` é o caso normal do item sem ressalva — não é erro. Presente com
  // forma errada é resposta mal formada: recusa nomeada, nunca "sem avisos" em silêncio, porque
  // "produto limitado" e "produto sem aviso" levam a decisões opostas (design.md D6).
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

  // `connector` (identidade da instituição, incluindo os produtos que ela suporta — design.md D19)
  // ausente vira `undefined` — sem chamar isso de erro, porque o campo já é tratado como `unknown`
  // por princípio (D7/D26). Presente com forma errada é recusa nomeada, nunca metadata inventada.
  private parseConnector(itemId: string, connector: unknown): PluggyConnectorSnapshot | undefined {
    if (connector === undefined || connector === null) {
      return undefined
    }
    if (typeof connector !== 'object' || Array.isArray(connector)) {
      throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', { itemId, field: 'connector' })
    }

    const raw = connector as Record<string, unknown>
    if (typeof raw.id !== 'number') {
      throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', { itemId, field: 'connector.id' })
    }
    if (typeof raw.name !== 'string') {
      throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', { itemId, field: 'connector.name' })
    }
    if (raw.imageUrl !== undefined && raw.imageUrl !== null && typeof raw.imageUrl !== 'string') {
      throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', { itemId, field: 'connector.imageUrl' })
    }
    if (raw.primaryColor !== undefined && raw.primaryColor !== null && typeof raw.primaryColor !== 'string') {
      throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', { itemId, field: 'connector.primaryColor' })
    }
    if (raw.products !== undefined && raw.products !== null) {
      if (!Array.isArray(raw.products) || !raw.products.every((entry) => typeof entry === 'string')) {
        throw new ApplicationError('PLUGGY_ITEMS_RESPONSE_INVALID', { itemId, field: 'connector.products' })
      }
    }

    return {
      connectorId: raw.id,
      name: raw.name,
      imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : undefined,
      primaryColor: typeof raw.primaryColor === 'string' ? raw.primaryColor : undefined,
      products: Array.isArray(raw.products) ? (raw.products as string[]) : [],
    }
  }
}
