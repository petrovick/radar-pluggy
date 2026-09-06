import { ApplicationError } from '../shared/application-error.js'

// Único ponto de entrada de dado externo (handler HTTP de cadastro): o guard roda em runtime porque o
// excess-property check do TS não pega objeto montado dinamicamente (ex.: espalhado de um payload),
// mesmo padrão de pluggy-item.ts.
const ALLOWED_CREATE_FIELDS = new Set(['personId', 'clientId', 'clientSecret'])

interface CreatePluggyCredentialProps {
  personId: number | undefined
  clientId: string
  clientSecret: string
}

// Dados do webhook são opcionais por natureza: credencial cadastrada antes do webhook existir, ou
// ainda não provisionada, simplesmente não os tem. Não entram em `create` — quem os define é a
// operação explícita de provisionamento (design.md D7, tasks.md 7.1/7.4).
export interface PluggyCredentialWebhook {
  secret: string
  webhookId: string
  url: string
  event: string
}

export class PluggyCredential {
  private constructor(
    private readonly id: number | undefined,
    private readonly personId: number,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly webhook: PluggyCredentialWebhook | undefined,
  ) {}

  static create(props: CreatePluggyCredentialProps): PluggyCredential {
    assertNoUnexpectedFields(props)
    if (props.personId === undefined) {
      throw new ApplicationError('PLUGGY_CREDENTIAL_PERSON_ID_MISSING')
    }
    assertNonEmpty(props.clientId, 'PLUGGY_CREDENTIAL_CLIENT_ID_MISSING')
    assertNonEmpty(props.clientSecret, 'PLUGGY_CREDENTIAL_CLIENT_SECRET_MISSING')
    return new PluggyCredential(undefined, props.personId, props.clientId, props.clientSecret, undefined)
  }

  // Reconstrói a partir de uma linha já persistida (fronteira model → entity do repositório). `id` vem
  // do autoincrement — é o que `pluggy_connector_credential_items.credential_id` referencia (design.md D5,
  // configuracao-credenciais-pluggy), então só existe depois que a credencial já foi salva.
  static reconstitute(props: {
    id: number
    personId: number
    clientId: string
    clientSecret: string
    webhook?: PluggyCredentialWebhook | undefined
  }): PluggyCredential {
    return new PluggyCredential(props.id, props.personId, props.clientId, props.clientSecret, props.webhook)
  }

  getId(): number | undefined {
    return this.id
  }

  // Diferente de PluggyItem, esta entidade não tem transição de estado pós-criação: rotacionar um
  // segredo cria uma credencial nova (D2, configuracao-credenciais-pluggy — uma pessoa pode ter mais
  // de uma), nunca muta esta em lugar. A única invariante depois de criada é a própria existência do
  // id: nunca se referencia uma credencial ainda não persistida, e este método recusa nomeando isso em
  // vez de deixar quem chama mentir para o compilador com um cast.
  requireId(): number {
    if (this.id === undefined) {
      throw new ApplicationError('PLUGGY_CREDENTIAL_ID_NOT_ASSIGNED')
    }
    return this.id
  }

  getPersonId(): number {
    return this.personId
  }

  getClientId(): string {
    return this.clientId
  }

  // Nunca devolve o segredo de webhook junto do de API por acidente: são getters separados, e o de
  // webhook só é comparado no handler, em tempo constante (design.md W1).
  getWebhook(): PluggyCredentialWebhook | undefined {
    return this.webhook
  }

  getClientSecret(): string {
    return this.clientSecret
  }
}

function assertNonEmpty(value: string, errorType: string): void {
  if (!value || value.trim().length === 0) {
    throw new ApplicationError(errorType)
  }
}

function assertNoUnexpectedFields(props: object): void {
  const forbidden = Object.keys(props).filter((key) => !ALLOWED_CREATE_FIELDS.has(key))
  if (forbidden.length > 0) {
    throw new ApplicationError('PLUGGY_CREDENTIAL_UNEXPECTED_FIELD', { fields: forbidden })
  }
}
