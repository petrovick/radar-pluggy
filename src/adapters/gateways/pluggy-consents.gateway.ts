import type { PluggyClient } from 'pluggy-sdk'
import { ApplicationError } from '../../shared/application-error.js'
import { pluggySdkError, toDateOrUndefined } from './pluggy-client.gateway.js'

export interface PluggyConsentDto {
  consentId: string
  itemId: string
  grantedAt: Date
  expiresAt: Date | undefined
  revokedAt: Date | undefined
  // Escopo autorizado (change pluggy-complete-data-capture, spec pluggy-consent) — antes nunca lido
  // aqui.
  products: string[] | undefined
  openFinancePermissionsGranted: string[] | undefined
  // Payload bruto, exatamente como recebido, capturado antes desta validação (change
  // pluggy-complete-data-capture, spec pluggy-raw-payload-audit).
  raw: Record<string, unknown>
}

interface PluggyConsentsResponse {
  results?: unknown
  totalPages?: unknown
}

// Máximo suportado pelo SDK (`PageFilters.pageSize`). Consentimento se acumula por renovação ao
// longo de anos, nunca aos milhares — uma página deste tamanho cobre qualquer item real.
const PAGE_SIZE = 500

// `GET /consents` pelo `pluggy-sdk` (padroes-de-engenharia, 3b) — sem retry nosso (regra 3). Devolve
// o histórico bruto traduzido; decidir qual consentimento é o vigente é do consumidor
// (`entities/pluggy-consent.ts`, `mostRecentConsent`), não deste gateway de borda.
export class PluggyConsentsGateway {
  async fetchConsents(itemId: string, client: PluggyClient): Promise<PluggyConsentDto[]> {
    let data: PluggyConsentsResponse
    try {
      data = (await client.fetchConsents(itemId, { page: 1, pageSize: PAGE_SIZE })) as unknown as PluggyConsentsResponse
    } catch (error) {
      throw pluggySdkError(
        error,
        {
          timeout: 'PLUGGY_CONSENTS_TIMEOUT',
          unavailable: 'PLUGGY_CONSENTS_UNAVAILABLE',
          upstream: 'PLUGGY_CONSENTS_UPSTREAM_ERROR',
        },
        { itemId },
      )
    }

    return this.parseConsents(itemId, data)
  }

  private parseConsents(itemId: string, data: PluggyConsentsResponse): PluggyConsentDto[] {
    if (!Array.isArray(data.results)) {
      throw new ApplicationError('PLUGGY_CONSENTS_RESPONSE_INVALID', { itemId, field: 'results' })
    }
    if (typeof data.totalPages !== 'number' || !Number.isInteger(data.totalPages) || data.totalPages < 0) {
      throw new ApplicationError('PLUGGY_CONSENTS_RESPONSE_INVALID', { itemId, field: 'totalPages' })
    }
    // Não existe paginador aqui (diferente de `fetchInvestmentPages`) porque este volume nunca
    // justifica um: se um dia estourar a página de 500, recusa nomeada em vez de truncar o histórico
    // em silêncio (arquitetura-camadas, 2.2.3).
    if (data.totalPages > 1) {
      throw new ApplicationError('PLUGGY_CONSENTS_TOO_MANY_RESULTS', { itemId, totalPages: data.totalPages })
    }

    return data.results.map((raw, index) => this.toDto(itemId, index, raw))
  }

  private toDto(itemId: string, index: number, raw: unknown): PluggyConsentDto {
    const consent = raw as Record<string, unknown>

    return {
      consentId: requireString(consent.id, itemId, index, 'id'),
      itemId,
      grantedAt: requireDate(consent.createdAt, itemId, index, 'createdAt'),
      expiresAt: optionalDate(consent.expiresAt, itemId, index, 'expiresAt'),
      revokedAt: optionalDate(consent.revokedAt, itemId, index, 'revokedAt'),
      products: optionalStringArray(consent.products, itemId, index, 'products'),
      openFinancePermissionsGranted: optionalStringArray(
        consent.openFinancePermissionsGranted,
        itemId,
        index,
        'openFinancePermissionsGranted',
      ),
      raw: consent,
    }
  }
}

function requireString(value: unknown, itemId: string, index: number, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApplicationError('PLUGGY_CONSENT_RESPONSE_INVALID', { itemId, index, field })
  }
  return value
}

function requireDate(value: unknown, itemId: string, index: number, field: string): Date {
  // Aceita `Date` ou `string` — o SDK só converte quando a string tem milissegundo
  // (padroes-de-engenharia, 3b.1).
  const date = toDateOrUndefined(value)
  if (date === undefined) {
    throw new ApplicationError('PLUGGY_CONSENT_RESPONSE_INVALID', { itemId, index, field })
  }
  return date
}

// Lista de string simples (`products`/`openFinancePermissionsGranted`) — ausente é ausente; presente
// com item que não é string é resposta mal formada, recusa nomeada.
function optionalStringArray(value: unknown, itemId: string, index: number, field: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ApplicationError('PLUGGY_CONSENT_RESPONSE_INVALID', { itemId, index, field })
  }
  return value as string[]
}

// Ausente é ausente (consentimento sem prazo de expiração/revogação); presente com formato ilegível
// é resposta mal formada — recusa nomeada, nunca vira "sem prazo" em silêncio.
function optionalDate(value: unknown, itemId: string, index: number, field: string): Date | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  const date = toDateOrUndefined(value)
  if (date === undefined) {
    throw new ApplicationError('PLUGGY_CONSENT_RESPONSE_INVALID', { itemId, index, field })
  }
  return date
}
