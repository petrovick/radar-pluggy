import { ApplicationError } from '../shared/application-error.js'

const ALLOWED_CREATE_FIELDS = new Set([
  'itemId',
  'status',
  'executionStatus',
  'statusDetail',
  'itemProducts',
  'lastUpdatedAt',
  'nextAutoSyncAt',
  'connectorId',
  'observationStartedAt',
])

export interface CreatePluggyItemObservationProps {
  itemId: string
  status: string
  executionStatus: string
  statusDetail: Record<string, unknown> | undefined
  itemProducts: string[] | undefined
  lastUpdatedAt: Date | undefined
  nextAutoSyncAt: Date | undefined
  connectorId: number | undefined
  observationStartedAt: Date
}

// Último estado observado de um Item já vinculado (design.md D33) — schema completo o bastante pra
// `/credentials/status` responder sem chamar `fetchItem` de novo (D20). `observationStartedAt` é o
// token de ordenação (D9.1): capturado ANTES do `fetchItem`, nunca o instante do save — a condição de
// aceite (D17) é decidida pelo repositório com uma escrita atômica, não por comparação em memória
// aqui.
export class PluggyItemObservation {
  private constructor(
    private readonly itemId: string,
    private readonly status: string,
    private readonly executionStatus: string,
    private readonly statusDetail: Record<string, unknown> | undefined,
    private readonly itemProducts: string[] | undefined,
    private readonly lastUpdatedAt: Date | undefined,
    private readonly nextAutoSyncAt: Date | undefined,
    private readonly connectorId: number | undefined,
    private readonly observationStartedAt: Date,
  ) {}

  static create(props: CreatePluggyItemObservationProps): PluggyItemObservation {
    assertNoUnexpectedFields(props)
    assertPresent(props.itemId, 'PLUGGY_ITEM_OBSERVATION_ITEM_ID_MISSING')
    assertPresent(props.status, 'PLUGGY_ITEM_OBSERVATION_STATUS_MISSING')
    assertPresent(props.executionStatus, 'PLUGGY_ITEM_OBSERVATION_EXECUTION_STATUS_MISSING')

    if (props.observationStartedAt === undefined || Number.isNaN(props.observationStartedAt.getTime())) {
      throw new ApplicationError('PLUGGY_ITEM_OBSERVATION_STARTED_AT_MISSING', { itemId: props.itemId })
    }

    return new PluggyItemObservation(
      props.itemId,
      props.status,
      props.executionStatus,
      props.statusDetail,
      props.itemProducts,
      props.lastUpdatedAt,
      props.nextAutoSyncAt,
      props.connectorId,
      props.observationStartedAt,
    )
  }

  static reconstitute(props: CreatePluggyItemObservationProps): PluggyItemObservation {
    return new PluggyItemObservation(
      props.itemId,
      props.status,
      props.executionStatus,
      props.statusDetail,
      props.itemProducts,
      props.lastUpdatedAt,
      props.nextAutoSyncAt,
      props.connectorId,
      props.observationStartedAt,
    )
  }

  getItemId(): string {
    return this.itemId
  }

  getStatus(): string {
    return this.status
  }

  getExecutionStatus(): string {
    return this.executionStatus
  }

  getStatusDetail(): Record<string, unknown> | undefined {
    return this.statusDetail
  }

  getItemProducts(): string[] | undefined {
    return this.itemProducts
  }

  getLastUpdatedAt(): Date | undefined {
    return this.lastUpdatedAt
  }

  getNextAutoSyncAt(): Date | undefined {
    return this.nextAutoSyncAt
  }

  getConnectorId(): number | undefined {
    return this.connectorId
  }

  getObservationStartedAt(): Date {
    return this.observationStartedAt
  }
}

function assertPresent(value: string | undefined, errorType: string): void {
  if (!value || value.trim().length === 0) {
    throw new ApplicationError(errorType)
  }
}

function assertNoUnexpectedFields(props: object): void {
  const forbidden = Object.keys(props).filter((key) => !ALLOWED_CREATE_FIELDS.has(key))
  if (forbidden.length > 0) {
    throw new ApplicationError('PLUGGY_ITEM_OBSERVATION_UNEXPECTED_FIELD', { fields: forbidden })
  }
}
