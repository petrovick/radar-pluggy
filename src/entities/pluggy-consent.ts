import { ApplicationError } from '../shared/application-error.js'

interface CreatePluggyConsentProps {
  consentId: string
  itemId: string
  grantedAt: Date
  expiresAt: Date | undefined
  revokedAt: Date | undefined
  // Escopo autorizado (change pluggy-complete-data-capture, spec pluggy-consent) — o que o titular
  // autorizou, não só até quando. Listas de string simples, carregadas exatamente como a Pluggy
  // devolveu.
  products: string[] | undefined
  openFinancePermissionsGranted: string[] | undefined
}

export type PluggyConsentState = 'ACTIVE' | 'EXPIRED' | 'REVOKED'

// Prazo de expiração/revogação do consentimento Open Finance por trás de um item (fronteira-pluggy
// regra 3 — vazio não é zero: item cujo consentimento expirou ou foi revogado faz `GET /investments`
// devolver lista vazia, e sem esta entidade a causa real nunca chegava nomeada, só o sintoma).
//
// `statusAt` é o invariante: revogação manda sobre expiração — uma vez revogado, a data de expiração
// original deixa de importar.
// Construtor recebe `props` por nome, não por posição: `products` e
// `openFinancePermissionsGranted` são dois campos `string[] | undefined` consecutivos — uma
// transposição entre os dois trocaria produto por permissão em silêncio (mesmo raciocínio de
// `pluggy-account.ts`).
export class PluggyConsent {
  private readonly consentId: string
  private readonly itemId: string
  private readonly grantedAt: Date
  private readonly expiresAt: Date | undefined
  private readonly revokedAt: Date | undefined
  private readonly products: string[] | undefined
  private readonly openFinancePermissionsGranted: string[] | undefined

  private constructor(props: CreatePluggyConsentProps) {
    this.consentId = props.consentId
    this.itemId = props.itemId
    this.grantedAt = props.grantedAt
    this.expiresAt = props.expiresAt
    this.revokedAt = props.revokedAt
    this.products = props.products
    this.openFinancePermissionsGranted = props.openFinancePermissionsGranted
  }

  static create(props: CreatePluggyConsentProps): PluggyConsent {
    assertNonEmpty(props.consentId, 'PLUGGY_CONSENT_ID_MISSING')
    assertNonEmpty(props.itemId, 'PLUGGY_CONSENT_ITEM_ID_MISSING')
    if (props.grantedAt === undefined || Number.isNaN(props.grantedAt.getTime())) {
      throw new ApplicationError('PLUGGY_CONSENT_GRANTED_AT_MISSING', { consentId: props.consentId })
    }
    return new PluggyConsent(props)
  }

  // Reconstrói a partir de uma linha já persistida — mesma validação de `create`, nenhum side effect
  // novo (mesmo precedente de `PluggyItem.reconstitute`).
  static reconstitute(props: CreatePluggyConsentProps): PluggyConsent {
    return PluggyConsent.create(props)
  }

  statusAt(now: Date): PluggyConsentState {
    if (this.revokedAt !== undefined) {
      return 'REVOKED'
    }
    if (this.expiresAt !== undefined && this.expiresAt.getTime() <= now.getTime()) {
      return 'EXPIRED'
    }
    return 'ACTIVE'
  }

  getConsentId(): string {
    return this.consentId
  }

  getItemId(): string {
    return this.itemId
  }

  getGrantedAt(): Date {
    return this.grantedAt
  }

  getExpiresAt(): Date | undefined {
    return this.expiresAt
  }

  getRevokedAt(): Date | undefined {
    return this.revokedAt
  }

  getProducts(): string[] | undefined {
    return this.products
  }

  getOpenFinancePermissionsGranted(): string[] | undefined {
    return this.openFinancePermissionsGranted
  }
}

// A Pluggy devolve o histórico inteiro de consentimentos de um item (renovação gera um registro novo,
// sem apagar o anterior) — o mais recentemente concedido é o que vale para decidir se o item pode
// sincronizar.
export function mostRecentConsent(consents: PluggyConsent[]): PluggyConsent | undefined {
  return consents.reduce<PluggyConsent | undefined>((latest, candidate) => {
    if (latest === undefined || candidate.getGrantedAt().getTime() > latest.getGrantedAt().getTime()) {
      return candidate
    }
    return latest
  }, undefined)
}

function assertNonEmpty(value: string, errorType: string): void {
  if (!value || value.trim().length === 0) {
    throw new ApplicationError(errorType)
  }
}
